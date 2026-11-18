import { index, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt } from "./columns";
import { users } from "./users";

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    familyId: uuid("family_id").notNull().defaultRandom(),

    tokenHash: text("token_hash").notNull().unique("refresh_tokens_token_hash_unique"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id").references((): AnyPgColumn => refreshTokens.id),
    createdAt: createdAt(),
  },
  (t) => [index("idx_refresh_tokens_user").on(t.userId), index("idx_refresh_tokens_family").on(t.familyId)],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
