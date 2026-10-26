export type AppointmentStatus =
  | "scheduled"
  | "cancelled"
  | "completed"
  | "no_show";

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

export interface AppointmentRow {
  id: string;
  patient_name: string;
  patient_phone: string;
  reason: string | null;
  scheduled_at: string;
  status: AppointmentStatus;
  cancel_reason: string | null;
  last_reminder_at: string | null;
}

export interface PatientAppointmentRow {
  id: string;
  reason: string | null;
  scheduled_at: string;
  status: AppointmentStatus;
  cancel_reason: string | null;
}

export const STAFF_APPOINTMENT_COLUMNS =
  "id, patient_name, patient_phone, reason, scheduled_at, status, " +
  "cancel_reason, last_reminder_at";

export const PATIENT_APPOINTMENT_COLUMNS =
  "id, reason, scheduled_at, status, cancel_reason";

export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    patientName: row.patient_name,
    patientPhone: row.patient_phone,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    status: row.status,
    cancelReason: row.cancel_reason,
    lastReminderAt: row.last_reminder_at,
  };
}

export function toPatientAppointment(
  row: PatientAppointmentRow,
): PatientAppointment {
  return {
    id: row.id,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    status: row.status,
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
