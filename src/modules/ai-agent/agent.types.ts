import type {
  AgentMessage,
} from "./llm.service.js";
import type { RequestedToolCall } from "./llm.types.js";
import type { ToolRiskLevel } from "./tools/tool.types.js";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentMessageRole =
  | "user"
  | "assistant"
  | "tool"
  | "system";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export interface CreateAgentRunRequest {
  goal: string;
}

export interface AgentRun {
  id: string;
  goal: string;
  status: AgentRunStatus;
  createdAt: string;
  response: string | null;
  completedAt: string | null;
}

/** Plain-language description of an approval, shown instead of raw ids. */
export interface ApprovalSummary {
  title: string;
  lines: { label: string; value: string }[];
}

/** What the user is being asked to approve. Safe to send to the client. */
export interface ApprovalRequest {
  id: string;
  runId: string;
  toolName: string;
  toolInput: unknown;
  riskLevel: ToolRiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  /** Added by the service when it can describe the action; optional. */
  summary?: ApprovalSummary | null;
}

/** Result of creating / approving / rejecting a run. */
export interface AgentRunResult extends AgentRun {
  pendingApproval: ApprovalRequest | null;
}

export interface AgentRunMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

export interface AgentRunDetails extends AgentRunResult {
  messages: AgentRunMessage[];
}

/** A message the engine wants persisted (the run id is added by the caller). */
export interface EngineMessage {
  role: AgentMessageRole;
  content: string;
}

/**
 * Everything the engine needs to continue a paused run later.
 * Stored server-side with the approval request; never sent to clients.
 */
export interface AgentCheckpoint {
  /** Conversation so far, including the assistant turn that requested the tools. */
  messages: AgentMessage[];
  /** Calls from the current assistant turn that have no result yet; the first one awaits approval. */
  pendingCalls: RequestedToolCall[];
  /** LLM turns used so far. */
  iteration: number;
  /** Tool calls executed so far. */
  toolCalls: number;
  memoryContext: string | null;
}

export type AgentExecutionResult =
  | {
      type: "completed";
      response: string;
      toolCalls: number;
    }
  | {
      type: "awaiting_approval";
      call: RequestedToolCall;
      riskLevel: ToolRiskLevel;
      checkpoint: AgentCheckpoint;
    };
