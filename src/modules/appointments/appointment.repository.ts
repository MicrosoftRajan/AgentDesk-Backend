import { supabase } from "../../config/supabase.js";

import {
  APPOINTMENT_COLUMNS,
  OCCUPIED_STATUSES,
  storedStatusesFor,
  toAppointment,
  toPatientAppointment,
  type Appointment,
  type AppointmentRow,
  type AppointmentStatus,
  type PatientAppointment,
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

/** Statuses the current cancel / reschedule / no-show tools may still move. */
const OPENABLE_STATUSES = ["pending", "scheduled"] as const;

interface BookingContext {
  locationId: string;
  appointmentTypeId: string;
  durationMinutes: number;
}

async function bookingContext(): Promise<BookingContext> {
  const location = await supabase
    .from("locations")
    .select("id, organization_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (location.error) {
    throwQueryError(location.error);
  }

  if (!location.data) {
    throw new DatabaseError("No clinic location is configured");
  }

  const appointmentType = await supabase
    .from("appointment_types")
    .select("id, default_duration_minutes")
    .eq("organization_id", location.data.organization_id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (appointmentType.error) {
    throwQueryError(appointmentType.error);
  }

  if (!appointmentType.data) {
    throw new DatabaseError("No appointment type is configured");
  }

  return {
    locationId: location.data.id,
    appointmentTypeId: appointmentType.data.id,
    durationMinutes: appointmentType.data.default_duration_minutes,
  };
}

async function findOrCreatePatient(input: {
  userId: string | null;
  fullName: string;
  phone: string;
}): Promise<string> {
  if (input.userId) {
    const existing = await supabase
      .from("patients")
      .select("id")
      .eq("user_id", input.userId)
      .maybeSingle();

    if (existing.error) {
      throwQueryError(existing.error);
    }

    if (existing.data) {
      const updated = await supabase
        .from("patients")
        .update({ full_name: input.fullName, phone: input.phone })
        .eq("id", existing.data.id);

      if (updated.error) {
        throwQueryError(updated.error);
      }

      return existing.data.id;
    }

    const inserted = await supabase
      .from("patients")
      .insert({
        user_id: input.userId,
        full_name: input.fullName,
        phone: input.phone,
      })
      .select("id")
      .single();

    if (inserted.error) {
      throwQueryError(inserted.error);
    }

    return inserted.data.id;
  }

  const existing = await supabase
    .from("patients")
    .select("id")
    .is("user_id", null)
    .eq("full_name", input.fullName)
    .eq("phone", input.phone)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throwQueryError(existing.error);
  }

  if (existing.data) {
    return existing.data.id;
  }

  const inserted = await supabase
    .from("patients")
    .insert({ full_name: input.fullName, phone: input.phone })
    .select("id")
    .single();

  if (inserted.error) {
    throwQueryError(inserted.error);
  }

  return inserted.data.id;
}

export async function listAppointmentsInRange(
  startIso: string,
  endIso: string,
  limit: number,
): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
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
    .select(APPOINTMENT_COLUMNS)
    .order("scheduled_at", { ascending: true })
    .limit(filter.limit);

  if (filter.startIso !== undefined && filter.endIso !== undefined) {
    query = query
      .gte("scheduled_at", filter.startIso)
      .lt("scheduled_at", filter.endIso);
  }

  if (filter.status !== undefined) {
    query = query.in("status", storedStatusesFor(filter.status));
  }

  if (filter.patientNameIlike !== undefined) {
    query = query.ilike("patients.full_name", filter.patientNameIlike);
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
    .select(APPOINTMENT_COLUMNS)
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
    .select(APPOINTMENT_COLUMNS)
    .eq("patients.user_id", userId)
    .order("scheduled_at", { ascending: false })
    .limit(limit);

  if (error) {
    throwQueryError(error);
  }

  return ((data ?? []) as unknown as AppointmentRow[]).map(toPatientAppointment);
}

export async function findPatientAppointment(
  id: string,
  userId: string,
): Promise<PatientAppointment | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("id", id)
    .eq("patients.user_id", userId)
    .maybeSingle();

  if (error) {
    throwQueryError(error);
  }

  return data ? toPatientAppointment(data as unknown as AppointmentRow) : null;
}

