import type { RequestHandler } from "express";
import { AppError } from "../common/http";
import type { UserRole } from "../models/enums";
import { verifyAccessToken, type AccessClaims } from "../utils/jwt";

declare global {
  namespace Express {
    interface Locals {
      auth?: AccessClaims;
    }
  }
}

export const STAFF_ROLES = ["admin", "receptionist", "doctor"] as const satisfies readonly UserRole[];

const invalidToken = () => new AppError(401, "AUTH_INVALID_TOKEN", "Sign in again");

export function createAuthMiddleware(secret: Uint8Array, clock: () => Date) {
  const requireAuth: RequestHandler = async (req, res, next) => {
    const header = req.get("authorization");
    const match = header ? /^Bearer ([A-Za-z0-9._-]+)$/i.exec(header) : null;
    if (!match) return next(invalidToken());
    try {
      res.locals.auth = await verifyAccessToken(match[1]!, secret, clock());
      next();
    } catch {
      next(invalidToken());
    }
  };

  const requireRole =
    (...roles: readonly UserRole[]): RequestHandler =>
    (_req, res, next) => {
      const auth = res.locals.auth;
      if (!auth) return next(invalidToken());
      if (!roles.includes(auth.role)) {
        return next(new AppError(403, "AUTH_INSUFFICIENT_ROLE", "You do not have access to this"));
      }
      next();
    };

  return { requireAuth, requireRole };
}
