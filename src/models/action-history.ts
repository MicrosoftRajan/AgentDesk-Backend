import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { aiActions } from "./ai-actions";
import { appointments } from "./appointments";
import { createdAt } from "./columns";
import { actionType } from "./enums";
import { profiles } from "./profiles";

export const actionHistory = pgTable(
  "action_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    aiActionId: uuid("ai_action_id")
      .unique("action_history_ai_action_id_unique")
      .references(() => aiActions.id),
    actionType: actionType("action_type").notNull(),
    performedBy: uuid("performed_by")
      .notNull()
      .references(() => profiles.id),
    approvedBy: uuid("approved_by").references(() => profiles.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state").notNull(),
    description: text("description").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_history_performed_by").on(t.performedBy),
    index("idx_history_executed_at").on(t.executedAt),
  ],
);

export type ActionHistory = typeof actionHistory.$inferSelect;
export type NewActionHistory = typeof actionHistory.$inferInsert;
