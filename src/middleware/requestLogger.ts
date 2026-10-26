import type { NextFunction, Request, Response } from "express";

/**
 * Logs method, path, status, and duration.
 * Query strings, headers, and bodies are omitted so tokens and patient
 * details are not written to logs.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0] ?? req.path;
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    console.log(
      `${req.method} ${path} ${res.statusCode} ${elapsedMs.toFixed(0)}ms`,
    );
  });

  next();
}
