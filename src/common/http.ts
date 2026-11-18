import type { Response } from "express";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "PHONE_TAKEN"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_INSUFFICIENT_ROLE"
  | "INVALID_REFRESH_TOKEN"
  | "INVALID_RESET_TOKEN"
  | "INVALID_VERIFICATION_TOKEN"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_SERVER_ERROR";

export type ErrorDetail = { path: string; rule: string };

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

const meta = () => ({ timestamp: new Date().toISOString() });

export function errorBody(code: ErrorCode, message: string, details?: ErrorDetail[]) {
  return { success: false as const, error: { code, message, ...(details ? { details } : {}) }, meta: meta() };
}

export function sendData(res: Response, status: number, data: unknown): void {
  res.status(status).json({ success: true, data, meta: meta() });
}

export function sendError(res: Response, error: AppError): void {
  res.status(error.status).json(errorBody(error.code, error.message, error.details));
}
