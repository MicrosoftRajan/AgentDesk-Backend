/* Free-slot calculation. Pure, so every rule can be tested without a database.
Free times come only from here and the database, never from Cohere. */
import { minutesToTime, timeToMinutes } from "../../utils/clinic-time";
import type { Slot } from "./doctors.types";

/* On the clinic's current day, a slot starting within this many minutes is hidden. */
export const BOOKING_CUTOFF_MINUTES = 15;

export type AvailabilityInput = {
  isActive: boolean;
  /* Active weekly-hours blocks for the requested weekday. */
  blocks: { startTime: string; endTime: string; slotDurationMinutes: number }[];
  /* True when the date falls inside a day-off range. */
  onDayOff: boolean;
  /* Appointments on that date that still hold their time (not cancelled or rescheduled). */
  booked: { startTime: string; endTime: string }[];
  /* The clinic's own calendar: if date === today, slots before nowMinutes + cut-off are hidden. */
  date: string;
  today: string;
  nowMinutes: number;
};

export function computeFreeSlots(input: AvailabilityInput): Slot[] {
  if (!input.isActive || input.onDayOff || input.date < input.today) return [];

  const booked = input.booked.map((b) => [timeToMinutes(b.startTime), timeToMinutes(b.endTime)] as const);
  const earliest = input.date === input.today ? input.nowMinutes + BOOKING_CUTOFF_MINUTES : -1;

  const byStart = new Map<number, number>();
  for (const block of input.blocks) {
    const step = block.slotDurationMinutes;
    if (!Number.isInteger(step) || step <= 0) continue;
    const blockEnd = timeToMinutes(block.endTime);
    for (let start = timeToMinutes(block.startTime); start + step <= blockEnd; start += step) {
      const end = start + step;
      if (start < earliest) continue;
      if (booked.some(([bStart, bEnd]) => start < bEnd && bStart < end)) continue;
      if (!byStart.has(start)) byStart.set(start, end);
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, end]) => ({ startTime: minutesToTime(start), endTime: minutesToTime(end) }));
}
