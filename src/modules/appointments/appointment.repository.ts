import { supabase } from "../../config/supabase.js";

import {
  PATIENT_APPOINTMENT_COLUMNS,
  STAFF_APPOINTMENT_COLUMNS,
  toAppointment,
  toPatientAppointment,
  type Appointment,
  type AppointmentRow,
  type AppointmentStatus,
  type PatientAppointment,
  type PatientAppointmentRow,
} from "./appointment.types.js";

export class DatabaseError extends Error {
  readonly pgCode: string | undefined;

  constructor(message: string, pgCode?: string) {
    super(message);
    this.name = "DatabaseError";
    this.pgCode = pgCode;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DatabaseError && error.pgCode === "23505";
}

function throwQueryError(error: {
  message: string;
  code?: string;
}): never {
  throw new DatabaseError(error.message, error.code);
}

export async function listAppointmentsInRange(
  startIso: string,
  endIso: string,
  limit: number,
): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(STAFF_APPOINTMENT_COLUMNS)
    .gte("scheduled_at", startIso)
    .lt("scheduled_at", endIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    throwQueryError(error);
  }

  return ((data ?? []) as unknown as AppointmentRow[]).map(toAppointment);
}

export async function searchAppointments(filter: {
  startIso?: string;
  endIso?: string;
  status?: AppointmentStatus;
  patientNameIlike?: string;
  limit: number;
}): Promise<Appointment[]> {
  let query = supabase
    .from("appointments")
    .select(STAFF_APPOINTMENT_COLUMNS)
    .order("scheduled_at", { ascending: true })
    .limit(filter.limit);

  if (filter.startIso !== undefined && filter.endIso !== undefined) {
    query = query
      .gte("scheduled_at", filter.startIso)
      .lt("scheduled_at", filter.endIso);
  }

  if (filter.status !== undefined) {
    query = query.eq("status", filter.status);
  }

  if (filter.patientNameIlike !== undefined) {
    query = query.ilike("patient_name", filter.patientNameIlike);
  }

  const { data, error } = await query;

  if (error) {
    throwQueryError(error);
  }

  return ((data ?? []) as unknown as AppointmentRow[]).map(toAppointment);
}

export async function findAppointmentById(
  id: string,
): Promise<Appointment | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select(STAFF_APPOINTMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new DatabaseError(
      `Could not load appointment: ${error.message}`,
      error.code,
    );
  }

  return data ? toAppointment(data as unknown as AppointmentRow) : null;
}

/** Loads one appointment or throws the messages the agent tools already use. */
export async function getAppointment(id: string): Promise<Appointment> {
  const appointment = await findAppointmentById(id);

  if (!appointment) {
    throw new Error("Appointment not found");
  }

  return appointment;
}

export async function listPatientAppointments(
  userId: string,
  limit: number,
): Promise<PatientAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(PATIENT_APPOINTMENT_COLUMNS)
    .eq("patient_user_id", userId)
    .order("scheduled_at", { ascending: false })
    .limit(limit);

  if (error) {
    throwQueryError(error);
  }

  return ((data ?? []) as unknown as PatientAppointmentRow[]).map(
    toPatientAppointment,
  );
}

export async function findPatientAppointment(
  id: string,
  userId: string,
): Promise<PatientAppointment | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select(PATIENT_APPOINTMENT_COLUMNS)
    .eq("id", id)
    .eq("patient_user_id", userId)
    .maybeSingle();

  if (error) {
    throwQueryError(error);
  }

  return data
    ? toPatientAppointment(data as unknown as PatientAppointmentRow)
    : null;
}

export async function countUpcomingPatientAppointments(
  userId: string,
  nowIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("patient_user_id", userId)
    .eq("status", "scheduled")
    .gt("scheduled_at", nowIso);

  if (error) {
    throwQueryError(error);
  }

  return count ?? 0;
}

/** Start times of live appointments in a clinic day, used to hide taken slots. */
export async function listScheduledStartTimes(
  startIso: string,
  endIso: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("scheduled_at")
    .eq("status", "scheduled")
    .gte("scheduled_at", startIso)
    .lt("scheduled_at", endIso);

  if (error) {
    throwQueryError(error);
  }

  return ((data ?? []) as unknown as { scheduled_at: string }[]).map(
    (row) => row.scheduled_at,
  );
}

export async function insertStaffAppointment(input: {
  patientName: string;
  patientPhone: string;
  scheduledAt: string;
  reason: string | null;
}): Promise<Appointment> {
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_name: input.patientName,
      patient_phone: input.patientPhone,
      scheduled_at: input.scheduledAt,
      reason: input.reason,
    })
    .select(STAFF_APPOINTMENT_COLUMNS)
    .single();

  if (error) {
    throwQueryError(error);
  }

  return toAppointment(data as unknown as AppointmentRow);
}

export async function insertPatientAppointment(input: {
  userId: string;
  patientName: string;
  patientPhone: string;
  scheduledAt: string;
  reason: string | null;
}): Promise<PatientAppointment> {
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_user_id: input.userId,
      patient_name: input.patientName,
      patient_phone: input.patientPhone,
      scheduled_at: input.scheduledAt,
      reason: input.reason,
    })
    .select(PATIENT_APPOINTMENT_COLUMNS)
    .single();

  if (error) {
    throwQueryError(error);
  }

  return toPatientAppointment(data as unknown as PatientAppointmentRow);
}

async function updateIfScheduled(
  id: string,
  columns: string,
  values: Record<string, unknown>,
  patientUserId?: string,
): Promise<unknown | null> {
  let query = supabase
    .from("appointments")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "scheduled");

  if (patientUserId !== undefined) {
    query = query.eq("patient_user_id", patientUserId);
  }

  const { data, error } = await query.select(columns).maybeSingle();

  if (error) {
    throwQueryError(error);
  }

  return data;
}

export async function rescheduleScheduledAppointment(
  id: string,
  scheduledAt: string,
): Promise<Appointment | null> {
  const data = await updateIfScheduled(id, STAFF_APPOINTMENT_COLUMNS, {
    scheduled_at: scheduledAt,
  });

  return data ? toAppointment(data as AppointmentRow) : null;
}

export async function markScheduledNoShow(
  id: string,
): Promise<Appointment | null> {
  const data = await updateIfScheduled(id, STAFF_APPOINTMENT_COLUMNS, {
    status: "no_show",
  });

  return data ? toAppointment(data as AppointmentRow) : null;
}

export async function cancelScheduledAppointment(
  id: string,
  reason: string,
): Promise<Appointment | null> {
  const data = await updateIfScheduled(id, STAFF_APPOINTMENT_COLUMNS, {
    status: "cancelled",
    cancel_reason: reason,
  });

  return data ? toAppointment(data as AppointmentRow) : null;
}

export async function cancelScheduledPatientAppointment(
  id: string,
  userId: string,
): Promise<PatientAppointment | null> {
  const data = await updateIfScheduled(
    id,
    PATIENT_APPOINTMENT_COLUMNS,
    {
      status: "cancelled",
      cancel_reason: "Cancelled by patient",
    },
    userId,
  );

  return data ? toPatientAppointment(data as PatientAppointmentRow) : null;
}

export async function recordReminderSent(id: string): Promise<void> {
  const atIso = new Date().toISOString();

  const { error } = await supabase
    .from("appointments")
    .update({
      last_reminder_at: atIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new DatabaseError(
      `Could not record reminder: ${error.message}`,
      error.code,
    );
  }
}
