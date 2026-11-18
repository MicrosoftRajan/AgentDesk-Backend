import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../../config/database";
import {
  emailVerificationTokens,
  passwordResetTokens,
  profiles,
  refreshTokens,
  users,
  type UserRole,
} from "../../models";
import type { Account } from "./auth.types";

export type NewAccount = {
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  verification: { tokenHash: string; expiresAt: Date };
};

export type RotateResult =
  | { status: "rotated"; userId: string; expiresAt: Date }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "reused"; familyId: string };

export type ConsumeResult = { status: "ok"; userId: string } | { status: "invalid" };

export class DuplicateAccountError extends Error {
  constructor(readonly field: "email" | "phone") {
    super(`Duplicate ${field}`);
    this.name = "DuplicateAccountError";
  }
}

export interface AuthRepository {
  findAccountByEmail(email: string): Promise<Account | undefined>;
  findAccountById(id: string): Promise<Account | undefined>;

  createAccount(input: NewAccount): Promise<Account>;

  createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;

  rotateRefreshToken(input: { tokenHash: string; newTokenHash: string; now: Date }): Promise<RotateResult>;

  revokeFamilyByToken(tokenHash: string, now: Date): Promise<void>;

  replacePasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<void>;

  resetPassword(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<ConsumeResult>;
  replaceEmailVerificationToken(input: { userId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<void>;
  verifyEmail(input: { tokenHash: string; now: Date }): Promise<ConsumeResult>;
}

type Db = Database["db"];

const accountColumns = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
  emailVerifiedAt: users.emailVerifiedAt,
  createdAt: users.createdAt,
  fullName: profiles.fullName,
  phone: profiles.phone,
  role: profiles.role,
  languagePreference: profiles.languagePreference,
  avatarUrl: profiles.avatarUrl,
};

function uniqueViolation(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505") return typeof candidate.constraint === "string" ? candidate.constraint : "";
    current = candidate.cause;
  }
  return undefined;
}

export function createDrizzleAuthRepository(db: Db): AuthRepository {
  const findOne = async (where: ReturnType<typeof eq>) => {
    const rows = await db
      .select(accountColumns)
      .from(users)
      .innerJoin(profiles, eq(profiles.id, users.id))
      .where(where)
      .limit(1);
    return rows[0];
  };

  return {
    findAccountByEmail: (email) => findOne(sql`lower(${users.email}) = ${email}`),

    findAccountById: (id) => findOne(eq(users.id, id)),

    async createAccount(input) {
      let id: string;
      try {
        id = await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({ email: input.email, passwordHash: input.passwordHash })
            .returning({ id: users.id });
          await tx.insert(profiles).values({ id: user!.id, fullName: input.fullName, phone: input.phone, role: input.role });
          await tx.insert(emailVerificationTokens).values({
            userId: user!.id,
            tokenHash: input.verification.tokenHash,
            expiresAt: input.verification.expiresAt,
          });
          return user!.id;
        });
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint === "users_email_lower_unique") throw new DuplicateAccountError("email");
        if (constraint === "profiles_phone_unique") throw new DuplicateAccountError("phone");
        throw error;
      }
      const account = await findOne(eq(users.id, id));
      if (!account) throw new Error("Account missing after insert");
      return account;
    },

    async createSession(input) {
      await db.insert(refreshTokens).values(input);
    },

    rotateRefreshToken: ({ tokenHash, newTokenHash, now }) =>
      db.transaction(async (tx): Promise<RotateResult> => {
        const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).for("update");
        if (!row) return { status: "invalid" };

        if (row.revokedAt) {
          await tx
            .update(refreshTokens)
            .set({ revokedAt: now })
            .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
          return { status: "reused", familyId: row.familyId };
        }
        if (row.expiresAt <= now) return { status: "expired" };

        const [next] = await tx
          .insert(refreshTokens)
          .values({ userId: row.userId, familyId: row.familyId, tokenHash: newTokenHash, expiresAt: row.expiresAt })
          .returning({ id: refreshTokens.id });
        await tx.update(refreshTokens).set({ revokedAt: now, replacedById: next!.id }).where(eq(refreshTokens.id, row.id));
        return { status: "rotated", userId: row.userId, expiresAt: row.expiresAt };
      }),

    async revokeFamilyByToken(tokenHash, now) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(refreshTokens.revokedAt),
            inArray(
              refreshTokens.familyId,
              db.select({ familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)),
            ),
          ),
        );
    },

    replacePasswordResetToken: ({ userId, tokenHash, expiresAt, now }) =>
      db.transaction(async (tx) => {
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
        await tx.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
      }),

    resetPassword: ({ tokenHash, passwordHash, now }) =>
      db.transaction(async (tx): Promise<ConsumeResult> => {
        const [row] = await tx
          .select()
          .from(passwordResetTokens)
          .where(eq(passwordResetTokens.tokenHash, tokenHash))
          .for("update");
        if (!row || row.usedAt || row.expiresAt <= now) return { status: "invalid" };

        await tx
          .update(users)
          .set({
            passwordHash,

            emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)`,
          })
          .where(eq(users.id, row.userId));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
        return { status: "ok", userId: row.userId };
      }),

    replaceEmailVerificationToken: ({ userId, tokenHash, expiresAt, now }) =>
      db.transaction(async (tx) => {
        await tx
          .update(emailVerificationTokens)
          .set({ usedAt: now })
          .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt)));
        await tx.insert(emailVerificationTokens).values({ userId, tokenHash, expiresAt });
      }),

    verifyEmail: ({ tokenHash, now }) =>
      db.transaction(async (tx): Promise<ConsumeResult> => {
        const [row] = await tx
          .select()
          .from(emailVerificationTokens)
          .where(eq(emailVerificationTokens.tokenHash, tokenHash))
          .for("update");
        if (!row || row.usedAt || row.expiresAt <= now) return { status: "invalid" };
        await tx.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, row.id));
        await tx
          .update(users)
          .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)` })
          .where(eq(users.id, row.userId));
        return { status: "ok", userId: row.userId };
      }),
  };
}
