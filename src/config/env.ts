import { X509Certificate } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CLINIC_TIMEZONE, isValidTimeZone } from "../utils/clinic-time";

export type Env = Readonly<{
  PORT: number;
  DATABASE_URL: string;

  DATABASE_CA_CERT_PATH: string;
  DB_POOL_MAX: number;
  DB_POOL_IDLE_TIMEOUT_MS: number;
  DB_CONNECTION_TIMEOUT_MS: number;
  CLINIC_TIMEZONE: string; // IANA zone for "today", booking windows and slot cut-offs
}>;

type Source = Record<string, string | undefined>;


// Pathway for folders
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

const FORBIDDEN_URL_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "uselibpqcompat"];

const PRIVILEGED_USERS = ["postgres", "supabase_admin"];

// Print the list of issue on the console or terminal at once
export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

// ParseEnv is used to remove the trim space from .env
export function parseEnv(source: Source): Env {
  const issues: string[] = [];

  const read = (name: string): string | undefined => {
    const value = source[name]?.trim();
    return value ? value : undefined;
  };

  // It check the setting is correct or not
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      issues.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return Number(raw);
  };

  // Default Setting
  const PORT = integer("PORT", 3000, 1, 65535);
  const DB_POOL_MAX = integer("DB_POOL_MAX", 10, 1, 100);
  const DB_POOL_IDLE_TIMEOUT_MS = integer("DB_POOL_IDLE_TIMEOUT_MS", 30_000, 0, 3_600_000);
  const DB_CONNECTION_TIMEOUT_MS = integer("DB_CONNECTION_TIMEOUT_MS", 10_000, 1, 120_000);

  const CLINIC_TIMEZONE = read("CLINIC_TIMEZONE") ?? DEFAULT_CLINIC_TIMEZONE;
  if (!isValidTimeZone(CLINIC_TIMEZONE)) issues.push("CLINIC_TIMEZONE must be an IANA time zone such as Asia/Kolkata");

  // it is making connection with DataBase
  const DATABASE_URL = read("DATABASE_URL");
  if (DATABASE_URL === undefined) {
    issues.push("DATABASE_URL is required");
  } else {
    issues.push(...checkDatabaseUrl(DATABASE_URL));
  }

  // Verify the DATABASE_CA_CERT_PATH
  const caPathRaw = read("DATABASE_CA_CERT_PATH");
  let DATABASE_CA_CERT_PATH = "";
  if (caPathRaw === undefined) {
    issues.push("DATABASE_CA_CERT_PATH is required");
  } else {
    DATABASE_CA_CERT_PATH = path.resolve(BACKEND_ROOT, caPathRaw);
    const problem = checkCaCertificate(DATABASE_CA_CERT_PATH);
    if (problem) issues.push(`DATABASE_CA_CERT_PATH ${problem}`);
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  // Ok it return the object in this format and freeze it so that no one can change the settings
  // and checks setting related to env and server
  return Object.freeze({
    PORT,
    DATABASE_URL: DATABASE_URL as string,
    DATABASE_CA_CERT_PATH,
    DB_POOL_MAX,
    DB_POOL_IDLE_TIMEOUT_MS,
    DB_CONNECTION_TIMEOUT_MS,
    CLINIC_TIMEZONE,
  });
}

// Related to Loging Part
export type AuthEnv = Readonly<{
  JWT_SECRET: Uint8Array;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_DAYS: number; // No of days
  RESEND_API_KEY: string; // email sending Key(in progress)
  EMAIL_FROM: string;

  FRONTEND_URL: string | undefined; //URL of Frontend Website
  APP_SCHEME: string;
}>;

