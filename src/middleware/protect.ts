/* One way to build protected routes, so every module runs the checks in the order AGENTS.md sets:
   CORS → rate limit (both app-wide in app.ts) → login token → role → request validation → handler.

   protectedRouter() checks the token once for every request that reaches the router, so a route
   added without protect() still needs a valid token. protect(roles, schemas) adds the role check,
   then validation. requireRole also fails closed (401) if the token step is somehow missing. */
import { Router, type RequestHandler } from "express";
import { userRole, type UserRole } from "../models/enums";
import { validate, type RequestSchemas } from "./validate";

/* Every role. Use it when a route is open to anyone who is signed in. */
export const ANY_SIGNED_IN: readonly UserRole[] = userRole.enumValues;

const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};

export function createProtection(guards: {
  requireAuth: RequestHandler;
  requireRole: (...roles: readonly UserRole[]) => RequestHandler;
}) {
  function protectedRouter(): Router {
    const router = Router();
    router.use(noStore, guards.requireAuth);
    return router;
  }

  function protect(roles: readonly UserRole[], schemas: RequestSchemas = {}): RequestHandler[] {
    if (roles.length === 0) throw new Error("protect() needs at least one role");
    return [guards.requireRole(...roles), validate(schemas)];
  }

  return { protectedRouter, protect };
}

export type Protection = ReturnType<typeof createProtection>;
