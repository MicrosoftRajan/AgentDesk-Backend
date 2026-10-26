export interface ToolContext {
  runId: string;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

/**
 * JSON Schema describing the tool's input.
 * Sent to the LLM so it knows how to call the tool.
 */
// `type` alias (not interface) so it is assignable to Record<string, unknown>.
export type ToolParameters = {
  type: "object";
  properties: Record<
    string,
    { type: string; description: string }
  >;
  required: string[];
};

/**
 * How much damage a tool can do if the model calls it wrongly.
 * The guardrail service maps this to allow / require_approval / deny.
 */
export type ToolRiskLevel = "low" | "medium" | "high";

export interface AgentTool {
  name: string;
  description: string;
  /** Required: a tool without a risk level cannot be registered. */
  riskLevel: ToolRiskLevel;
  parameters: ToolParameters;

  execute(
    input: unknown,
    context: ToolContext,
  ): Promise<ToolResult>;
}
