import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    email: text("email").notNull(),

    passwordHash: text("password_hash").notNull(),

    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [

    uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
