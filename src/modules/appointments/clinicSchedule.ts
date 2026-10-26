/**
 * Bookable slots for the patient portal.
 *
 * The clinic runs on IST (no daylight saving), so a fixed +05:30 offset
 * is correct. Change the constants below to change the schedule.
 */

const CLINIC_OFFSET = "+05:30";
const DAY_MS = 24 * 60 * 60 * 1000;

/** First and last slot START times, in clinic-local minutes since midnight. */
const FIRST_SLOT_MINUTES = 10 * 60; // 10:00
const LAST_SLOT_MINUTES = 17 * 60 + 30; // 17:30
const SLOT_LENGTH_MINUTES = 30;

/** 0 = Sunday ... 6 = Saturday. The clinic is closed on Sundays. */
const CLOSED_WEEKDAYS: readonly number[] = [0];

/** Patients can't book a slot that starts sooner than this. */
export const MIN_LEAD_TIME_MS = 60 * 60 * 1000;

/** How far ahead patients can book. */
export const MAX_DAYS_AHEAD = 30;

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today's clinic date as YYYY-MM-DD. */
export function todayInClinic(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Start of a clinic day as a Date, or null if `date` isn't a real day. */
export function clinicDayStart(date: string): Date | null {
  if (!DATE_PATTERN.test(date)) {
    return null;
  }

  const start = new Date(`${date}T00:00:00${CLINIC_OFFSET}`);

  // Rejects things like 2026-02-31 that Date would silently roll over.
  if (
    Number.isNaN(start.getTime()) ||
    todayInClinic(start) !== date
  ) {
    return null;
  }

  return start;
}

export function clinicDayEnd(start: Date): Date {
  return new Date(start.getTime() + DAY_MS);
}

/** Whether the clinic is open at all on this day. */
export function isClinicOpen(date: string): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  return !CLOSED_WEEKDAYS.includes(weekday);
}

/** Every slot start (UTC ISO) in a clinic day, ignoring bookings. */
export function slotsForDay(date: string): string[] {
  const start = clinicDayStart(date);

  if (!start || !isClinicOpen(date)) {
    return [];
  }

  const slots: string[] = [];

  for (
    let minutes = FIRST_SLOT_MINUTES;
    minutes <= LAST_SLOT_MINUTES;
    minutes += SLOT_LENGTH_MINUTES
  ) {
    slots.push(new Date(start.getTime() + minutes * 60_000).toISOString());
  }

  return slots;
}

/** Whether a day is inside the window patients may book in. */
export function isWithinBookingWindow(
  date: string,
  now: Date = new Date(),
): boolean {
  const today = clinicDayStart(todayInClinic(now));
  const day = clinicDayStart(date);

  if (!today || !day) {
    return false;
  }

  const daysAhead = Math.round((day.getTime() - today.getTime()) / DAY_MS);

  return daysAhead >= 0 && daysAhead <= MAX_DAYS_AHEAD;
}

/** Whether a slot is far enough in the future to be booked. */
export function isBookableInTime(
  slotIso: string,
  now: Date = new Date(),
): boolean {
  return Date.parse(slotIso) - now.getTime() >= MIN_LEAD_TIME_MS;
}

/**
 * Inclusive start and exclusive end of a clinic calendar day.
 * Used by the staff day list and the agent search.
 *
 * This does not reject overflow dates such as 2026-02-31. JavaScript rolls
 * those forward, and those callers already behaved that way. Patient slot
 * generation uses `clinicDayStart`, which rejects a rolled date.
 */
export function istDayBounds(
  date: string,
): { start: Date; end: Date } | null {
  if (!DATE_PATTERN.test(date)) {
    return null;
  }

  const start = new Date(`${date}T00:00:00${CLINIC_OFFSET}`);

  if (Number.isNaN(start.getTime())) {
    return null;
  }

  return { start, end: clinicDayEnd(start) };
}
