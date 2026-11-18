import { z } from "zod";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

const password = z
  .string()
  .min(PASSWORD_MIN)
  .max(PASSWORD_MAX)
  .refine((value) => value.trim().length > 0, { message: "Password cannot be only spaces" });

const opaqueToken = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);

const fullName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]+$/u, { message: "Name cannot contain control characters" });

const phone = z.string().trim().regex(/^\+[1-9]\d{7,13}$/, { message: "Use international format, e.g. +919812345678" });

const passwordsMatch = (value: { password: string; confirmPassword: string }) => value.password === value.confirmPassword;
const mismatch = { message: "Passwords do not match", path: ["confirmPassword"] };

export const signupSchema = z
  .strictObject({
    fullName,
    email,
    phone: phone.nullish(),
    password,
    confirmPassword: z.string().max(PASSWORD_MAX),
  })
  .refine(passwordsMatch, mismatch);

export const signinSchema = z.strictObject({
  email,

  password: z.string().min(1).max(PASSWORD_MAX),
});

export const refreshSchema = z.strictObject({ refreshToken: opaqueToken });

export const forgotPasswordSchema = z.strictObject({ email });

export const resetPasswordSchema = z
  .strictObject({ token: opaqueToken, password, confirmPassword: z.string().max(PASSWORD_MAX) })
  .refine(passwordsMatch, mismatch);

export const verifyEmailSchema = z.strictObject({ token: opaqueToken });

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export function normalizeEmail(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}
