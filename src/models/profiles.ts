import { index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { userRole } from "./enums";
import { users } from "./users";

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 100 }).notNull(),

    phone: varchar("phone", { length: 15 }).unique("profiles_phone_unique"),
    role: userRole("role").notNull(),
    languagePreference: varchar("language_preference", { length: 5 }).notNull().default("en"),
    avatarUrl: text("avatar_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_profiles_role").on(t.role)],
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
