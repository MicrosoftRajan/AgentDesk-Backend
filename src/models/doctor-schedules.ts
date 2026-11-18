import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, smallint, time, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { doctors } from "./doctors";

export const doctorSchedules = pgTable(
  "doctor_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),

    dayOfWeek: smallint("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("doctor_schedules_day_of_week_check", sql`${t.dayOfWeek} between 0 and 6`),
    check("doctor_schedules_time_order_check", sql`${t.endTime} > ${t.startTime}`),
    unique("doctor_schedules_doctor_day_start_unique").on(t.doctorId, t.dayOfWeek, t.startTime),
    index("idx_schedules_doctor_day").on(t.doctorId, t.dayOfWeek),
  ],
);

export type DoctorSchedule = typeof doctorSchedules.$inferSelect;
export type NewDoctorSchedule = typeof doctorSchedules.$inferInsert;
