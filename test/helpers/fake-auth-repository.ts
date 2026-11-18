import { randomUUID } from "node:crypto";
import type { UserRole } from "../../src/models/enums";
import {
  DuplicateAccountError,
  type AuthRepository,
  type ConsumeResult,
  type NewAccount,
  type RotateResult,
} from "../../src/modules/auth/auth.repository";
import type { Account } from "../../src/modules/auth/auth.types";

type TokenRow = { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
type RefreshRow = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
};

export class FakeAuthRepository implements AuthRepository {
  readonly accounts = new Map<string, Account>();
  readonly refreshTokens: RefreshRow[] = [];
  readonly resetTokens: TokenRow[] = [];
  readonly verificationTokens: TokenRow[] = [];

  async findAccountByEmail(email: string) {
    return this.clone([...this.accounts.values()].find((a) => a.email.toLowerCase() === email));
  }

  async findAccountById(id: string) {
    return this.clone(this.accounts.get(id));
  }

  async createAccount(input: NewAccount) {
    const all = [...this.accounts.values()];
    if (all.some((a) => a.email.toLowerCase() === input.email.toLowerCase())) throw new DuplicateAccountError("email");
    if (input.phone !== null && all.some((a) => a.phone === input.phone)) throw new DuplicateAccountError("phone");
    const account: Account = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      emailVerifiedAt: null,
      createdAt: new Date(),
      fullName: input.fullName,
      phone: input.phone,
      role: input.role,
      languagePreference: "en",
      avatarUrl: null,
    };
    this.accounts.set(account.id, account);
    this.verificationTokens.push({ id: randomUUID(), userId: account.id, ...input.verification, usedAt: null });
    return this.clone(account)!;
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.refreshTokens.push({ id: randomUUID(), familyId: randomUUID(), revokedAt: null, replacedById: null, ...input });
  }

  async rotateRefreshToken({ tokenHash, newTokenHash, now }: { tokenHash: string; newTokenHash: string; now: Date }): Promise<RotateResult> {
    const row = this.refreshTokens.find((r) => r.tokenHash === tokenHash);
    if (!row) return { status: "invalid" };
    if (row.revokedAt) {
      for (const r of this.refreshTokens) if (r.familyId === row.familyId && !r.revokedAt) r.revokedAt = now;
      return { status: "reused", familyId: row.familyId };
    }
    if (row.expiresAt <= now) return { status: "expired" };
    const next: RefreshRow = {
      id: randomUUID(),
      userId: row.userId,
      familyId: row.familyId,
      tokenHash: newTokenHash,
      expiresAt: row.expiresAt,
      revokedAt: null,
      replacedById: null,
    };
    this.refreshTokens.push(next);
    row.revokedAt = now;
    row.replacedById = next.id;
    return { status: "rotated", userId: row.userId, expiresAt: row.expiresAt };
  }

  async revokeFamilyByToken(tokenHash: string, now: Date) {
    const row = this.refreshTokens.find((r) => r.tokenHash === tokenHash);
    if (!row) return;
    for (const r of this.refreshTokens) if (r.familyId === row.familyId && !r.revokedAt) r.revokedAt = now;
  }

  async replacePasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date; now: Date }) {
    for (const t of this.resetTokens) if (t.userId === input.userId && !t.usedAt) t.usedAt = input.now;
    this.resetTokens.push({ id: randomUUID(), userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null });
  }

  async resetPassword({ tokenHash, passwordHash, now }: { tokenHash: string; passwordHash: string; now: Date }): Promise<ConsumeResult> {
    const row = this.resetTokens.find((t) => t.tokenHash === tokenHash);
    if (!row || row.usedAt || row.expiresAt <= now) return { status: "invalid" };
    const account = this.accounts.get(row.userId)!;
    account.passwordHash = passwordHash;
    account.emailVerifiedAt ??= now;
    for (const t of this.resetTokens) if (t.userId === row.userId && !t.usedAt) t.usedAt = now;
    for (const r of this.refreshTokens) if (r.userId === row.userId && !r.revokedAt) r.revokedAt = now;
    return { status: "ok", userId: row.userId };
  }

  async replaceEmailVerificationToken(input: { userId: string; tokenHash: string; expiresAt: Date; now: Date }) {
    for (const t of this.verificationTokens) if (t.userId === input.userId && !t.usedAt) t.usedAt = input.now;
    this.verificationTokens.push({ id: randomUUID(), userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null });
  }

  async verifyEmail({ tokenHash, now }: { tokenHash: string; now: Date }): Promise<ConsumeResult> {
    const row = this.verificationTokens.find((t) => t.tokenHash === tokenHash);
    if (!row || row.usedAt || row.expiresAt <= now) return { status: "invalid" };
    row.usedAt = now;
    this.accounts.get(row.userId)!.emailVerifiedAt ??= now;
    return { status: "ok", userId: row.userId };
  }

  setRole(userId: string, role: UserRole) {
    this.accounts.get(userId)!.role = role;
  }

  private clone(account: Account | undefined) {
    return account ? { ...account } : undefined;
  }
}
