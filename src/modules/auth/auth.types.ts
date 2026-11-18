import type { UserRole } from "../../models/enums";

export type Clock = () => Date;

export type Account = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  fullName: string;
  phone: string | null;
  role: UserRole;
  languagePreference: string;
  avatarUrl: string | null;
};

export type SafeUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  phone: string | null;
  role: UserRole;
  languagePreference: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type AuthTokens = {
  accessToken: string;

  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export function toSafeUser(account: Account): SafeUser {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.emailVerifiedAt !== null,
    fullName: account.fullName,
    phone: account.phone,
    role: account.role,
    languagePreference: account.languagePreference,
    avatarUrl: account.avatarUrl,
    createdAt: account.createdAt.toISOString(),
  };
}
