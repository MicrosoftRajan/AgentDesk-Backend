import {
  cancelAwaitingApprovalRun,
  createAgentRunRecord,
  createMessage,
  getAgentRun as getAgentRunRecord,
  getAgentRuns as getAgentRunRecords,
  updateAgentRunRecord,
  type AgentRunRecord,
} from "./agent.repository.js";

import {
  createApprovalRequestRecord,
  expireStaleApprovalRequests,
  getPendingApprovalRequest,
  resolveApprovalRequest,
} from "./approval.repository.js";

import { executeAgent, resumeAgent } from "./agent.engine.js";
import { summarizeApproval } from "./approval.summary.js";
import { APPROVAL_TTL_MS } from "./guardrail.service.js";
import { getRelevantMemory } from "./memory.service.js";

import type {
  AgentExecutionResult,
  AgentRun,
  AgentRunDetails,
  AgentRunResult,
  ApprovalRequest,
  EngineMessage,
} from "./agent.types.js";

/** The run (or its approval) does not exist. Maps to HTTP 404. */
export class AgentRunNotFoundError extends Error {
  constructor(message = "Agent run not found") {
    super(message);
    this.name = "AgentRunNotFoundError";
  }
}

/** The run is not in a state that allows this action. Maps to HTTP 409. */
export class AgentRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunConflictError";
  }
}

function toAgentRun(record: AgentRunRecord): AgentRun {
  return {
    id: record.id,
    goal: record.goal,
    status: record.status,
    createdAt: record.createdAt,
    response: record.response,
    completedAt: record.completedAt,
  };
}

function toRunResult(
  record: AgentRunRecord,
  pendingApproval: ApprovalRequest | null = null,
): AgentRunResult {
  return { ...toAgentRun(record), pendingApproval };
}

