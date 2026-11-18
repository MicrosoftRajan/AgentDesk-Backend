import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { doctors } from "./doctors";
import { appointmentStatus } from "./enums";
import { patients } from "./patients";
import { profiles } from "./profiles";

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "restrict" }),
    appointmentDate: date("appointment_date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    status: appointmentStatus("status").notNull().default("scheduled"),
    reason: text("reason"),
    notes: text("notes"),

    bookedBy: uuid("booked_by")
      .notNull()
      .references(() => profiles.id),

    rescheduledFrom: uuid("rescheduled_from")
      .unique("appointments_rescheduled_from_unique")
      .references((): AnyPgColumn => appointments.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("appointments_time_order_check", sql`${t.endTime} > ${t.startTime}`),

    uniqueIndex("unique_active_doctor_slot")
      .on(t.doctorId, t.appointmentDate, t.startTime)
      .where(sql`${t.status} not in ('cancelled', 'rescheduled')`),
    index("idx_appointments_patient").on(t.patientId),
    index("idx_appointments_doctor_date").on(t.doctorId, t.appointmentDate),
    index("idx_appointments_status").on(t.status),
    index("idx_appointments_date").on(t.appointmentDate),
  ],
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
