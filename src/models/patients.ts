import { date, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { gender } from "./enums";
import { profiles } from "./profiles";

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .unique("patients_profile_id_unique")
      .references(() => profiles.id),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 15 }).notNull(),
    email: varchar("email", { length: 100 }),
    dateOfBirth: date("date_of_birth").notNull(),
    gender: gender("gender").notNull(),
    address: text("address"),
    medicalNotes: text("medical_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_patients_phone").on(t.phone), index("idx_patients_name").on(t.fullName)],
);

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
