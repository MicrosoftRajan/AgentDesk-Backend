
/*  It is responsible for creating the express application and setting up the middleware and routes. */
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./common/error-handler";
import { createAuthMiddleware } from "./middleware/authenticate";
import { createAuthRouter, type AuthRateLimits } from "./modules/auth/auth.routes";
import { createAuthService, type AuthServiceDeps } from "./modules/auth/auth.service";
import { createProtection } from "./middleware/protect";
import { createDoctorsRouter } from "./modules/doctors/doctors.routes";
import { createDoctorsService, type DoctorsServiceDeps } from "./modules/doctors/doctors.service";

/* AppDeps is a blueprint for the application's dependencies. 
It defines that auth is optional, and if provided, 
it can contain the properties of AuthServiceDeps along with an 
optional limits configuration. */
export type AppDeps = {
  auth?: AuthServiceDeps & { limits?: AuthRateLimits };
  doctors?: DoctorsServiceDeps;
};

export function createApp(deps: AppDeps = {}): Express {
  // create an express instance
  const app = express();


  /* Helmet adds security-related HTTP headers 
  to help protect our application against common web vulnerabilities. */
  app.use(helmet());

  app.use(
    cors({
      origin: ["http://localhost:8081", "http://127.0.0.1:8081"],
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  );


  /* We use Rate Limit 
  1. To Block Spam Req 
  2.  Reduce the chances of Brute Froce Attack
  3. */
  app.use( // Global MiddleWare
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
    }),
  );

  // 
  app.use(express.json({ limit: "100kb" }));

  // Check the health
  app.get("/api/v1/health", (req, res) => {
    res.json({ ok: true });
  });

  // One token/role middleware for the whole app, shared by every module.
  const guards = deps.auth ? createAuthMiddleware(deps.auth.settings.jwtSecret, deps.auth.clock) : undefined;

  if (deps.auth && guards) {
    app.use(
      "/api/v1/auth",
      createAuthRouter({ service: createAuthService(deps.auth), requireAuth: guards.requireAuth, limits: deps.auth.limits }),
    );
  }

  if (deps.doctors) {
    // Never serve doctors without the token check: refuse to start instead.
    if (!guards) throw new Error("Doctors API needs auth settings to verify tokens");
    app.use(
      "/api/v1/doctors",
      createDoctorsRouter({
        service: createDoctorsService(deps.doctors),
        protection: createProtection(guards),
        clock: deps.doctors.clock,
        timeZone: deps.doctors.timeZone,
      }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
