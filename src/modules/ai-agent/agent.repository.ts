import { supabase } from "../../config/supabase.js";

import type {
  AgentMessageRole,
  AgentRunStatus,
} from "./agent.types.js";

const RUN_COLUMNS =
  "id, goal, status, response, created_at, completed_at";

const MESSAGE_COLUMNS =
  "id, run_id, role, content, created_at";

export interface AgentRunRecord {
  id: string;
  goal: string;
  status: AgentRunStatus;
  response: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MessageRecord {
  id: string;
  runId: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

export interface AgentRunWithMessages extends AgentRunRecord {
  messages: MessageRecord[];
}

interface RunRow {
  id: string;
  goal: string;
  status: string;
  response: string | null;
  created_at: string;
  completed_at: string | null;
}

interface MessageRow {
  id: string;
  run_id: string;
  role: string;
  content: string;
  created_at: string;
}

function toRunRecord(row: RunRow): AgentRunRecord {
  return {
    id: row.id,
    goal: row.goal,
    status: row.status as AgentRunStatus,
    response: row.response,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function toMessageRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    runId: row.run_id,
    role: row.role as AgentMessageRole,
    content: row.content,
    createdAt: row.created_at,
  };
}

interface CreateAgentRunInput {
  goal: string;
}

export async function createAgentRunRecord(
  input: CreateAgentRunInput,
): Promise<AgentRunRecord> {
  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      goal: input.goal,
      status: "pending",
    })
    .select(RUN_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to create agent run: ${error.message}`,
    );
  }

  return toRunRecord(data);
}

interface UpdateAgentRunInput {
  status: AgentRunStatus;
  response?: string | null;
  completedAt?: string | null;
}

export async function updateAgentRunRecord(
  runId: string,
  input: UpdateAgentRunInput,
): Promise<AgentRunRecord> {
  const patch: Record<string, unknown> = {
    status: input.status,
  };

  if (input.response !== undefined) {
    patch.response = input.response;
  }

  if (input.completedAt !== undefined) {
    patch.completed_at = input.completedAt;
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .update(patch)
    .eq("id", runId)
    .select(RUN_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to update agent run: ${error.message}`,
    );
  }

  return toRunRecord(data);
}

/**
 * Cancels a run only if it is still awaiting approval. Returns null when
 * the run is in any other state (so a late call can't clobber a finished run).
 */
export async function cancelAwaitingApprovalRun(
  runId: string,
): Promise<AgentRunRecord | null> {
  const { data, error } = await supabase
    .from("agent_runs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "awaiting_approval")
    .select(RUN_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to cancel agent run: ${error.message}`,
    );
  }

  return data ? toRunRecord(data) : null;
}

/** Newest runs first. */
export async function getAgentRuns(
  options: {
    limit?: number;
    status?: AgentRunStatus;
    excludeRunId?: string;
  } = {},
): Promise<AgentRunRecord[]> {
  let query = supabase
    .from("agent_runs")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false });

  if (options.status) {
    query = query.eq("status", options.status);
  }

  if (options.excludeRunId) {
    query = query.neq("id", options.excludeRunId);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to fetch agent runs: ${error.message}`,
    );
  }

  return (data ?? []).map(toRunRecord);
}

/** Returns null when the run does not exist. Messages are oldest first. */
export async function getAgentRun(
  runId: string,
): Promise<AgentRunWithMessages | null> {
  const { data, error } = await supabase
    .from("agent_runs")
    .select(
      `
      ${RUN_COLUMNS},
      messages (
        id,
        run_id,
        role,
        content,
        created_at
      )
      `,
    )
    .eq("id", runId)
    .order("created_at", {
      ascending: true,
      referencedTable: "messages",
    })
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch agent run: ${error.message}`,
    );
  }

  if (!data) {
    return null;
  }

  const { messages, ...run } = data as unknown as RunRow & {
    messages: MessageRow[] | null;
  };

  return {
    ...toRunRecord(run),
    messages: (messages ?? []).map(toMessageRecord),
  };
}

export async function createMessage(input: {
  runId: string;
  role: AgentMessageRole;
  content: string;
}): Promise<MessageRecord> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      run_id: input.runId,
      role: input.role,
      content: input.content,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to create message: ${error.message}`,
    );
  }

  return toMessageRecord(data);
}
