import type { Response } from "express";

import type { ApiFailure, ApiSuccess } from "../types/http.js";

export function sendData<T>(
  res: Response,
  status: number,
  data: T,
): void {
  const body: ApiSuccess<T> = { success: true, data };
  res.status(status).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  const body: ApiFailure = {
    success: false,
    error: { code, message },
  };
  res.status(status).json(body);
}

/** Expected request failure with an HTTP status and a stable error code. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
