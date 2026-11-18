import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { aiActions } from "./ai-actions";
import { appointments } from "./appointments";
import { createdAt } from "./columns";
import { notificationType } from "./enums";
import { profiles } from "./profiles";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    type: notificationType("type").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    relatedAppointmentId: uuid("related_appointment_id").references(() => appointments.id),
    relatedAiActionId: uuid("related_ai_action_id").references(() => aiActions.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_notifications_user_unread")
      .on(t.userId, t.isRead)
      .where(sql`${t.isRead} = false`),
    index("idx_notifications_ai_action").on(t.relatedAiActionId),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
