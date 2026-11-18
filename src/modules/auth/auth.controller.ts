import type { RequestHandler } from "express";
import { AppError, sendData } from "../../common/http";
import type { AuthService } from "./auth.service";

export const FORGOT_PASSWORD_MESSAGE = "If an account exists for that email, a reset link has been sent.";

export function createAuthController(service: AuthService) {
  const userId = (locals: { auth?: { userId: string } }) => {
    if (!locals.auth) throw new AppError(401, "AUTH_INVALID_TOKEN", "Sign in again");
    return locals.auth.userId;
  };

  const handlers = {
    signup: async (req, res) => sendData(res, 201, await service.signup(req.body)),
    signin: async (req, res) => sendData(res, 200, await service.signin(req.body)),
    refresh: async (req, res) => sendData(res, 200, { tokens: await service.refresh(req.body.refreshToken) }),
    logout: async (req, res) => {
      await service.logout(req.body.refreshToken);
      res.status(204).end();
    },
    me: async (_req, res) => sendData(res, 200, { user: await service.me(userId(res.locals)) }),
    forgotPassword: (req, res) => {
      service.forgotPassword(req.body.email);
      sendData(res, 202, { message: FORGOT_PASSWORD_MESSAGE });
    },
    resetPassword: async (req, res) => {
      await service.resetPassword(req.body);
      sendData(res, 200, { message: "Your password has been reset. Sign in with the new password." });
    },
    verifyEmail: async (req, res) => {
      await service.verifyEmail(req.body.token);
      sendData(res, 200, { emailVerified: true });
    },
    resendVerification: async (_req, res) => {
      await service.resendVerification(userId(res.locals));
      sendData(res, 202, { message: "If your email is not verified yet, a new link has been sent." });
    },
  } satisfies Record<string, RequestHandler>;

  return handlers;
}
