

/* This is the main entry point of the application. */

import { createDatabase } from "./config/database";
import { EnvValidationError, parseAuthEnv, parseEnv, type AuthEnv, type Env } from "./config/env";
import { createDrizzleAuthRepository } from "./modules/auth/auth.repository";
import { deferWithSetImmediate } from "./modules/auth/auth.service";
import { createDrizzleDoctorsRepository } from "./modules/doctors/doctors.repository";
import { startServer } from "./server";
import { createResendSender } from "./services/email.service";

let env: Env;
let authEnv: AuthEnv;

try {
  const issues: string[] = [];
  const attempt = <T>(parse: () => T): T | undefined => {
    try {
      return parse();
    } catch (error) {
      if (!(error instanceof EnvValidationError)) throw error;
      issues.push(...error.issues);
      return undefined;
    }
  };
  const parsedEnv = attempt(() => parseEnv(process.env));
  const parsedAuthEnv = attempt(() => parseAuthEnv(process.env));
  if (issues.length > 0 || !parsedEnv || !parsedAuthEnv) throw new EnvValidationError(issues);
  env = parsedEnv;
  authEnv = parsedAuthEnv;
} catch (error) {
  if (!(error instanceof EnvValidationError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const database = createDatabase(env);

startServer(env, [{ name: "database pool", run: database.close }], {
  auth: {
    repo: createDrizzleAuthRepository(database.db),
    email: createResendSender({ apiKey: authEnv.RESEND_API_KEY, from: authEnv.EMAIL_FROM }),
    settings: {
      jwtSecret: authEnv.JWT_SECRET,
      accessTokenTtlSeconds: authEnv.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: authEnv.REFRESH_TOKEN_TTL_DAYS,
      frontendUrl: authEnv.FRONTEND_URL,
      appScheme: authEnv.APP_SCHEME,
    },
    clock: () => new Date(),
    defer: deferWithSetImmediate,
  },
  doctors: {
    repo: createDrizzleDoctorsRepository(database.db),
    clock: () => new Date(),
    timeZone: env.CLINIC_TIMEZONE,
  },
});
