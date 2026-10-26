import type { AuthUser } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Present on routes behind that middleware. */
      user?: AuthUser;
    }
  }
}

export {};
