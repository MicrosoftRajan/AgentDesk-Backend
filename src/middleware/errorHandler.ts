import type { NextFunction, Request, Response } from "express";

import { sendError } from "../utils/http.js";

function isJsonParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const parsed = error as SyntaxError & { status?: number; type?: string };

  return parsed.status === 400 && parsed.type === "entity.parse.failed";
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(
    res,
    404,
    "NOT_FOUND",
    `No route for ${req.method} ${req.path}`,
  );
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isJsonParseError(error)) {
    sendError(res, 400, "INVALID_JSON", "Request body must be valid JSON");
    return;
  }

  console.error(
    "Unhandled error:",
    error instanceof Error ? error.message : "unknown error",
  );

  sendError(res, 500, "INTERNAL_ERROR", "Something went wrong");
}
