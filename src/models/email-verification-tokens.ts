import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns";
import { users } from "./users";

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique("email_verification_tokens_token_hash_unique"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_email_verification_tokens_user").on(t.userId)],
);

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;
