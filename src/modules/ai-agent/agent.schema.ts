import type {
  CreateAgentRunRequest,
} from "./agent.types.js";

const MAX_GOAL_LENGTH = 2000;

export function validateCreateAgentRunRequest(
  body: unknown,
): CreateAgentRunRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object");
  }

  const request = body as Record<string, unknown>;

  if (typeof request.goal !== "string") {
    throw new Error("goal must be a string");
  }

  const goal = request.goal.trim();

  if (!goal) {
    throw new Error("goal is required");
  }

  if (goal.length > MAX_GOAL_LENGTH) {
    throw new Error(
      `goal must not exceed ${MAX_GOAL_LENGTH} characters`,
    );
  }

  return {
    goal,
  };
}
