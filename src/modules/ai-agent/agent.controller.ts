import type {
  Request,
  Response,
} from "express";

import { sendData, sendError } from "../../utils/http.js";
import { isUuid } from "../../utils/validation.js";

import {
  validateCreateAgentRunRequest,
} from "./agent.schema.js";

import {
  AgentRunConflictError,
  AgentRunNotFoundError,
  approveAgentRun,
  createAgentRun,
  getAgentRunDetails,
  listAgentRuns,
  rejectAgentRun,
} from "./agent.service.js";

import type { CreateAgentRunRequest } from "./agent.types.js";

function errorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}

export async function createAgentRunController(
  req: Request,
  res: Response,
): Promise<void> {
  let request: CreateAgentRunRequest;

  try {
    request = validateCreateAgentRunRequest(req.body);
  } catch (error) {
    sendError(
      res,
      400,
      "INVALID_REQUEST",
      errorMessage(error, "Invalid request"),
    );
    return;
  }

  try {
    const agentRun = await createAgentRun(request.goal);

    sendData(res, 201, agentRun);
  } catch (error) {
    console.error(
      "Agent run failed:",
      error instanceof Error ? error.message : "unknown error",
    );

    sendError(
      res,
      500,
      "AGENT_RUN_FAILED",
      errorMessage(error, "Agent run failed"),
    );
  }
}

const DEFAULT_RUNS_LIMIT = 50;
const MAX_RUNS_LIMIT = 100;

export async function listAgentRunsController(
  req: Request,
  res: Response,
): Promise<void> {
  const rawLimit = req.query.limit;
  let limit = DEFAULT_RUNS_LIMIT;

  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);

    if (!Number.isInteger(parsed) || parsed < 1) {
      sendError(res, 400, "INVALID_LIMIT", "limit must be a positive integer");
      return;
    }

    limit = Math.min(parsed, MAX_RUNS_LIMIT);
  }

  try {
    const runs = await listAgentRuns(limit);

    sendData(res, 200, runs);
  } catch (error) {
    console.error(
      "Failed to list agent runs:",
      error instanceof Error ? error.message : "unknown error",
    );

    sendError(
      res,
      500,
      "AGENT_RUNS_FAILED",
      errorMessage(error, "Failed to fetch agent runs"),
    );
  }
}

export async function getAgentRunController(
  req: Request,
  res: Response,
): Promise<void> {
  const runId = req.params.runId;

  if (typeof runId !== "string" || !isUuid(runId)) {
    sendError(res, 400, "INVALID_ID", "runId must be a valid UUID");
    return;
  }

  try {
    const run = await getAgentRunDetails(runId);

    if (!run) {
      sendError(res, 404, "NOT_FOUND", "Agent run not found");
      return;
    }

    sendData(res, 200, run);
  } catch (error) {
    console.error(
      "Failed to fetch agent run:",
      error instanceof Error ? error.message : "unknown error",
    );

    sendError(
      res,
      500,
      "AGENT_RUN_FETCH_FAILED",
      errorMessage(error, "Failed to fetch agent run"),
    );
  }
}

type RunDecision = typeof approveAgentRun;

/**
 * Shared handler for approve/reject. Only a human hitting this
 * endpoint can resolve an approval; the agent has no way to call it.
 */
function decisionController(
  decide: RunDecision,
  failureMessage: string,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const runId = req.params.runId;

    if (typeof runId !== "string" || !isUuid(runId)) {
      sendError(res, 400, "INVALID_ID", "runId must be a valid UUID");
      return;
    }

    try {
      const run = await decide(runId);

      sendData(res, 200, run);
    } catch (error) {
      if (error instanceof AgentRunNotFoundError) {
        sendError(res, 404, "NOT_FOUND", error.message);
        return;
      }

      if (error instanceof AgentRunConflictError) {
        sendError(res, 409, "CONFLICT", error.message);
        return;
      }

      console.error(
        `${failureMessage}:`,
        error instanceof Error ? error.message : "unknown error",
      );

      sendError(res, 500, "AGENT_DECISION_FAILED", errorMessage(error, failureMessage));
    }
  };
}

export const approveAgentRunController = decisionController(
  approveAgentRun,
  "Failed to approve agent run",
);

export const rejectAgentRunController = decisionController(
  rejectAgentRun,
  "Failed to reject agent run",
);
