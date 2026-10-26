import type { NextFunction, Request, Response } from "express";

import { supabase } from "../config/supabase.js";
import type { AuthUser } from "../types/auth.js";
import { sendError } from "../utils/http.js";

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;

  if (!header) {
    return null;
  }

  return BEARER_PATTERN.exec(header)?.[1] ?? null;
}

type VerifyResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Asks Supabase Auth whether the access token is valid. Going to the
 * Auth server (instead of only decoding the JWT) also catches users
 * who were deleted or signed out.
 */
async function verifyAccessToken(token: string): Promise<VerifyResult> {
  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      const status = error?.status;

      // 4xx = the token itself is the problem. Anything else (network,
      // 5xx) means we could not check, which is not the caller's fault.
      if (status !== undefined && status >= 400 && status < 500) {
        return { ok: false, reason: "invalid" };
      }

      if (!error) {
        return { ok: false, reason: "invalid" };
      }

      console.error("Auth verification unavailable:", error.message);
      return { ok: false, reason: "unavailable" };
    }

    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email ?? null },
    };
  } catch (error) {
    console.error(
      "Auth verification threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Authentication: "who are you?". Requires `Authorization: Bearer <token>`
 * where the token is a Supabase Auth access token, and attaches the
 * identified user to `req.user`. The user id comes from Supabase Auth,
 * never from the request body. Authorization is a separate step.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);

  if (!token) {
    sendError(res, 401, "UNAUTHENTICATED", "Authentication is required");
    return;
  }

  const result = await verifyAccessToken(token);

  if (!result.ok) {
    if (result.reason === "unavailable") {
      sendError(
        res,
        503,
        "AUTH_UNAVAILABLE",
        "Authentication service is temporarily unavailable",
      );
      return;
    }

    sendError(
      res,
      401,
      "INVALID_TOKEN",
      "Your session is invalid or has expired. Please sign in again.",
    );
    return;
  }

  req.user = result.user;
  next();
}

/** For handlers behind `requireAuth`: the user, or a loud failure. */
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error("getAuthUser called on a route without requireAuth");
  }

  return req.user;
}
