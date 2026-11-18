import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { decodeJwt, SignJWT } from "jose";
import { createApp } from "../src/app";
import { errorHandler } from "../src/common/error-handler";
import { createAuthMiddleware } from "../src/middleware/authenticate";
import { DEFAULT_AUTH_RATE_LIMITS, type AuthRateLimits } from "../src/modules/auth/auth.routes";
import type { EmailMessage } from "../src/services/email.service";
import { createResendSender, EmailSendError } from "../src/services/email.service";
import { JWT_AUDIENCE, JWT_ISSUER, signAccessToken } from "../src/utils/jwt";
import { FakeAuthRepository } from "./helpers/fake-auth-repository";

const SECRET = new TextEncoder().encode("test-secret-that-is-long-enough-0123456789");
const START = new Date("2026-11-18T10:00:00.000Z");
const MIN = 60_000;

const LOOSE: AuthRateLimits = Object.fromEntries(
  Object.keys(DEFAULT_AUTH_RATE_LIMITS).map((k) => [k, { limit: 1000, windowMs: 60 * MIN }]),
) as AuthRateLimits;

const sensitive = new Set<string>();
const remember = <T extends string>(value: T): T => {
  sensitive.add(value);
  return value;
};
const logged: string[] = [];
const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };

before(() => {
  for (const level of Object.keys(originals) as (keyof typeof originals)[]) {
    console[level] = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
  }
});

after(() => {
  Object.assign(console, originals);
  const output = logged.join("\n");
  for (const value of sensitive) {
    assert.ok(!output.includes(value), `console output contained a sensitive value (${value.slice(0, 4)}…)`);
  }
});

type Json = Record<string, any>;

