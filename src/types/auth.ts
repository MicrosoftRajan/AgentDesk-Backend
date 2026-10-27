/** What a signed-in user is allowed to do. Stored on `profiles`, never taken from the client. */
export type UserRole = "patient" | "staff" | "doctor" | "admin";

/** The authenticated caller, as identified by Supabase Auth. */
export interface AuthUser {
  id: string;
  email: string | null;
  /** Set by `requireRole`. Absent on routes that only call `requireAuth`. */
  role?: UserRole;
}
