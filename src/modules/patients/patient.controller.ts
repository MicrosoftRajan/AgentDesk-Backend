import type { Request, Response } from "express";

import { getAuthUser } from "../../middleware/authenticate.js";
import { HttpError, sendData, sendError } from "../../utils/http.js";
import { isUuid } from "../../utils/validation.js";

import {
  bookOwnAppointment,
  cancelOwnAppointment,
  getBookableSlots,
  listOwnAppointments,
  savePatientProfile,
  slotDateOrToday,
} from "./patient.service.js";
import { validateProfileBody } from "./patient.validator.js";

function sendFailure(res: Response, error: unknown, code: string, message: string): void {
  if (error instanceof HttpError) {
    sendError(res, error.statusCode, error.code, error.message);
    return;
  }

  console.error(message, error instanceof Error ? error.message : "unknown error");
  sendError(res, 500, code, message);
}

/**
 * PUT /api/v1/patient/profile  { fullName, phone }
 * Contact details used when booking. Role is not writable.
 * `email` is copied from the verified session so the client can replace
 * its cached account without dropping the address.
 */
export async function updatePatientProfileController(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = validateProfileBody(req.body);

  if (!parsed.ok) {
    sendError(res, 400, parsed.code, parsed.message);
    return;
  }

  const user = getAuthUser(req);

  try {
    const profile = await savePatientProfile(user.id, {
      fullName: parsed.fullName,
      phone: parsed.phone,
    });

    sendData(res, 200, {
      id: profile.id,
      email: user.email,
      role: profile.role,
      fullName: profile.fullName,
      phone: profile.phone,
    });
  } catch (error) {
    sendFailure(res, error, "PROFILE_UPDATE_FAILED", "Could not save your details");
  }
}

/**
 * GET /api/v1/patient/slots?date=YYYY-MM-DD
 * Free, bookable slots for one clinic day. Never says who holds a taken slot.
 */
export async function listSlotsController(
  req: Request,
  res: Response,
): Promise<void> {
  const date = slotDateOrToday(req.query.date);

  try {
    const slots = await getBookableSlots(date);
    sendData(res, 200, slots);
  } catch (error) {
    sendFailure(res, error, "SLOTS_FAILED", "Could not load available times");
  }
}

/** GET /api/v1/patient/appointments — the caller's own appointments only. */
export async function listPatientAppointmentsController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const appointments = await listOwnAppointments(getAuthUser(req).id);
    sendData(res, 200, { appointments });
  } catch (error) {
    sendFailure(res, error, "LIST_FAILED", "Could not load your appointments");
  }
}

/**
 * POST /api/v1/patient/appointments  { scheduledAt, reason? }
 * Books one of the offered slots for the caller.
 */
export async function bookPatientAppointmentController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const appointment = await bookOwnAppointment(getAuthUser(req).id, req.body);
    sendData(res, 201, { appointment });
  } catch (error) {
    sendFailure(res, error, "BOOK_FAILED", "Could not book your appointment");
  }
}

/**
 * POST /api/v1/patient/appointments/:id/cancel
 * Lets a patient cancel their own upcoming appointment. Refunds stay
 * behind staff approval in the agent.
 */
export async function cancelPatientAppointmentController(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id;

  if (typeof id !== "string" || !isUuid(id)) {
    sendError(res, 400, "INVALID_ID", "Invalid appointment id.");
    return;
  }

  try {
    const appointment = await cancelOwnAppointment(getAuthUser(req).id, id);
    sendData(res, 200, { appointment });
  } catch (error) {
    sendFailure(res, error, "CANCEL_FAILED", "Could not cancel your appointment");
  }
}