async function startApp(options: { limits?: AuthRateLimits; frontendUrl?: string; failEmail?: boolean } = {}) {
  const repo = new FakeAuthRepository();
  const emails: EmailMessage[] = [];
  let now = START;
  const tasks: Array<() => Promise<void>> = [];
  const app = createApp({
    auth: {
      repo,
      email: {
        send: async (message) => {
          if (options.failEmail) throw new EmailSendError("RESEND_HTTP_500");
          emails.push(message);
        },
      },
      settings: {
        jwtSecret: SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 30,
        frontendUrl: options.frontendUrl,
        appScheme: "agentdesk",
      },
      clock: () => now,
      defer: (task) => void tasks.push(task),
      limits: options.limits ?? LOOSE,
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  async function call(method: string, path: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    const json: Json = text ? JSON.parse(text) : {};

    for (const t of [json.data?.tokens?.accessToken, json.data?.tokens?.refreshToken]) if (t) remember(t);
    return { status: response.status, json, text, headers: response.headers };
  }

  return {
    repo,
    emails,
    call,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },

    flush: async () => {
      while (tasks.length) await tasks.shift()!();
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type Harness = Awaited<ReturnType<typeof startApp>>;

let counter = 0;
function newPerson() {
  counter++;
  return {
    fullName: remember(`Priya Testpatient${counter}`),
    email: remember(`priya.${counter}@example.test`),
    phone: remember(`+91981234${String(counter).padStart(4, "0")}`),
    password: remember(`Str0ng-pass-${counter}-xyz`),
  };
}

async function signup(h: Harness, person = newPerson()) {
  const res = await h.call("POST", "/auth/signup", { ...person, confirmPassword: person.password });
  assert.equal(res.status, 201, res.text);
  return { person, res, user: res.json.data.user, tokens: res.json.data.tokens };
}

function linkToken(message: EmailMessage): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(match, "email has a token link");
  return remember(match[1]!);
}

describe("auth API", () => {
  let h: Harness;
  before(async () => {
    h = await startApp();
  });
  after(() => h.close());

  describe("signup", () => {
    it("creates a patient, hashes the password, and returns no secrets", async () => {
      const { person, res, user, tokens } = await signup(h);
      assert.equal(user.email, person.email);
      assert.equal(user.role, "patient");
      assert.equal(user.emailVerified, false);
      assert.equal(user.fullName, person.fullName);
      assert.equal(user.phone, person.phone);
      assert.ok(tokens.accessToken && tokens.refreshToken);
      assert.equal(tokens.accessTokenExpiresIn, 900);
      assert.equal(res.headers.get("cache-control"), "no-store");
      for (const forbidden of ["passwordHash", "password_hash", "argon2", "tokenHash", person.password]) {
        assert.ok(!res.text.includes(forbidden), `response contains ${forbidden}`);
      }
      const stored = h.repo.accounts.get(user.id)!;
      assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

      assert.ok(h.repo.refreshTokens.every((r) => r.tokenHash !== tokens.refreshToken && /^[0-9a-f]{64}$/.test(r.tokenHash)));
    });

    it("normalizes email and accepts a missing phone", async () => {
      const person = newPerson();
      const res = await h.call("POST", "/auth/signup", {
        fullName: person.fullName,
        email: `  ${person.email.toUpperCase()} `,
        password: person.password,
        confirmPassword: person.password,
      });
      assert.equal(res.status, 201, res.text);
      assert.equal(res.json.data.user.email, person.email);
      assert.equal(res.json.data.user.phone, null);
    });

    it("rejects a duplicate email in any letter case with 409", async () => {
      const { person } = await signup(h);
      const again = { ...newPerson(), email: person.email.toUpperCase() };
      const res = await h.call("POST", "/auth/signup", { ...again, confirmPassword: again.password });
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, "EMAIL_TAKEN");
    });

    it("rejects a duplicate phone with 409", async () => {
      const { person } = await signup(h);
      const other = { ...newPerson(), phone: person.phone };
      const res = await h.call("POST", "/auth/signup", { ...other, confirmPassword: other.password });
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, "PHONE_TAKEN");
    });

    it("rejects invalid email, weak password, mismatched confirmation and bad phone with 400", async () => {
      const p = newPerson();
      const cases: Array<[Json, string]> = [
        [{ ...p, email: "not-an-email", confirmPassword: p.password }, "email"],
        [{ ...p, password: "Short1!", confirmPassword: "Short1!" }, "password"],
        [{ ...p, password: "x".repeat(129), confirmPassword: "x".repeat(129) }, "password"],
        [{ ...p, confirmPassword: `${p.password}-different` }, "confirmPassword"],
        [{ ...p, phone: "98123", confirmPassword: p.password }, "phone"],
        [{ ...p, fullName: "   ", confirmPassword: p.password }, "fullName"],
      ];
      for (const [body, path] of cases) {
        const res = await h.call("POST", "/auth/signup", body);
        assert.equal(res.status, 400, path);
        assert.equal(res.json.error.code, "VALIDATION_ERROR");
        assert.ok(res.json.error.details.some((d: Json) => d.path === path), `${path}: ${res.text}`);

        assert.ok(!res.text.includes(p.password) && !res.text.includes("not-an-email") && !res.text.includes("98123"));
      }
    });

    it("never lets signup choose a role: a role field is rejected and nothing is created", async () => {
      const before = h.repo.accounts.size;
      for (const role of ["admin", "doctor", "receptionist", "patient"]) {
        const p = newPerson();
        const res = await h.call("POST", "/auth/signup", { ...p, confirmPassword: p.password, role });
        assert.equal(res.status, 400);
        assert.ok(res.json.error.details.some((d: Json) => d.rule === "unrecognized_keys"));
      }
      assert.equal(h.repo.accounts.size, before);
    });

    it("answers malformed JSON with 400 VALIDATION_ERROR", async () => {
      const res = await h.call("POST", "/auth/signup", "{not json");
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "VALIDATION_ERROR");
    });
  });

  describe("signin", () => {
    it("returns the user and a fresh session", async () => {
      const { person, user } = await signup(h);
      const res = await h.call("POST", "/auth/signin", { email: person.email.toUpperCase(), password: person.password });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.data.user.id, user.id);
      assert.equal(res.json.data.user.role, "patient");
      const claims = decodeJwt(res.json.data.tokens.accessToken);
      assert.equal(claims.sub, user.id);
      assert.equal(claims.role, "patient");
      assert.equal(claims.iss, JWT_ISSUER);
      assert.equal(claims.aud, JWT_AUDIENCE);
      assert.equal(claims.exp! - claims.iat!, 900);
      assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "iss", "role", "sub"]);
    });

    it("gives the same 401 for a wrong password and an unknown email", async () => {
      const { person } = await signup(h);
      const wrong = await h.call("POST", "/auth/signin", { email: person.email, password: "Wrong-password-123" });
      const unknown = await h.call("POST", "/auth/signin", { email: "nobody@example.test", password: "Wrong-password-123" });
      for (const res of [wrong, unknown]) {
        assert.equal(res.status, 401);
        assert.equal(res.json.data, undefined);
      }
      assert.deepEqual(wrong.json.error, unknown.json.error);
      assert.equal(wrong.json.error.code, "INVALID_CREDENTIALS");
    });
  });

  describe("access tokens and /me", () => {
    it("returns the current user with emailVerified and no secrets", async () => {
      const { user, tokens } = await signup(h);
      const res = await h.call("GET", "/auth/me", undefined, tokens.accessToken);
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.data.user, user);
      assert.equal(res.json.data.user.emailVerified, false);
      assert.ok(!res.text.includes("argon2"));
    });

    it("rejects missing, malformed, foreign-signed, unsigned and expired tokens with 401", async () => {
      const { user, tokens } = await signup(h);
      const otherSecret = new TextEncoder().encode("another-secret-that-is-long-enough-987654");
      const foreign = await signAccessToken({ userId: user.id, role: "admin" }, otherSecret, 900, START);
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ sub: user.id, role: "admin", iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: 1, exp: 9e9 })).toString("base64url");
      const wrongAudience = await new SignJWT({ role: "patient" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.id)
        .setIssuer(JWT_ISSUER)
        .setAudience("someone-else")
        .setIssuedAt(Math.floor(START.getTime() / 1000))
        .setExpirationTime(Math.floor(START.getTime() / 1000) + 900)
        .sign(SECRET);

      for (const token of [undefined, "garbage", foreign, `${header}.${body}.`, wrongAudience]) {
        const res = await h.call("GET", "/auth/me", undefined, token);
        assert.equal(res.status, 401, String(token).slice(0, 20));
        assert.equal(res.json.error.code, "AUTH_INVALID_TOKEN");
      }

      const fresh = await startApp();
      try {
        const s = await signup(fresh);
        fresh.advance(16 * MIN);
        const expired = await fresh.call("GET", "/auth/me", undefined, s.tokens.accessToken);
        assert.equal(expired.status, 401);
        assert.equal(expired.json.error.code, "AUTH_INVALID_TOKEN");
      } finally {
        await fresh.close();
      }
      void tokens;
    });
  });

  describe("refresh", () => {
    it("rotates: returns a new pair and the old refresh token stops working", async () => {
      const { tokens } = await signup(h);
      const first = await h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken });
      assert.equal(first.status, 200, first.text);
      const next = first.json.data.tokens;
      assert.notEqual(next.refreshToken, tokens.refreshToken);
      assert.equal(next.refreshTokenExpiresAt, tokens.refreshTokenExpiresAt, "rotation keeps the family expiry");
      const me = await h.call("GET", "/auth/me", undefined, next.accessToken);
      assert.equal(me.status, 200);
    });

    it("detects reuse: the old token gets 401 and the whole family is revoked", async () => {
      const { tokens } = await signup(h);
      const rotated = (await h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken })).json.data.tokens;
      const reuse = await h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken });
      assert.equal(reuse.status, 401);
      assert.equal(reuse.json.error.code, "INVALID_REFRESH_TOKEN");
      const victim = await h.call("POST", "/auth/refresh", { refreshToken: rotated.refreshToken });
      assert.equal(victim.status, 401, "the legitimate-looking newer token is revoked too");
    });

    it("concurrent refreshes with one token: exactly one succeeds, then the family is revoked", async () => {
      const { tokens } = await signup(h);
      const results = await Promise.all([
        h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken }),
        h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 401]);
      const winner = results.find((r) => r.status === 200)!.json.data.tokens;
      const after = await h.call("POST", "/auth/refresh", { refreshToken: winner.refreshToken });
      assert.equal(after.status, 401);
    });

    it("rejects unknown and expired refresh tokens without touching other sessions", async () => {
      const unknown = await h.call("POST", "/auth/refresh", { refreshToken: "A".repeat(43) });
      assert.equal(unknown.status, 401);

      const fresh = await startApp();
      try {
        const s = await signup(fresh);
        fresh.advance(31 * 24 * 60 * MIN);
        const expired = await fresh.call("POST", "/auth/refresh", { refreshToken: s.tokens.refreshToken });
        assert.equal(expired.status, 401);
        assert.equal(expired.json.error.code, "INVALID_REFRESH_TOKEN");
      } finally {
        await fresh.close();
      }
    });

    it("reads the role from the database, not from the old token", async () => {
      const { user, tokens } = await signup(h);
      h.repo.setRole(user.id, "receptionist");
      const res = await h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken });
      assert.equal(decodeJwt(res.json.data.tokens.accessToken).role, "receptionist");
    });
  });

  describe("logout", () => {
    it("revokes the session; the refresh token then fails", async () => {
      const { tokens } = await signup(h);
      const res = await h.call("POST", "/auth/logout", { refreshToken: tokens.refreshToken });
      assert.equal(res.status, 204);
      assert.equal(res.text, "");
      const again = await h.call("POST", "/auth/refresh", { refreshToken: tokens.refreshToken });
      assert.equal(again.status, 401);
    });

    it("is safe for unknown or already-revoked tokens, and validates the body", async () => {
      const { tokens } = await signup(h);
      await h.call("POST", "/auth/logout", { refreshToken: tokens.refreshToken });
      assert.equal((await h.call("POST", "/auth/logout", { refreshToken: tokens.refreshToken })).status, 204);
      assert.equal((await h.call("POST", "/auth/logout", { refreshToken: "B".repeat(43) })).status, 204);
      assert.equal((await h.call("POST", "/auth/logout", { refreshToken: 42 })).status, 400);
    });

    it("only ends that session; another device stays signed in", async () => {
      const { person, tokens } = await signup(h);
      const other = (await h.call("POST", "/auth/signin", { email: person.email, password: person.password })).json.data.tokens;
      await h.call("POST", "/auth/logout", { refreshToken: tokens.refreshToken });
      assert.equal((await h.call("POST", "/auth/refresh", { refreshToken: other.refreshToken })).status, 200);
    });
  });

  describe("forgot and reset password", () => {
    const FORGOT = "If an account exists for that email, a reset link has been sent.";

    it("known email: generic 202, then one reset email with a 15-minute single-use link", async () => {
      const { person } = await signup(h);
      await h.flush();
      h.emails.length = 0;
      const res = await h.call("POST", "/auth/forgot-password", { email: person.email });
      assert.equal(res.status, 202);
      assert.equal(res.json.data.message, FORGOT);
      await h.flush();
      assert.equal(h.emails.length, 1);
      const mail = h.emails[0]!;
      assert.equal(mail.to, person.email);
      assert.match(mail.text, /agentdesk:\/\/reset-password\?token=[A-Za-z0-9_-]{43}/);
      assert.ok(!mail.html.includes(person.fullName) && !mail.text.includes(person.phone), "no personal data in the email");
      const token = linkToken(mail);
      assert.ok(h.repo.resetTokens.every((t) => t.tokenHash !== token), "only the hash is stored");
      const stored = h.repo.resetTokens.at(-1)!;
      assert.equal(stored.expiresAt.getTime() - START.getTime(), 15 * MIN);
    });

    it("unknown email: the same 202 and no email", async () => {
      h.emails.length = 0;
      const res = await h.call("POST", "/auth/forgot-password", { email: "nobody-here@example.test" });
      assert.equal(res.status, 202);
      assert.equal(res.json.data.message, FORGOT);
      await h.flush();
      assert.equal(h.emails.length, 0);
    });

    it("successful reset: new password works, old fails, all sessions revoked, email verified", async () => {
      const { person, tokens } = await signup(h);
      const second = (await h.call("POST", "/auth/signin", { email: person.email, password: person.password })).json.data.tokens;
      await h.call("POST", "/auth/forgot-password", { email: person.email });
      await h.flush();
      const token = linkToken(h.emails.at(-1)!);
      const newPassword = remember("Brand-new-passw0rd!");

      const res = await h.call("POST", "/auth/reset-password", { token, password: newPassword, confirmPassword: newPassword });
      assert.equal(res.status, 200, res.text);

      assert.equal((await h.call("POST", "/auth/signin", { email: person.email, password: person.password })).status, 401);
      const signin = await h.call("POST", "/auth/signin", { email: person.email, password: newPassword });
      assert.equal(signin.status, 200);
      assert.equal(signin.json.data.user.emailVerified, true);
      for (const old of [tokens.refreshToken, second.refreshToken]) {
        assert.equal((await h.call("POST", "/auth/refresh", { refreshToken: old })).status, 401);
      }
    });

    it("rejects a reused reset token", async () => {
      const { person } = await signup(h);
      await h.call("POST", "/auth/forgot-password", { email: person.email });
      await h.flush();
      const token = linkToken(h.emails.at(-1)!);
      const pw = remember("Another-passw0rd-1");
      assert.equal((await h.call("POST", "/auth/reset-password", { token, password: pw, confirmPassword: pw })).status, 200);
      const again = await h.call("POST", "/auth/reset-password", { token, password: pw, confirmPassword: pw });
      assert.equal(again.status, 400);
      assert.equal(again.json.error.code, "INVALID_RESET_TOKEN");
    });

    it("rejects an expired reset token (after 15 minutes)", async () => {
      const fresh = await startApp();
      try {
        const { person } = await signup(fresh);
        await fresh.call("POST", "/auth/forgot-password", { email: person.email });
        await fresh.flush();
        const token = linkToken(fresh.emails.at(-1)!);
        fresh.advance(15 * MIN + 1000);
        const pw = remember("Late-passw0rd-123");
        const res = await fresh.call("POST", "/auth/reset-password", { token, password: pw, confirmPassword: pw });
        assert.equal(res.status, 400);
        assert.equal(res.json.error.code, "INVALID_RESET_TOKEN");
        assert.equal((await fresh.call("POST", "/auth/signin", { email: person.email, password: person.password })).status, 200);
      } finally {
        await fresh.close();
      }
    });

    it("a newer reset link cancels the older one", async () => {
      const { person } = await signup(h);
      await h.call("POST", "/auth/forgot-password", { email: person.email });
      await h.flush();
      const older = linkToken(h.emails.at(-1)!);
      await h.call("POST", "/auth/forgot-password", { email: person.email });
      await h.flush();
      const pw = remember("Older-link-passw0rd");
      const res = await h.call("POST", "/auth/reset-password", { token: older, password: pw, confirmPassword: pw });
      assert.equal(res.status, 400);
    });

    it("validates the new password and its confirmation", async () => {
      const token = "C".repeat(43);
      assert.equal((await h.call("POST", "/auth/reset-password", { token, password: "short", confirmPassword: "short" })).status, 400);
      assert.equal(
        (await h.call("POST", "/auth/reset-password", { token, password: "Long-enough-1", confirmPassword: "Long-enough-2" })).status,
        400,
      );
    });
  });

  describe("email verification", () => {
    it("the signup email verifies the address once", async () => {
      const fresh = await startApp({ frontendUrl: "https://app.example.test" });
      try {
        const { person, tokens } = await signup(fresh);
        await fresh.flush();
        const mail = fresh.emails.at(-1)!;
        assert.equal(mail.to, person.email);
        assert.match(mail.text, /https:\/\/app\.example\.test\/verify-email\?token=[A-Za-z0-9_-]{43}/);
        assert.ok(!mail.html.includes(person.fullName) && !mail.text.includes(person.fullName));
        const token = linkToken(mail);

        const res = await fresh.call("POST", "/auth/verify-email", { token });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.emailVerified, true);
        const me = await fresh.call("GET", "/auth/me", undefined, tokens.accessToken);
        assert.equal(me.json.data.user.emailVerified, true);

        const reuse = await fresh.call("POST", "/auth/verify-email", { token });
        assert.equal(reuse.status, 400);
        assert.equal(reuse.json.error.code, "INVALID_VERIFICATION_TOKEN");

        const count = fresh.emails.length;
        assert.equal((await fresh.call("POST", "/auth/resend-verification", undefined, tokens.accessToken)).status, 202);
        await fresh.flush();
        assert.equal(fresh.emails.length, count);
      } finally {
        await fresh.close();
      }
    });

    it("resend needs a signed-in user and replaces the earlier link", async () => {
      const { tokens } = await signup(h);
      await h.flush();
      const first = linkToken(h.emails.at(-1)!);
      assert.equal((await h.call("POST", "/auth/resend-verification")).status, 401);
      assert.equal((await h.call("POST", "/auth/resend-verification", undefined, tokens.accessToken)).status, 202);
      await h.flush();
      const second = linkToken(h.emails.at(-1)!);
      assert.notEqual(first, second);
      assert.equal((await h.call("POST", "/auth/verify-email", { token: first })).status, 400);
      assert.equal((await h.call("POST", "/auth/verify-email", { token: second })).status, 200);
    });

    it("a failed email send does not undo the signup", async () => {
      const fresh = await startApp({ failEmail: true });
      try {
        const { person } = await signup(fresh);
        await fresh.flush();
        assert.equal((await fresh.call("POST", "/auth/signin", { email: person.email, password: person.password })).status, 200);
        assert.ok(logged.some((line) => line.includes("RESEND_HTTP_500")));
      } finally {
        await fresh.close();
      }
    });
  });

  describe("rate limits (production values)", () => {
    it("the 6th signin for one email within 15 minutes gets 429", async () => {
      const fresh = await startApp({ limits: DEFAULT_AUTH_RATE_LIMITS });
      try {
        const email = remember("limited@example.test");
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
          statuses.push((await fresh.call("POST", "/auth/signin", { email, password: "Wrong-password-1" })).status);
        }
        assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
        const res = await fresh.call("POST", "/auth/signin", { email, password: "Wrong-password-1" });
        assert.equal(res.json.error.code, "RATE_LIMITED");
      } finally {
        await fresh.close();
      }
    });

    it("forgot-password over the per-email limit still answers the generic 202", async () => {
      const fresh = await startApp({ limits: DEFAULT_AUTH_RATE_LIMITS });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          statuses.push((await fresh.call("POST", "/auth/forgot-password", { email: "x-limit@example.test" })).status);
        }
        assert.deepEqual(statuses, [202, 202, 202, 202]);
      } finally {
        await fresh.close();
      }
    });

    it("the 6th signup from one IP within an hour gets 429", async () => {
      const fresh = await startApp({ limits: DEFAULT_AUTH_RATE_LIMITS });
      try {
        for (let i = 0; i < 5; i++) await signup(fresh);
        const p = newPerson();
        const res = await fresh.call("POST", "/auth/signup", { ...p, confirmPassword: p.password });
        assert.equal(res.status, 429);
      } finally {
        await fresh.close();
      }
    });
  });

  describe("app wiring", () => {
    it("keeps health unchanged, adds helmet headers, and answers unknown routes with the envelope", async () => {
      const health = await h.call("GET", "/health");
      assert.equal(health.status, 200);
      assert.deepEqual(health.json, { ok: true });
      assert.equal(health.headers.get("x-content-type-options"), "nosniff");
      assert.equal(health.headers.get("x-powered-by"), null);
      const missing = await h.call("GET", "/nope");
      assert.equal(missing.status, 404);
      assert.equal(missing.json.error.code, "NOT_FOUND");
    });
  });
});

