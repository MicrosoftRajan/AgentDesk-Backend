import type { RequestHandler } from "express"; // Ek Middle ware Type hai
import type { ZodType } from "zod"; // Zod ek validation library hai
import { AppError } from "../common/http";



// This Func takes the schema -> it ensures that the data recive from client is valid, so that controller need not to be handle data
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    // safeParse() -> Validation check and if error hits, instead of crash the app return res
    const result = schema.safeParse(req.body ?? {});
    if (result.success) {
      req.body = result.data;
      return next();
    }
    // if data is invalid
    const details = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      rule: issue.code,
    }));

    // Send Error in next phase
    next(new AppError(400, "VALIDATION_ERROR", "Request body is invalid", details));
  };
}

/* Schemas for each part of a request. Any part left out is not read by the handler. */
export type RequestSchemas = {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
};

/* The parsed, trusted values a handler reads. Express 5 makes req.query read-only,
so parsed params and query live on res.locals.input; the parsed body also replaces req.body. */
export type ValidInput = { params: unknown; query: unknown; body: unknown };

declare global {
  namespace Express {
    interface Locals {
      input?: ValidInput;
    }
  }
}

/* Validates params, query and body together and reports every problem at once.
Detail paths are prefixed with the part, e.g. "params.id" or "query.date".
Only the rule name is returned, never the rejected value. */
export function validate(schemas: RequestSchemas): RequestHandler {
  const parts = ["params", "query", "body"] as const;
  return (req, res, next) => {
    const input: ValidInput = { params: {}, query: {}, body: undefined };
    const details: { path: string; rule: string }[] = [];

    for (const part of parts) {
      const schema = schemas[part];
      if (!schema) continue;
      const raw = part === "body" ? (req.body ?? {}) : req[part];
      const result = schema.safeParse(raw);
      if (result.success) {
        input[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ path: [part, ...issue.path.map(String)].join("."), rule: issue.code });
        }
      }
    }

    if (details.length > 0) return next(new AppError(400, "VALIDATION_ERROR", "Request is invalid", details));
    if (schemas.body) req.body = input.body;
    res.locals.input = input;
    next();
  };
}
