import { errorCode } from "../../common/error-code";
import { AppError } from "../../common/http";
import type { UserRole } from "../../models/enums";
import type { EmailSender } from "../../services/email.service";
import { signAccessToken } from "../../utils/jwt";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../../utils/password";
import { generateToken, hashToken } from "../../utils/token";
import { buildAuthLink, passwordResetEmail, verificationEmail } from "./auth.emails";
import { DuplicateAccountError, type AuthRepository } from "./auth.repository";
import { toSafeUser, type AuthTokens, type Clock, type SafeUser } from "./auth.types";
import type { ResetPasswordInput, SigninInput, SignupInput } from "./auth.validation";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AuthServiceSettings = {
  jwtSecret: Uint8Array;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  frontendUrl: string | undefined;
  appScheme: string;
};

export type Defer = (task: () => Promise<void>) => void;

export type AuthServiceDeps = {
  repo: AuthRepository;
  email: EmailSender;
  settings: AuthServiceSettings;
  clock: Clock;
  defer: Defer;
};

export const deferWithSetImmediate: Defer = (task) => {
  setImmediate(() => {
    task().catch((error) => console.error(`auth background task failed: ${errorCode(error)}`));
  });
};

const invalidCredentials = () => new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
const invalidRefresh = () => new AppError(401, "INVALID_REFRESH_TOKEN", "Sign in again");

export function createAuthService({ repo, email, settings, clock, defer }: AuthServiceDeps) {
  const links = { frontendUrl: settings.frontendUrl, appScheme: settings.appScheme };

  function sendLater(build: () => ReturnType<typeof verificationEmail>) {
    defer(async () => {
      try {
        await email.send(build());
      } catch (error) {
        console.error(`auth email not sent: ${errorCode(error)}`);
      }
    });
  }

  async function issueAccessToken(userId: string, role: UserRole) {
    return signAccessToken({ userId, role }, settings.jwtSecret, settings.accessTokenTtlSeconds, clock());
  }

  async function issueSession(userId: string, role: UserRole): Promise<AuthTokens> {
    const now = clock();
    const refresh = generateToken();
    const expiresAt = new Date(now.getTime() + settings.refreshTokenTtlDays * DAY_MS);
    await repo.createSession({ userId, tokenHash: refresh.hash, expiresAt });
    return {
      accessToken: await issueAccessToken(userId, role),
      accessTokenExpiresIn: settings.accessTokenTtlSeconds,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  async function createAccount(input: Omit<SignupInput, "confirmPassword">, role: UserRole) {
    const verification = generateToken();
    const passwordHash = await hashPassword(input.password);
    try {
      const account = await repo.createAccount({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone ?? null,
        role,
        verification: { tokenHash: verification.hash, expiresAt: new Date(clock().getTime() + VERIFY_TOKEN_TTL_MS) },
      });
      return { account, verificationToken: verification.token };
    } catch (error) {
      if (error instanceof DuplicateAccountError) {
        throw error.field === "email"
          ? new AppError(409, "EMAIL_TAKEN", "An account with this email already exists")
          : new AppError(409, "PHONE_TAKEN", "An account with this phone number already exists");
      }
      throw error;
    }
  }

  return {
    async signup(input: SignupInput): Promise<{ user: SafeUser; tokens: AuthTokens }> {
      const { account, verificationToken } = await createAccount(input, input.role ?? "patient");
      sendLater(() => verificationEmail(account.email, buildAuthLink(links, "verify-email", verificationToken)));
      const tokens = await issueSession(account.id, account.role);
      return { user: toSafeUser(account), tokens };
    },

    async signin(input: SigninInput): Promise<{ user: SafeUser; tokens: AuthTokens }> {
      const account = await repo.findAccountByEmail(input.email);

      const ok = await verifyPassword(input.password, account?.passwordHash ?? (await dummyPasswordHash()));
      if (!account || !ok) throw invalidCredentials();
      const tokens = await issueSession(account.id, account.role);
      return { user: toSafeUser(account), tokens };
    },

    async refresh(refreshToken: string): Promise<AuthTokens> {
      const next = generateToken();
      const result = await repo.rotateRefreshToken({
        tokenHash: hashToken(refreshToken),
        newTokenHash: next.hash,
        now: clock(),
      });
      if (result.status === "reused") {
        console.warn(`auth: refresh token reuse detected, family ${result.familyId} revoked`);
      }
      if (result.status !== "rotated") throw invalidRefresh();

      const account = await repo.findAccountById(result.userId);
      if (!account) throw invalidRefresh();
      return {
        accessToken: await issueAccessToken(account.id, account.role),
        accessTokenExpiresIn: settings.accessTokenTtlSeconds,
        refreshToken: next.token,
        refreshTokenExpiresAt: result.expiresAt.toISOString(),
      };
    },

    async logout(refreshToken: string): Promise<void> {
      await repo.revokeFamilyByToken(hashToken(refreshToken), clock());
    },

    async me(userId: string): Promise<SafeUser> {
      const account = await repo.findAccountById(userId);
      if (!account) throw new AppError(401, "AUTH_INVALID_TOKEN", "Sign in again");
      return toSafeUser(account);
    },

    forgotPassword(emailAddress: string): void {
      defer(async () => {
        const account = await repo.findAccountByEmail(emailAddress);
        if (!account) return;
        const reset = generateToken();
        const now = clock();
        await repo.replacePasswordResetToken({
          userId: account.id,
          tokenHash: reset.hash,
          expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
          now,
        });
        sendLater(() => passwordResetEmail(account.email, buildAuthLink(links, "reset-password", reset.token)));
      });
    },

    async resetPassword(input: ResetPasswordInput): Promise<void> {
      const passwordHash = await hashPassword(input.password);
      const result = await repo.resetPassword({ tokenHash: hashToken(input.token), passwordHash, now: clock() });
      if (result.status !== "ok") {
        throw new AppError(400, "INVALID_RESET_TOKEN", "This reset link is invalid or has expired");
      }
    },

    async verifyEmail(token: string): Promise<void> {
      const result = await repo.verifyEmail({ tokenHash: hashToken(token), now: clock() });
      if (result.status !== "ok") {
        throw new AppError(400, "INVALID_VERIFICATION_TOKEN", "This verification link is invalid or has expired");
      }
    },

    async resendVerification(userId: string): Promise<void> {
      const account = await repo.findAccountById(userId);
      if (!account || account.emailVerifiedAt) return;
      const verification = generateToken();
      const now = clock();
      await repo.replaceEmailVerificationToken({
        userId,
        tokenHash: verification.hash,
        expiresAt: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS),
        now,
      });
      sendLater(() => verificationEmail(account.email, buildAuthLink(links, "verify-email", verification.token)));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