describe("requireRole (test-only route)", () => {
  it("allows listed roles and returns 403 AUTH_INSUFFICIENT_ROLE otherwise", async () => {
    const { requireAuth, requireRole } = createAuthMiddleware(SECRET, () => START);
    const app = express();
    app.get("/admin-only", requireAuth, requireRole("admin"), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin-only`;
    try {
      const id = "8f0b6a1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
      const patient = await signAccessToken({ userId: id, role: "patient" }, SECRET, 900, START);
      const admin = await signAccessToken({ userId: id, role: "admin" }, SECRET, 900, START);
      const asPatient = await fetch(url, { headers: { Authorization: `Bearer ${patient}` } });
      assert.equal(asPatient.status, 403);
      assert.equal(((await asPatient.json()) as Json).error.code, "AUTH_INSUFFICIENT_ROLE");
      const asAdmin = await fetch(url, { headers: { Authorization: `Bearer ${admin}` } });
      assert.equal(asAdmin.status, 200);
      assert.equal((await fetch(url)).status, 401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Resend sender", () => {
  it("posts to the REST API and reports failures by status code only", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 200;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "x", echo: "secret-body" }), { status });
    }) as unknown as typeof fetch;
    const sender = createResendSender({ apiKey: "re_test_key", from: "AgentDesk <no-reply@example.test>", fetchImpl });
    const message = { to: "someone@example.test", subject: "S", html: "<p>h</p>", text: "t" };

    await sender.send(message);
    assert.equal(calls[0]!.url, "https://api.resend.com/emails");
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer re_test_key");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      from: "AgentDesk <no-reply@example.test>",
      to: ["someone@example.test"],
      subject: "S",
      html: "<p>h</p>",
      text: "t",
    });

    status = 422;
    await assert.rejects(sender.send(message), (error: Error) => {
      assert.ok(error instanceof EmailSendError);
      assert.equal(error.code, "RESEND_HTTP_422");
      assert.ok(!error.message.includes("secret-body") && !error.message.includes("someone@"));
      return true;
    });
  });
});
