import { supabase } from "../../config/supabase.js";

import type {
  AgentCheckpoint,
  ApprovalRequest,
  ApprovalStatus,
} from "./agent.types.js";
import type { ToolRiskLevel } from "./tools/tool.types.js";

const APPROVAL_COLUMNS =
  "id, run_id, tool_call_id, tool_name, tool_input, risk_level, " +
  "status, created_at, expires_at, resolved_at";

const APPROVAL_WITH_CHECKPOINT_COLUMNS = `${APPROVAL_COLUMNS}, checkpoint`;

/** An approval plus the server-only state needed to resume the run. */
export interface ApprovalRecord extends ApprovalRequest {
  toolCallId: string;
  checkpoint: AgentCheckpoint;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  tool_call_id: string;
  tool_name: string;
  tool_input: unknown;
  risk_level: string;
  status: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  checkpoint?: unknown;
}

function toApprovalRequest(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    runId: row.run_id,
    toolName: row.tool_name,
    toolInput: row.tool_input,
    riskLevel: row.risk_level as ToolRiskLevel,
    status: row.status as ApprovalStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

function toApprovalRecord(row: ApprovalRow): ApprovalRecord {
  return {
    ...toApprovalRequest(row),
    toolCallId: row.tool_call_id,
    checkpoint: row.checkpoint as AgentCheckpoint,
  };
}

export async function createApprovalRequestRecord(input: {
  runId: string;
  toolCallId: string;
  toolName: string;
  toolInput: unknown;
  riskLevel: ToolRiskLevel;
  expiresAt: string;
  checkpoint: AgentCheckpoint;
}): Promise<ApprovalRequest> {
  const { data, error } = await supabase
    .from("approval_requests")
    .insert({
      run_id: input.runId,
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      tool_input: input.toolInput ?? {},
      risk_level: input.riskLevel,
      status: "pending",
      expires_at: input.expiresAt,
      checkpoint: input.checkpoint,
    })
    .select(APPROVAL_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to create approval request: ${error.message}`,
    );
  }

  return toApprovalRequest(data as unknown as ApprovalRow);
}

/** The run's open approval request (at most one), or null. */
export async function getPendingApprovalRequest(
  runId: string,
): Promise<ApprovalRequest | null> {
  const { data, error } = await supabase
    .from("approval_requests")
    .select(APPROVAL_COLUMNS)
    .eq("run_id", runId)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch approval request: ${error.message}`,
    );
  }

  return data ? toApprovalRequest(data as unknown as ApprovalRow) : null;
}

/**
 * Atomically moves a *pending, unexpired* request to approved/rejected.
 * Returns null if it was already resolved or has expired, so two
 * concurrent taps can never both win.
 */
export async function resolveApprovalRequest(
  approvalId: string,
  status: "approved" | "rejected",
): Promise<ApprovalRecord | null> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("approval_requests")
    .update({ status, resolved_at: now })
    .eq("id", approvalId)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select(APPROVAL_WITH_CHECKPOINT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve approval request: ${error.message}`,
    );
  }

  return data ? toApprovalRecord(data as unknown as ApprovalRow) : null;
}

/**
 * Marks pending requests past their deadline as expired and returns
 * the ids of the runs they belonged to. Pass `runId` to limit to one run.
 */
export async function expireStaleApprovalRequests(
  runId?: string,
): Promise<string[]> {
  const now = new Date().toISOString();

  let query = supabase
    .from("approval_requests")
    .update({ status: "expired", resolved_at: now })
    .eq("status", "pending")
    .lte("expires_at", now);

  if (runId) {
    query = query.eq("run_id", runId);
  }

  const { data, error } = await query.select("run_id");

  if (error) {
    throw new Error(
      `Failed to expire approval requests: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => row.run_id as string);
}