export async function countUpcomingPatientAppointments(
  userId: string,
  nowIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("appointments")
    .select("id, patients!inner(user_id)", { count: "exact", head: true })
    .eq("patients.user_id", userId)
    .in("status", [...OCCUPIED_STATUSES])
    .gt("scheduled_at", nowIso);

  if (error) {
    throwQueryError(error);
  }

  return count ?? 0;
}

/** Start times still occupying a slot, used to hide taken times. */
export async function listScheduledStartTimes(
  startIso: string,
  endIso: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("scheduled_at")
    .in("status", [...OCCUPIED_STATUSES])
    .gte("scheduled_at", startIso)
    .lt("scheduled_at", endIso);

  if (error) {
    throwQueryError(error);
  }

  return ((data ?? []) as unknown as { scheduled_at: string }[]).map(
    (row) => row.scheduled_at,
  );
}

async function insertAppointment(input: {
  userId: string | null;
  patientName: string;
  patientPhone: string;
  scheduledAt: string;
  reason: string | null;
}): Promise<AppointmentRow> {
  const patientId = await findOrCreatePatient({
    userId: input.userId,
    fullName: input.patientName,
    phone: input.patientPhone,
  });
  const clinic = await bookingContext();

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      location_id: clinic.locationId,
      appointment_type_id: clinic.appointmentTypeId,
      doctor_id: null,
      scheduled_at: input.scheduledAt,
      duration_minutes: clinic.durationMinutes,
      reason: input.reason,
      status: "pending",
      created_by: input.userId,
    })
    .select(APPOINTMENT_COLUMNS)
    .single();

  if (error) {
    throwQueryError(error);
  }

  return data as unknown as AppointmentRow;
}

export async function insertStaffAppointment(input: {
  patientName: string;
  patientPhone: string;
  scheduledAt: string;
  reason: string | null;
}): Promise<Appointment> {
  const row = await insertAppointment({ ...input, userId: null });
  return toAppointment(row);
}

export async function insertPatientAppointment(input: {
  userId: string;
  patientName: string;
  patientPhone: string;
  scheduledAt: string;
  reason: string | null;
}): Promise<PatientAppointment> {
  const row = await insertAppointment(input);
  return toPatientAppointment(row);
}

async function updateIfOpen(
  id: string,
  values: Record<string, unknown>,
  patientUserId?: string,
): Promise<AppointmentRow | null> {
  if (patientUserId !== undefined) {
    const owned = await supabase
      .from("appointments")
      .select("id")
      .eq("id", id)
      .eq("patients.user_id", patientUserId)
      .in("status", [...OPENABLE_STATUSES])
      .maybeSingle();

    if (owned.error) {
      throwQueryError(owned.error);
    }

    if (!owned.data) {
      return null;
    }
  }

  const { data, error } = await supabase
    .from("appointments")
    .update(values)
    .eq("id", id)
    .in("status", [...OPENABLE_STATUSES])
    .select(APPOINTMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    throwQueryError(error);
  }

  return data ? (data as unknown as AppointmentRow) : null;
}

export async function rescheduleScheduledAppointment(
  id: string,
  scheduledAt: string,
): Promise<Appointment | null> {
  const data = await updateIfOpen(id, { scheduled_at: scheduledAt });
  return data ? toAppointment(data) : null;
}

export async function markScheduledNoShow(
  id: string,
): Promise<Appointment | null> {
  const data = await updateIfOpen(id, { status: "incomplete" });
  return data ? toAppointment(data) : null;
}

export async function cancelScheduledAppointment(
  id: string,
  reason: string,
): Promise<Appointment | null> {
  const data = await updateIfOpen(id, {
    status: "canceled",
    cancel_reason: reason,
  });

  return data ? toAppointment(data) : null;
}

export async function cancelScheduledPatientAppointment(
  id: string,
  userId: string,
): Promise<PatientAppointment | null> {
  const data = await updateIfOpen(
    id,
    {
      status: "canceled",
      cancel_reason: "Cancelled by patient",
    },
    userId,
  );

  return data ? toPatientAppointment(data) : null;
}

export async function recordReminderSent(id: string): Promise<void> {
  const atIso = new Date().toISOString();

  const { error } = await supabase
    .from("appointments")
    .update({ last_reminder_at: atIso })
    .eq("id", id);

  if (error) {
    throw new DatabaseError(
      `Could not record reminder: ${error.message}`,
      error.code,
    );
  }
}
