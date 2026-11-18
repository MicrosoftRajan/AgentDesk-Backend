import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { doctors } from "./doctors";

export const doctorUnavailability = pgTable(
  "doctor_unavailability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("doctor_unavailability_date_order_check", sql`${t.endDate} >= ${t.startDate}`),
    index("idx_unavailability_doctor_dates").on(t.doctorId, t.startDate, t.endDate),
  ],
);

export type DoctorUnavailability = typeof doctorUnavailability.$inferSelect;
export type NewDoctorUnavailability = typeof doctorUnavailability.$inferInsert;
