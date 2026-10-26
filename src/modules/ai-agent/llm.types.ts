import type { Cohere } from "cohere-ai";

type ChatMessageV2 = Cohere.ChatMessageV2;

export interface FinalLLMResult {
  type: "final";
  text: string;
}

/**
 * A single tool invocation requested by the model.
 * `input` is the raw JSON-parsed arguments (validated by the tool itself).
 * If the arguments could not be parsed, `inputError` is set instead.
 */
export interface RequestedToolCall {
  callId: string;
  name: string;
  input: unknown;
  inputError?: string;
}

/**
 * The model may request several tools in one turn (parallel tool calls).
 * Every call must receive a tool result message, otherwise Cohere rejects
 * the next request — so we always carry the full list.
 */
export interface ToolCallLLMResult {
  type: "tool_call";
  calls: RequestedToolCall[];
  /** Assistant message to append to the conversation history as-is. */
  assistantMessage: ChatMessageV2;
}

export type LLMResult = FinalLLMResult | ToolCallLLMResult;
