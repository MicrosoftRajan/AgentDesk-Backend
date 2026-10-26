import type { NextFunction, Request, Response } from "express";

import { getOrCreateProfile } from "../modules/profiles/profile.service.js";
import type { UserRole } from "../types/auth.js";
import { sendError } from "../utils/http.js";

import { getAuthUser } from "./authenticate.js";

/**
 * Authorization: "what may you do?". Must run after `requireAuth`.
 * The role is read from `profiles` on the server. A role sent by the
 * client is ignored. A missing profile becomes `patient`, so a new
 * sign-up cannot grant itself staff access.
 */
export function requireRole(...allowed: UserRole[]) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = getAuthUser(req);
      const profile = await getOrCreateProfile(user.id);

      if (!allowed.includes(profile.role)) {
        sendError(
          res,
          403,
          "FORBIDDEN",
          "You do not have access to this resource",
        );
        return;
      }

      user.role = profile.role;
      next();
    } catch (error) {
      console.error(
        "Role check failed:",
        error instanceof Error ? error.message : "unknown error",
      );

      sendError(
        res,
        503,
        "ROLE_UNAVAILABLE",
        "Could not verify your access. Please try again.",
      );
    }
  };
}