/** Adds a human-readable summary to an approval (display only). */
async function withSummary(
  approval: ApprovalRequest | null,
): Promise<ApprovalRequest | null> {
  if (!approval) {
    return null;
  }

  return { ...approval, summary: await summarizeApproval(approval) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Agent run failed";
}

/** Message persistence is best-effort; it must never break a run. */
async function saveMessage(
  runId: string,
  message: EngineMessage,
): Promise<void> {
  try {
    await createMessage({ runId, ...message });
  } catch (error) {
    console.error(
      `[agent:${runId}] failed to persist ${message.role} message:`,
      error,
    );
  }
}

/**
 * Turns whatever the engine produced into persisted state:
 * completed, paused for approval, or (on error) failed.
 */
async function settleRun(
  runId: string,
  execute: () => Promise<AgentExecutionResult>,
): Promise<AgentRunResult> {
  try {
    const result = await execute();

    if (result.type === "awaiting_approval") {
      const approval = await createApprovalRequestRecord({
        runId,
        toolCallId: result.call.callId,
        toolName: result.call.name,
        toolInput: result.call.input,
        riskLevel: result.riskLevel,
        expiresAt: new Date(
          Date.now() + APPROVAL_TTL_MS,
        ).toISOString(),
        checkpoint: result.checkpoint,
      });

      await saveMessage(runId, {
        role: "system",
        content:
          `Approval required: the agent wants to run ` +
          `${result.call.name} (${result.riskLevel} risk) with ` +
          `${JSON.stringify(result.call.input)}`,
      });

      const paused = await updateAgentRunRecord(runId, {
        status: "awaiting_approval",
      });

      return toRunResult(paused, await withSummary(approval));
    }

    const completed = await updateAgentRunRecord(runId, {
      status: "completed",
      response: result.response,
      completedAt: new Date().toISOString(),
    });

    return toRunResult(completed);
  } catch (error) {
    await saveMessage(runId, {
      role: "system",
      content: `Run failed: ${errorMessage(error)}`,
    });

    try {
      await updateAgentRunRecord(runId, {
        status: "failed",
        completedAt: new Date().toISOString(),
      });
    } catch (updateError) {
      console.error(
        `[agent:${runId}] failed to mark run as failed:`,
        updateError,
      );
    }

    throw error;
  }
}

/**
 * Creates a run, executes it with relevant memory, and persists the
 * whole conversation as it goes. May stop early in `awaiting_approval`.
 */
export async function createAgentRun(
  goal: string,
): Promise<AgentRunResult> {
  const created = await createAgentRunRecord({ goal });
  const runId = created.id;

  await updateAgentRunRecord(runId, { status: "running" });
  await saveMessage(runId, { role: "user", content: goal });

  return settleRun(runId, async () => {
    const memoryContext = await getRelevantMemory(goal, runId);

    return executeAgent(goal, runId, {
      memoryContext,
      onMessage: (message) => saveMessage(runId, message),
    });
  });
}

/**
 * Closes out a run whose approval deadline has passed. Safe to call any
 * time and from several places: every step is conditional.
 */
async function expireStaleApprovalsFor(
  runId?: string,
): Promise<void> {
  const runIds = await expireStaleApprovalRequests(runId);

  for (const expiredRunId of new Set(runIds)) {
    const cancelled = await cancelAwaitingApprovalRun(expiredRunId);

    if (cancelled) {
      await saveMessage(expiredRunId, {
        role: "system",
        content:
          "Approval request expired. The action was not executed.",
      });
    }
  }
}

/** Background sweep so stale runs don't sit in awaiting_approval forever. */
export async function expireStaleApprovals(): Promise<void> {
  await expireStaleApprovalsFor();
}

/**
 * Shared checks for approve / reject. Returns the open approval request
 * or throws 404 / 409. Also lazily expires an overdue request.
 */
async function requirePendingApproval(
  runId: string,
): Promise<{ run: AgentRunRecord; approval: ApprovalRequest }> {
  await expireStaleApprovalsFor(runId);

  const run = await getAgentRunRecord(runId);

  if (!run) {
    throw new AgentRunNotFoundError();
  }

  if (run.status === "cancelled") {
    throw new AgentRunConflictError(
      "This request was cancelled or has expired",
    );
  }

  if (run.status !== "awaiting_approval") {
    throw new AgentRunConflictError(
      "This run is not waiting for approval",
    );
  }

  const approval = await getPendingApprovalRequest(runId);

  if (!approval) {
    throw new AgentRunConflictError(
      "This run has no pending approval request",
    );
  }

  return { run, approval };
}

/** The user approved: run exactly the stored tool call and continue. */
export async function approveAgentRun(
  runId: string,
): Promise<AgentRunResult> {
  const { approval } = await requirePendingApproval(runId);

  // Atomic claim: only one approve/reject/expiry can win.
  const claimed = await resolveApprovalRequest(
    approval.id,
    "approved",
  );

  if (!claimed) {
    throw new AgentRunConflictError(
      "This approval request was already resolved or has expired",
    );
  }

  await updateAgentRunRecord(runId, { status: "running" });

  await saveMessage(runId, {
    role: "system",
    content: `Approved by user: ${claimed.toolName}`,
  });

  return settleRun(runId, () =>
    resumeAgent(claimed.checkpoint, runId, {
      onMessage: (message) => saveMessage(runId, message),
    }),
  );
}

/** The user rejected: nothing runs and the run stops. */
export async function rejectAgentRun(
  runId: string,
): Promise<AgentRunResult> {
  const { approval } = await requirePendingApproval(runId);

  const claimed = await resolveApprovalRequest(
    approval.id,
    "rejected",
  );

  if (!claimed) {
    throw new AgentRunConflictError(
      "This approval request was already resolved or has expired",
    );
  }

  const cancelled = await cancelAwaitingApprovalRun(runId);

  if (!cancelled) {
    throw new AgentRunConflictError(
      "This run is no longer waiting for approval",
    );
  }

  await saveMessage(runId, {
    role: "system",
    content:
      `Rejected by user: ${claimed.toolName}. ` +
      "The action was not executed.",
  });

  return toRunResult(cancelled);
}

export async function listAgentRuns(
  limit: number,
): Promise<AgentRun[]> {
  const records = await getAgentRunRecords({ limit });

  return records.map(toAgentRun);
}

/** Returns null when the run does not exist. */
export async function getAgentRunDetails(
  runId: string,
): Promise<AgentRunDetails | null> {
  // Don't show an overdue approval as still actionable.
  await expireStaleApprovalsFor(runId);

  const record = await getAgentRunRecord(runId);

  if (!record) {
    return null;
  }

  const pendingApproval = await withSummary(
    record.status === "awaiting_approval"
      ? await getPendingApprovalRequest(runId)
      : null,
  );

  return {
    ...toRunResult(record, pendingApproval),
    messages: record.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
  };
}