// it check the auth settings function
export function parseAuthEnv(source: Source): AuthEnv {
  const issues: string[] = [];
  const read = (name: string): string | undefined => {
    const value = source[name]?.trim();
    return value ? value : undefined;
  };
  // it's checks whether the enter number is correct or not
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      issues.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return Number(raw);
  };

  // it checks the JSON WEB TOKEN
  const jwtSecret = read("JWT_SECRET");
  // if it absent or not in env
  if (jwtSecret === undefined) issues.push("JWT_SECRET is required");

  // it checks the length of the jwtSecret
  else if (Buffer.byteLength(jwtSecret, "utf8") < 32) issues.push("JWT_SECRET must be at least 32 bytes");

  // it chcks the Token Expiry for Access -> 15 Min and Refresh -> 30 Days
  // and if no value is provided in env use the drfualt one
  const ACCESS_TOKEN_TTL_SECONDS = integer("ACCESS_TOKEN_TTL_SECONDS", 900, 60, 3600);
  const REFRESH_TOKEN_TTL_DAYS = integer("REFRESH_TOKEN_TTL_DAYS", 30, 1, 90);

  // it checks the mail settings from RESEND API
  const RESEND_API_KEY = read("RESEND_API_KEY");
  if (RESEND_API_KEY === undefined) issues.push("RESEND_API_KEY is required");
  else if (!RESEND_API_KEY.startsWith("re_")) issues.push("RESEND_API_KEY must start with re_");

  const EMAIL_FROM = read("EMAIL_FROM");
  if (EMAIL_FROM === undefined) issues.push("EMAIL_FROM is required");
  else if (!/^(?:[^<>@\r\n]+<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/.test(EMAIL_FROM)) {
    issues.push("EMAIL_FROM must be an address or Name <address>");
  }


  /* it checks the FRONTEND_URL 
  it checks URL is Correct
  it checks HTTPS is used
  if it is on local Host HTTP is allowed
  also checks no extra path or query*/
  const FRONTEND_URL = read("FRONTEND_URL");
  if (FRONTEND_URL !== undefined) {
    let url: URL | undefined;
    try {
      url = new URL(FRONTEND_URL);
    } catch {
      issues.push("FRONTEND_URL is not a valid URL");
    }
    if (url) {
      const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
        issues.push("FRONTEND_URL must use https:// (http:// is allowed for localhost only)");
      }
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        issues.push("FRONTEND_URL must be an origin only, with no path, query, or credentials");
      }
    }
  } else if (read("NODE_ENV") === "production") {
    issues.push("FRONTEND_URL is required when NODE_ENV is production");
  }


  // This is Mobile part
  const APP_SCHEME = read("APP_SCHEME") ?? "agentdesk";
  if (!/^[a-z][a-z0-9+.-]*$/.test(APP_SCHEME)) {
    issues.push("APP_SCHEME must start with a lowercase letter and use only a-z, 0-9, +, - and .");
  }


  if (issues.length > 0) throw new EnvValidationError(issues);

  return Object.freeze({
    JWT_SECRET: new TextEncoder().encode(jwtSecret as string),
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_DAYS,
    RESEND_API_KEY: RESEND_API_KEY as string,
    EMAIL_FROM: EMAIL_FROM as string,
    FRONTEND_URL: FRONTEND_URL === undefined ? undefined : new URL(FRONTEND_URL).origin,
    APP_SCHEME,
  });
}

// it checks the Databases

function checkDatabaseUrl(value: string): string[] {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ["DATABASE_URL is not a valid URL (URL-encode special characters in the password)"];
  }

  const issues: string[] = [];
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    issues.push("DATABASE_URL must start with postgres:// or postgresql://");
  }
  if (!url.hostname) issues.push("DATABASE_URL must include a host");
  if (!url.username) issues.push("DATABASE_URL must include a username");
  if (!url.password) issues.push("DATABASE_URL must include a password");
  if (url.pathname.length <= 1) issues.push("DATABASE_URL must include a database name");

  let user = url.username;
  try {
    user = decodeURIComponent(user);
  } catch {
    issues.push("DATABASE_URL username is not correctly URL-encoded");
  }
  const baseUser = user.split(".")[0].toLowerCase();
  if (PRIVILEGED_USERS.includes(baseUser)) {
    issues.push("DATABASE_URL must use the restricted runtime role, not a privileged role");
  }

  const params = [...url.searchParams.keys()].map((key) => key.toLowerCase());
  if (params.some((key) => FORBIDDEN_URL_PARAMS.includes(key))) {
    issues.push("DATABASE_URL must not contain SSL parameters; TLS is configured in code");
  }

  return issues;
}


// it's check the CA Certificate Path if not find it throw error
function checkCaCertificate(filePath: string): string | undefined {
  try {
    if (!statSync(filePath).isFile()) return "must point to a file";
    new X509Certificate(readFileSync(filePath));
    return undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "points to a file that does not exist";
    if (code === "EACCES") return "points to a file that cannot be read";
    return "must point to a PEM-encoded X.509 certificate";
  }
}
