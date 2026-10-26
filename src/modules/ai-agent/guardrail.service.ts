import type { AgentTool } from "./tools/tool.types.js";

export type GuardrailDecision =
  | "allow"
  | "require_approval"
  | "deny";

/** How long a human has to answer an approval request. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;

/**
 * The LLM decides what it wants to do; this decides whether it may.
 * Anything not explicitly understood is denied (fail closed).
 */
export function evaluateTool(
  tool: AgentTool,
): GuardrailDecision {
  switch (tool.riskLevel) {
    case "low":
      return "allow";

    case "medium":
    case "high":
      return "require_approval";

    default:
      return "deny";
  }
}
