import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { EnvValidationError, parseAuthEnv, parseEnv } from "../src/config/env";

const BACKEND = path.resolve(__dirname, "..");
const CA = path.join(__dirname, "fixtures", "test-ca.crt");
const SECRET = "Sup3rS3cretPw";
const VALID_URL = `postgresql://agentdesk_app.abcdref:${SECRET}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;

function issuesOf(source: Record<string, string>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.issues;
  }
  assert.fail("expected EnvValidationError");
}

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", ...args], {
    cwd: BACKEND,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...extraEnv },
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("parseEnv", () => {
  it("can be called with {} without terminating the process", () => {
    assert.throws(() => parseEnv({}), EnvValidationError);
    assert.deepEqual(issuesOf({}), ["DATABASE_URL is required", "DATABASE_CA_CERT_PATH is required"]);
  });

  it("reports multiple invalid values together", () => {
    const issues = issuesOf({
      PORT: "abc",
      DB_POOL_MAX: "0",
      DB_CONNECTION_TIMEOUT_MS: "0",
      DATABASE_URL: `${VALID_URL}?sslmode=require`,
      DATABASE_CA_CERT_PATH: "does/not/exist.crt",
    });
    assert.deepEqual(issues, [
      "PORT must be a whole number from 1 to 65535",
      "DB_POOL_MAX must be a whole number from 1 to 100",
      "DB_CONNECTION_TIMEOUT_MS must be a whole number from 1 to 120000",
      "DATABASE_URL must not contain SSL parameters; TLS is configured in code",
      "DATABASE_CA_CERT_PATH points to a file that does not exist",
    ]);
  });

  it("returns a frozen configuration with defaults for valid input", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL, DATABASE_CA_CERT_PATH: CA });
    assert.deepEqual(env, {
      PORT: 3000,
      DATABASE_URL: VALID_URL,
      DATABASE_CA_CERT_PATH: CA,
      DB_POOL_MAX: 10,
      DB_POOL_IDLE_TIMEOUT_MS: 30_000,
      DB_CONNECTION_TIMEOUT_MS: 10_000,
    });
    assert.ok(Object.isFrozen(env));

    assert.equal(Reflect.set(env, "PORT", 1), false);
    assert.equal(env.PORT, 3000);
  });

  it("resolves a relative CA path from backend/", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL, DATABASE_CA_CERT_PATH: "test/fixtures/test-ca.crt" });
    assert.equal(env.DATABASE_CA_CERT_PATH, CA);
  });

  it("refuses privileged roles", () => {
    for (const user of ["postgres", "postgres.abcdref", "supabase_admin.abcdref"]) {
      const issues = issuesOf({
        DATABASE_URL: VALID_URL.replace("agentdesk_app.abcdref", user),
        DATABASE_CA_CERT_PATH: CA,
      });
      assert.deepEqual(issues, ["DATABASE_URL must use the restricted runtime role, not a privileged role"]);
    }
  });

  it("never puts secret values in error messages", () => {
    const sources = [
      { DATABASE_URL: `not a url ${SECRET}`, DATABASE_CA_CERT_PATH: CA },
      { DATABASE_URL: `${VALID_URL}?sslmode=disable`, DATABASE_CA_CERT_PATH: CA },
      { DATABASE_URL: VALID_URL.replace("agentdesk_app", "postgres"), DATABASE_CA_CERT_PATH: CA },
      { DATABASE_URL: VALID_URL, DATABASE_CA_CERT_PATH: path.join(__dirname, "env.test.ts") },
    ];
    for (const source of sources) {
      const error = (() => {
        try {
          parseEnv(source);
        } catch (caught) {
          return caught as Error;
        }
      })();
      assert.ok(error instanceof EnvValidationError);
      for (const secret of [SECRET, "pooler.supabase.com", "abcdref", __dirname]) {
        assert.ok(!error.message.includes(secret), `message leaked ${secret}`);
      }
    }
  });
});

describe("parseAuthEnv", () => {
  const JWT = "x".repeat(48);
  const valid = { JWT_SECRET: JWT, RESEND_API_KEY: "re_test_key_123", EMAIL_FROM: "AgentDesk <no-reply@example.com>" };

  function authIssues(source: Record<string, string>): string[] {
    try {
      parseAuthEnv(source);
    } catch (error) {
      assert.ok(error instanceof EnvValidationError);
      return error.issues;
    }
    assert.fail("expected EnvValidationError");
  }

  it("requires the secret, the Resend key and the sender", () => {
    assert.deepEqual(authIssues({}), ["JWT_SECRET is required", "RESEND_API_KEY is required", "EMAIL_FROM is required"]);
  });

  it("applies defaults and returns frozen settings", () => {
    const env = parseAuthEnv(valid);
    assert.equal(env.ACCESS_TOKEN_TTL_SECONDS, 900);
    assert.equal(env.REFRESH_TOKEN_TTL_DAYS, 30);
    assert.equal(env.APP_SCHEME, "agentdesk");
    assert.equal(env.FRONTEND_URL, undefined);
    assert.equal(env.JWT_SECRET.byteLength, 48);
    assert.ok(Object.isFrozen(env));
  });

  it("rejects weak or malformed values without echoing them", () => {
    const issues = authIssues({
      JWT_SECRET: "short-secret-value",
      RESEND_API_KEY: "sk_wrong_prefix",
      EMAIL_FROM: "not-an-address",
      ACCESS_TOKEN_TTL_SECONDS: "5",
      FRONTEND_URL: "http://app.example.com/path",
      APP_SCHEME: "Bad Scheme",
    });
    assert.deepEqual(issues, [
      "JWT_SECRET must be at least 32 bytes",
      "ACCESS_TOKEN_TTL_SECONDS must be a whole number from 60 to 3600",
      "RESEND_API_KEY must start with re_",
      "EMAIL_FROM must be an address or Name <address>",
      "FRONTEND_URL must use https:// (http:// is allowed for localhost only)",
      "FRONTEND_URL must be an origin only, with no path, query, or credentials",
      "APP_SCHEME must start with a lowercase letter and use only a-z, 0-9, +, - and .",
    ]);
    for (const issue of issues) {
      for (const value of ["short-secret-value", "sk_wrong_prefix", "app.example.com"]) {
        assert.ok(!issue.includes(value), `issue leaked ${value}`);
      }
    }
  });

  it("requires FRONTEND_URL in production and keeps only its origin", () => {
    assert.deepEqual(authIssues({ ...valid, NODE_ENV: "production" }), ["FRONTEND_URL is required when NODE_ENV is production"]);
    assert.equal(parseAuthEnv({ ...valid, FRONTEND_URL: "https://app.example.com/" }).FRONTEND_URL, "https://app.example.com");
    assert.equal(parseAuthEnv({ ...valid, FRONTEND_URL: "http://localhost:8081" }).FRONTEND_URL, "http://localhost:8081");
  });
});

describe("module and startup behaviour", () => {
  it("importing config/env alone does not validate or terminate", () => {
    const result = run(["-e", 'require("./src/config/env"); console.log("still running")']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "still running");
    assert.equal(result.stderr, "");
  });

  it("invalid startup configuration exits with code 1 without listening", () => {
    const result = run(["src/index.ts"], { DATABASE_URL: `${VALID_URL}?sslmode=require`, PORT: "x" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid environment configuration/);
    assert.match(result.stderr, /PORT must be a whole number/);
    assert.match(result.stderr, /DATABASE_URL must not contain SSL parameters/);
    assert.match(result.stderr, /DATABASE_CA_CERT_PATH is required/);
    assert.ok(!result.stdout.includes("API listening"));
    assert.ok(!(result.stdout + result.stderr).includes(SECRET));
  });
});
