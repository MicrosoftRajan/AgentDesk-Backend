import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./common/error-handler";
import { createAuthMiddleware } from "./middleware/authenticate";
import { createAuthRouter, type AuthRateLimits } from "./modules/auth/auth.routes";
import { createAuthService, type AuthServiceDeps } from "./modules/auth/auth.service";

export type AppDeps = {
  auth?: AuthServiceDeps & { limits?: AuthRateLimits };
};

export function createApp(deps: AppDeps = {}): Express {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: ["http://localhost:8081", "http://127.0.0.1:8081"],
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  );

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
    }),
  );

  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health", (req, res) => {
    res.json({ ok: true });
  });

  if (deps.auth) {
    const { requireAuth } = createAuthMiddleware(deps.auth.settings.jwtSecret, deps.auth.clock);
    app.use(
      "/api/v1/auth",
      createAuthRouter({ service: createAuthService(deps.auth), requireAuth, limits: deps.auth.limits }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
