import {
  countUpcomingPatientAppointments,
  cancelScheduledPatientAppointment,
  findPatientAppointment,
  insertPatientAppointment,
  isUniqueViolation,
  listPatientAppointments,
  listScheduledStartTimes,
} from "../appointments/appointment.repository.js";
import {
  clinicDayEnd,
  clinicDayStart,
  isBookableInTime,
  isClinicOpen,
  isWithinBookingWindow,
  slotsForDay,
  todayInClinic,
} from "../appointments/clinicSchedule.js";
import type { PatientAppointment } from "../appointments/appointment.types.js";
import {
  getOrCreateProfile,
  updateProfileDetails,
} from "../profiles/profile.service.js";
import type { Profile } from "../profiles/profile.types.js";
import { HttpError } from "../../utils/http.js";

import {
  parseReason,
  parseScheduledAt,
  rejectInvalid,
} from "./patient.validator.js";

/** A patient can't hold more than this many upcoming appointments. */
const MAX_ACTIVE_APPOINTMENTS = 3;
const MAX_LIST_RESULTS = 100;

export interface PatientProfileResponse {
  id: string;
  role: Profile["role"];
  fullName: string | null;
  phone: string | null;
}

function toProfileResponse(profile: Profile): PatientProfileResponse {
  return {
    id: profile.id,
    role: profile.role,
    fullName: profile.fullName,
    phone: profile.phone,
  };
}

export async function savePatientProfile(
  userId: string,
  details: { fullName: string; phone: string },
): Promise<PatientProfileResponse> {
  const profile = await updateProfileDetails(userId, details);
  return toProfileResponse(profile);
}

export async function getBookableSlots(date: string, now: Date = new Date()) {
  const start = clinicDayStart(date);

  if (!start) {
    throw new HttpError(400, "INVALID_DATE", "date must be a valid YYYY-MM-DD");
  }

  if (!isWithinBookingWindow(date, now)) {
    throw new HttpError(
      400,
      "OUT_OF_WINDOW",
      "That day is outside the booking window.",
    );
  }

  if (!isClinicOpen(date)) {
    return { date, isOpen: false as const, slots: [] };
  }

  const takenRows = await listScheduledStartTimes(
    start.toISOString(),
    clinicDayEnd(start).toISOString(),
  );

  const taken = new Set(
    takenRows.map((scheduledAt) => new Date(scheduledAt).toISOString()),
  );

  const slots = slotsForDay(date)
    .filter((slot) => !taken.has(slot) && isBookableInTime(slot, now))
    .map((startsAt) => ({ startsAt }));

  return { date, isOpen: true as const, slots };
}

export async function listOwnAppointments(
  userId: string,
): Promise<PatientAppointment[]> {
  return listPatientAppointments(userId, MAX_LIST_RESULTS);
}

export function slotDateOrToday(rawDate: unknown, now: Date = new Date()): string {
  return typeof rawDate === "string" ? rawDate : todayInClinic(now);
}

/**
 * Books one published slot for the signed-in patient.
 * The user id is the verified auth id, not a value from the body.
 */
export async function bookOwnAppointment(
  userId: string,
  body: unknown,
  now: Date = new Date(),
): Promise<PatientAppointment> {
  const scheduled = parseScheduledAt(body);

  if (!scheduled.ok) {
    rejectInvalid(scheduled);
  }

  const clinicDate = todayInClinic(new Date(scheduled.scheduledAt));

  // Only exact slots from the published schedule can be booked.
  if (
    !isWithinBookingWindow(clinicDate, now) ||
    !slotsForDay(clinicDate).includes(scheduled.scheduledAt)
  ) {
    throw new HttpError(
      400,
      "INVALID_SLOT",
      "That is not an available appointment time.",
    );
  }

  if (!isBookableInTime(scheduled.scheduledAt, now)) {
    throw new HttpError(
      400,
      "TOO_SOON",
      "Please choose a time at least an hour from now.",
    );
  }

  const reason = parseReason(body);

  if (!reason.ok) {
    rejectInvalid(reason);
  }

  const profile = await getOrCreateProfile(userId);

  if (!profile.fullName || !profile.phone) {
    throw new HttpError(
      400,
      "PROFILE_INCOMPLETE",
      "Add your name and phone number before booking.",
    );
  }

  const upcoming = await countUpcomingPatientAppointments(
    userId,
    now.toISOString(),
  );

  if (upcoming >= MAX_ACTIVE_APPOINTMENTS) {
    throw new HttpError(
      409,
      "TOO_MANY_APPOINTMENTS",
      `You can have up to ${MAX_ACTIVE_APPOINTMENTS} upcoming appointments. Cancel one to book another.`,
    );
  }

  try {
    return await insertPatientAppointment({
      userId,
      patientName: profile.fullName,
      patientPhone: profile.phone,
      scheduledAt: scheduled.scheduledAt,
      reason: reason.reason,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(
        409,
        "SLOT_TAKEN",
        "That time was just booked. Please pick another.",
      );
    }

    throw error;
  }
}

/**
 * Cancels the caller's own upcoming appointment.
 * A missing row and someone else's row both look like not found.
 */
export async function cancelOwnAppointment(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<PatientAppointment> {
  const existing = await findPatientAppointment(id, userId);

  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "Appointment not found.");
  }

  if (existing.status !== "scheduled") {
    throw new HttpError(
      409,
      "NOT_CANCELLABLE",
      `This appointment is already ${existing.status.replace("_", "-")}.`,
    );
  }

  if (Date.parse(existing.scheduledAt) <= now.getTime()) {
    throw new HttpError(
      409,
      "ALREADY_PASSED",
      "This appointment time has already passed.",
    );
  }

  const updated = await cancelScheduledPatientAppointment(id, userId);

  if (!updated) {
    throw new HttpError(
      409,
      "CHANGED",
      "This appointment just changed. Refresh and try again.",
    );
  }

  return updated;
}
