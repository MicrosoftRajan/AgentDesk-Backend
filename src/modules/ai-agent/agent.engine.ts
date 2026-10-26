import {
  generateAgentResponse,
  type AgentMessage,
} from "./llm.service.js";

import { evaluateTool } from "./guardrail.service.js";
import { getTool } from "./tools/tool.registry.js";

import type { RequestedToolCall } from "./llm.types.js";
import type {
  AgentCheckpoint,
  AgentExecutionResult,
  EngineMessage,
} from "./agent.types.js";
import type {
  AgentTool,
  ToolResult,
} from "./tools/tool.types.js";

const MAX_ITERATIONS = 5;
const MAX_TOOL_CALLS = 10;
const TOOL_TIMEOUT_MS = 10_000;

export class AgentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function failedResult(error: string): ToolResult {
  return { success: false, data: null, error };
}

/**
 * Executes a tool the guardrail has already cleared. Never throws:
 * bad arguments, tool failures and timeouts are returned as a failed
 * ToolResult so the model gets a chance to recover.
 */
async function runTool(
  tool: AgentTool,
  call: RequestedToolCall,
  runId: string,
): Promise<ToolResult> {
  try {
    return await withTimeout(
      tool.execute(call.input, { runId }),
      TOOL_TIMEOUT_MS,
      `Tool ${call.name}`,
    );
  } catch (error) {
    return failedResult(
      error instanceof Error
        ? error.message
        : `Tool ${call.name} failed`,
    );
  }
}

function toToolMessage(
  callId: string,
  result: ToolResult,
): AgentMessage {
  return {
    role: "tool",
    toolCallId: callId,
    content: describeToolResult(result),
  };
}

function describeToolResult(result: ToolResult): string {
  return JSON.stringify(
    result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error ?? "Tool failed" },
  );
}

export interface ExecuteAgentOptions {
  /** Relevant earlier context, passed to the model with the system prompt. */
  memoryContext?: string | null;
  /** Called for every message worth persisting, in conversation order. */
  onMessage?: (message: EngineMessage) => Promise<void>;
}

/** Mutable state of one run; this is exactly what a checkpoint captures. */
interface LoopState {
  messages: AgentMessage[];
  pendingCalls: RequestedToolCall[];
  iteration: number;
  toolCalls: number;
  memoryContext: string | null;
}

function toCheckpoint(state: LoopState): AgentCheckpoint {
  return {
    messages: [...state.messages],
    pendingCalls: [...state.pendingCalls],
    iteration: state.iteration,
    toolCalls: state.toolCalls,
    memoryContext: state.memoryContext,
  };
}

/**
 * The shared loop behind both a fresh run and a resumed one.
 *
 * Every tool call goes through the guardrail: the model proposes, the
 * backend disposes. A call that needs approval pauses the whole run;
 * `approvedCallId` lets exactly that one call through on resume.
 */
async function runLoop(
  state: LoopState,
  runId: string,
  options: ExecuteAgentOptions,
  approvedCallId?: string,
): Promise<AgentExecutionResult> {
  // Persistence is best-effort: a failed save must not abort the run.
  const record = async (message: EngineMessage) => {
    try {
      await options.onMessage?.(message);
    } catch (error) {
      console.error(
        `[agent:${runId}] failed to persist ${message.role} message:`,
        error,
      );
    }
  };

  while (true) {
    // 1. Finish the tool calls from the current assistant turn.
    while (state.pendingCalls.length > 0) {
      const call = state.pendingCalls[0]!;
      const tool = call.inputError ? undefined : getTool(call.name);

      let toolResult: ToolResult;

      if (call.inputError) {
        toolResult = failedResult(call.inputError);
      } else if (!tool) {
        toolResult = failedResult(`Unknown tool: ${call.name}`);
      } else {
        const decision = evaluateTool(tool);

        if (
          decision === "require_approval" &&
          call.callId !== approvedCallId
        ) {
          console.log(
            `[agent:${runId}] tool=${call.name} risk=${tool.riskLevel} ` +
              "-> awaiting approval",
          );

          return {
            type: "awaiting_approval",
            call,
            riskLevel: tool.riskLevel,
            checkpoint: toCheckpoint(state),
          };
        }

        if (decision === "deny") {
          console.warn(
            `[agent:${runId}] tool=${call.name} denied by guardrail`,
          );

          toolResult = failedResult(
            `Tool ${call.name} is blocked by policy and cannot be run.`,
          );
        } else {
          await record({
            role: "tool",
            content: `Call ${call.name}: ${JSON.stringify(call.input)}`,
          });

          toolResult = await runTool(tool, call, runId);
        }
      }

      await record({
        role: "tool",
        content: `Result ${call.name}: ${describeToolResult(toolResult)}`,
      });

      state.toolCalls++;
      state.messages.push(toToolMessage(call.callId, toolResult));
      state.pendingCalls.shift();

      console.log(
        `[agent:${runId}] iteration=${state.iteration} tool=${call.name} ` +
          `success=${toolResult.success}`,
      );
    }

    // 2. Ask the model what to do next.
    if (state.iteration >= MAX_ITERATIONS) {
      throw new AgentExecutionError(
        `Agent exceeded maximum execution iterations (${MAX_ITERATIONS})`,
      );
    }

    state.iteration++;

    const result = await generateAgentResponse(
      state.messages,
      state.memoryContext,
    );

    if (result.type === "final") {
      await record({ role: "assistant", content: result.text });

      return {
        type: "completed",
        response: result.text,
        toolCalls: state.toolCalls,
      };
    }

    if (state.toolCalls + result.calls.length > MAX_TOOL_CALLS) {
      throw new AgentExecutionError(
        `Agent exceeded maximum tool calls (${MAX_TOOL_CALLS})`,
      );
    }

    // assistant (tool calls) -> tool results, in that order.
    state.messages.push(result.assistantMessage);

    const toolPlan =
      result.assistantMessage.role === "assistant"
        ? result.assistantMessage.toolPlan?.trim()
        : undefined;

    if (toolPlan) {
      await record({ role: "assistant", content: toolPlan });
    }

    state.pendingCalls = [...result.calls];
  }
}

export async function executeAgent(
  goal: string,
  runId: string,
  options: ExecuteAgentOptions = {},
): Promise<AgentExecutionResult> {
  return runLoop(
    {
      messages: [{ role: "user", content: goal }],
      pendingCalls: [],
      iteration: 0,
      toolCalls: 0,
      memoryContext: options.memoryContext ?? null,
    },
    runId,
    options,
  );
}

/**
 * Continues a run that paused for approval. The first pending call in
 * the checkpoint is the approved one and is executed as-is; everything
 * after it still goes through the guardrail.
 */
export async function resumeAgent(
  checkpoint: AgentCheckpoint,
  runId: string,
  options: Pick<ExecuteAgentOptions, "onMessage"> = {},
): Promise<AgentExecutionResult> {
  const approved = checkpoint.pendingCalls[0];

  if (!approved) {
    throw new AgentExecutionError(
      "Checkpoint has no pending tool call to resume",
    );
  }

  return runLoop(
    {
      messages: [...checkpoint.messages],
      pendingCalls: [...checkpoint.pendingCalls],
      iteration: checkpoint.iteration,
      toolCalls: checkpoint.toolCalls,
      memoryContext: checkpoint.memoryContext,
    },
    runId,
    options,
    approved.callId,
  );
}
