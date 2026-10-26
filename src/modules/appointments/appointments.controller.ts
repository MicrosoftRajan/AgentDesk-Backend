import type { Request, Response } from "express";

import { sendData, sendError } from "../../utils/http.js";
import { isUuid } from "../../utils/validation.js";

import {
  defaultAppointmentDate,
  getAppointmentForStaff,
  listAppointmentsForDay,
} from "./appointments.service.js";

/**
 * GET /api/v1/appointments?date=YYYY-MM-DD
 * Read-only list for one clinic day (IST). Defaults to today.
 * Writes that cancel or refund stay on the agent, behind approval.
 */
export async function listAppointmentsController(
  req: Request,
  res: Response,
): Promise<void> {
  const rawDate = req.query.date;
  const date =
    typeof rawDate === "string" ? rawDate : defaultAppointmentDate();

  try {
    const day = await listAppointmentsForDay(date);

    if (!day) {
      sendError(res, 400, "INVALID_DATE", "date must be a valid YYYY-MM-DD");
      return;
    }

    sendData(res, 200, day);
  } catch (error) {
    console.error(
      "Failed to list appointments:",
      error instanceof Error ? error.message : "unknown error",
    );

    sendError(res, 500, "APPOINTMENTS_FAILED", "Failed to load appointments");
  }
}

/**
 * GET /api/v1/appointments/:id
 * One appointment for clinic staff. Same fields as the day list.
 */
export async function getAppointmentController(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id;

  if (typeof id !== "string" || !isUuid(id)) {
    sendError(res, 400, "INVALID_ID", "Invalid appointment id.");
    return;
  }

  try {
    const appointment = await getAppointmentForStaff(id);

    if (!appointment) {
      sendError(res, 404, "NOT_FOUND", "Appointment not found");
      return;
    }

    sendData(res, 200, { appointment });
  } catch (error) {
    console.error(
      "Failed to load appointment:",
      error instanceof Error ? error.message : "unknown error",
    );

    sendError(res, 500, "APPOINTMENT_FAILED", "Failed to load appointment");
  }
}
