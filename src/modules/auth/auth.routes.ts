import { Router, type RequestHandler } from "express";
import { rateLimit, type Options } from "express-rate-limit";
import { errorBody, sendData } from "../../common/http";
import { validateBody } from "../../middleware/validate";
import { hashToken } from "../../utils/token";
import { createAuthController, FORGOT_PASSWORD_MESSAGE } from "./auth.controller";
import type { AuthService } from "./auth.service";
import {
  forgotPasswordSchema,
  normalizeEmail,
  refreshSchema,
  resetPasswordSchema,
  signinSchema,
  signupSchema,
  verifyEmailSchema,
} from "./auth.validation";

type Window = { limit: number; windowMs: number };
const MINUTE = 60_000;

export type AuthRateLimits = {
  signupPerIp: Window;
  signinPerIp: Window;
  signinPerEmail: Window;
  forgotPerIp: Window;
  forgotPerEmail: Window;
  resendPerUser: Window;
  tokenPerIp: Window;
};

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  signupPerIp: { limit: 5, windowMs: 60 * MINUTE },
  signinPerIp: { limit: 10, windowMs: 15 * MINUTE },
  signinPerEmail: { limit: 5, windowMs: 15 * MINUTE },
  forgotPerIp: { limit: 5, windowMs: 60 * MINUTE },
  forgotPerEmail: { limit: 3, windowMs: 60 * MINUTE },
  resendPerUser: { limit: 3, windowMs: 60 * MINUTE },
  tokenPerIp: { limit: 20, windowMs: 15 * MINUTE },
};

const tooMany: Options["handler"] = (_req, res) => {
  res.status(429).json(errorBody("RATE_LIMITED", "Too many attempts. Try again later."));
};

function limiter(window: Window, extra: Partial<Options> = {}): RequestHandler {
  return rateLimit({ ...window, standardHeaders: "draft-8", legacyHeaders: false, handler: tooMany, ...extra });
}

function emailLimiter(window: Window, extra: Partial<Options> = {}): RequestHandler {
  return limiter(window, {
    keyGenerator: (req) => `email:${hashToken(normalizeEmail(req.body?.email) ?? "")}`,
    skip: (req) => normalizeEmail(req.body?.email) === undefined,
    ...extra,
  });
}

export function createAuthRouter(deps: {
  service: AuthService;
  requireAuth: RequestHandler;
  limits?: AuthRateLimits;
}): Router {
  const limits = deps.limits ?? DEFAULT_AUTH_RATE_LIMITS;
  const c = createAuthController(deps.service);
  const router = Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/signup", limiter(limits.signupPerIp), validateBody(signupSchema), c.signup);
  router.post(
    "/signin",
    limiter(limits.signinPerIp),
    emailLimiter(limits.signinPerEmail),
    validateBody(signinSchema),
    c.signin,
  );
  router.post("/refresh", limiter(limits.tokenPerIp), validateBody(refreshSchema), c.refresh);
  router.post("/logout", limiter(limits.tokenPerIp), validateBody(refreshSchema), c.logout);
  router.get("/me", deps.requireAuth, c.me);
  router.post(
    "/forgot-password",
    limiter(limits.forgotPerIp),

    emailLimiter(limits.forgotPerEmail, {
      handler: (_req, res) => sendData(res, 202, { message: FORGOT_PASSWORD_MESSAGE }),
    }),
    validateBody(forgotPasswordSchema),
    c.forgotPassword,
  );
  router.post("/reset-password", limiter(limits.tokenPerIp), validateBody(resetPasswordSchema), c.resetPassword);
  router.post("/verify-email", limiter(limits.tokenPerIp), validateBody(verifyEmailSchema), c.verifyEmail);
  router.post(
    "/resend-verification",
    deps.requireAuth,
    limiter(limits.resendPerUser, { keyGenerator: (_req, res) => `user:${res.locals.auth?.userId ?? ""}` }),
    c.resendVerification,
  );

  return router;
}
