import type { Request, Response } from "express";

import { getAuthUser } from "../../middleware/authenticate.js";
import { sendData, sendError } from "../../utils/http.js";

import { getOrCreateProfile } from "./profile.service.js";

/**
 * GET /api/v1/me
 * Who am I and what role do I have? The app calls this after sign-in to
 * decide whether to show the staff or the patient side.
 */
export async function getMeController(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(req);

  try {
    const profile = await getOrCreateProfile(user.id);

    sendData(res, 200, {
      id: user.id,
      email: user.email,
      role: profile.role,
      fullName: profile.fullName,
      phone: profile.phone,
    });
  } catch (error) {
    console.error(
      "Failed to load profile:",
      error instanceof Error ? error.message : "unknown error",
    );

    sendError(
      res,
      503,
      "ROLE_UNAVAILABLE",
      "Could not load your account. Please try again.",
    );
  }
}
