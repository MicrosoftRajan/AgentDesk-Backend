import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { profiles } from "./profiles";

export const doctors = pgTable(
  "doctors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .unique("doctors_profile_id_unique")
      .references(() => profiles.id),
    specialization: varchar("specialization", { length: 100 }).notNull(),
    qualification: varchar("qualification", { length: 200 }).notNull(),
    experienceYears: integer("experience_years").notNull(),

    consultationFee: numeric("consultation_fee", { precision: 10, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("doctors_experience_years_check", sql`${t.experienceYears} >= 0`),
    check("doctors_consultation_fee_check", sql`${t.consultationFee} > 0`),
    index("idx_doctors_specialization").on(t.specialization),
    index("idx_doctors_is_active").on(t.isActive),
  ],
);

export type Doctor = typeof doctors.$inferSelect;
export type NewDoctor = typeof doctors.$inferInsert;
