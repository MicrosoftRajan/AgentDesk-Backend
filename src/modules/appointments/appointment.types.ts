/** Words the current API and Expo app still use. */
export type AppointmentStatus =
  | "scheduled"
  | "cancelled"
  | "completed"
  | "no_show";

/** Words stored in `appointments.status` after migration 006. */
export type StoredAppointmentStatus =
  | "pending"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "canceled"
  | "incomplete";

export function toApiStatus(status: StoredAppointmentStatus): AppointmentStatus {
  switch (status) {
    case "pending":
    case "scheduled":
    case "in_progress":
      return "scheduled";
    case "completed":
      return "completed";
    case "canceled":
      return "cancelled";
    case "incomplete":
      return "no_show";
  }
}

/** Statuses that still occupy a bookable start time for the current app. */
export const OCCUPIED_STATUSES = [
  "pending",
  "scheduled",
  "in_progress",
] as const satisfies readonly StoredAppointmentStatus[];

export function storedStatusesFor(
  status: AppointmentStatus,
): StoredAppointmentStatus[] {
  switch (status) {
    case "scheduled":
      return ["pending", "scheduled", "in_progress"];
    case "cancelled":
      return ["canceled"];
    case "completed":
      return ["completed"];
    case "no_show":
      return ["incomplete"];
  }
}

/** Staff and agent view. Includes contact details. */
export interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  reason: string | null;
  scheduledAt: string;
  status: AppointmentStatus;
  cancelReason: string | null;
  lastReminderAt: string | null;
}

/** Patient view. Contact details stay off this payload. */
export interface PatientAppointment {
  id: string;
  reason: string | null;
  scheduledAt: string;
  status: AppointmentStatus;
  cancelReason: string | null;
}

export interface AppointmentPatientRow {
  full_name: string;
  phone: string;
  user_id: string | null;
}

export interface AppointmentRow {
  id: string;
  reason: string | null;
  scheduled_at: string;
  status: StoredAppointmentStatus;
  cancel_reason: string | null;
  last_reminder_at: string | null;
  patients: AppointmentPatientRow | AppointmentPatientRow[];
}

export const APPOINTMENT_COLUMNS =
  "id, reason, scheduled_at, status, cancel_reason, last_reminder_at, " +
  "patients!inner(full_name, phone, user_id)";

function patientOf(row: AppointmentRow): AppointmentPatientRow {
  const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;

  if (!patient) {
    throw new Error("Appointment is missing its patient");
  }

  return patient;
}

export function toAppointment(row: AppointmentRow): Appointment {
  const patient = patientOf(row);

  return {
    id: row.id,
    patientName: patient.full_name,
    patientPhone: patient.phone,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    status: toApiStatus(row.status),
    cancelReason: row.cancel_reason,
    lastReminderAt: row.last_reminder_at,
  };
}

export function toPatientAppointment(row: AppointmentRow): PatientAppointment {
  return {
    id: row.id,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    status: toApiStatus(row.status),
    cancelReason: row.cancel_reason,
  };
}

export function isAppointmentStatus(
  value: string,
): value is AppointmentStatus {
  return (
    value === "scheduled" ||
    value === "cancelled" ||
    value === "completed" ||
    value === "no_show"
  );
}
