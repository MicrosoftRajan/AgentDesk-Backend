import type { ErrorRequestHandler, RequestHandler } from "express";
import { errorCode } from "./error-code";
import { AppError, sendError } from "./http";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) return sendError(res, error);

  const type = (error as { type?: unknown }).type;
  if (type === "entity.parse.failed") {
    return sendError(res, new AppError(400, "VALIDATION_ERROR", "Request body is not valid JSON"));
  }
  if (type === "entity.too.large") {
    return sendError(res, new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large"));
  }
  if (typeof type === "string" && (error as { status?: number }).status === 400) {
    return sendError(res, new AppError(400, "VALIDATION_ERROR", "Request body could not be read"));
  }

  console.error(`Unhandled request error: ${errorCode(error)}`);
  sendError(res, new AppError(500, "INTERNAL_SERVER_ERROR", "Something went wrong"));
};
