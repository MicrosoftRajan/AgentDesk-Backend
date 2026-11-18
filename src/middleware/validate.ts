import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "../common/http";

export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (result.success) {
      req.body = result.data;
      return next();
    }
    const details = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      rule: issue.code,
    }));
    next(new AppError(400, "VALIDATION_ERROR", "Request body is invalid", details));
  };
}
