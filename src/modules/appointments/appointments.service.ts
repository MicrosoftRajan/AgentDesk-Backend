import { todayInClinic, istDayBounds } from "./clinicSchedule.js";
import {
  findAppointmentById,
  listAppointmentsInRange,
} from "./appointment.repository.js";
import type { Appointment } from "./appointment.types.js";

const MAX_RESULTS = 200;

export interface AppointmentDay {
  date: string;
  appointments: Appointment[];
}

export async function listAppointmentsForDay(
  date: string,
): Promise<AppointmentDay | null> {
  const bounds = istDayBounds(date);

  if (!bounds) {
    return null;
  }

  const appointments = await listAppointmentsInRange(
    bounds.start.toISOString(),
    bounds.end.toISOString(),
    MAX_RESULTS,
  );

  return { date, appointments };
}

export function defaultAppointmentDate(): string {
  return todayInClinic();
}

export async function getAppointmentForStaff(
  id: string,
): Promise<Appointment | null> {
  return findAppointmentById(id);
}
