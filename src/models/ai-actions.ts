import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appointments } from "./appointments";
import { createdAt, updatedAt } from "./columns";
import { doctors } from "./doctors";
import { actionStatus, actionType } from "./enums";
import { patients } from "./patients";
import { profiles } from "./profiles";

export const aiActions = pgTable(
  "ai_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionType: actionType("action_type").notNull(),
    status: actionStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => profiles.id),
    doctorId: uuid("doctor_id").references(() => doctors.id),
    relatedPatientId: uuid("related_patient_id").references(() => patients.id),
    relatedAppointmentId: uuid("related_appointment_id").references(() => appointments.id),
    payload: jsonb("payload").notNull(),
    aiSummary: text("ai_summary").notNull(),

    userInput: text("user_input").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_ai_actions_status").on(t.status),
    index("idx_ai_actions_requested_by").on(t.requestedBy),
    index("idx_ai_actions_doctor").on(t.doctorId),
  ],
);

export type AiAction = typeof aiActions.$inferSelect;
export type NewAiAction = typeof aiActions.$inferInsert;
