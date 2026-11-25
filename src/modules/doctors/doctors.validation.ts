import { z } from "zod";
import { idParams, isoDate, pagination } from "../../common/schemas";
import { addDays, clinicNow } from "../../utils/clinic-time";

export { idParams };

export const MAX_DAYS_AHEAD = 90;

/* Sorting is a fixed list mapped to columns in the repository; no raw column names reach SQL. */
export const DOCTOR_SORTS = ["name", "fee", "experience"] as const;
export type DoctorSort = (typeof DOCTOR_SORTS)[number];

export const listDoctorsQuery = z.strictObject({
  ...pagination,
  specialization: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(DOCTOR_SORTS).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListDoctorsQuery = z.infer<typeof listDoctorsQuery>;

/* The window is checked against the clinic's own calendar, the same one the slot cut-off uses.
It is built per app so the clock and time zone can be injected (and faked in tests). */
export function availabilityQuery(clock: () => Date, timeZone: string) {
  return z.strictObject({
    date: isoDate.superRefine((date, ctx) => {
      const today = clinicNow(clock(), timeZone).date;
      if (date < today) {
        ctx.addIssue({ code: "too_small", origin: "date", minimum: 0, inclusive: true, input: date, message: "Date is in the past" });
      } else if (date > addDays(today, MAX_DAYS_AHEAD)) {
        ctx.addIssue({
          code: "too_big",
          origin: "date",
          maximum: MAX_DAYS_AHEAD,
          inclusive: true,
          input: date,
          message: `Date is more than ${MAX_DAYS_AHEAD} days ahead`,
        });
      }
    }),
  });
}
export type AvailabilityQuery = { date: string };

const MAX_FEE = 99_999_999.99; // numeric(10, 2)

export const updateDoctorBody = z
  .strictObject({
    specialization: z.string().trim().min(1).max(100),
    qualification: z.string().trim().min(1).max(200),
    experienceYears: z.number().int().min(0).max(80),
    consultationFee: z
      .number()
      .positive()
      .max(MAX_FEE)
      .refine((fee) => Math.abs(Math.round(fee * 100) - fee * 100) < 1e-6, { message: "Use at most 2 decimal places" }),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field to change" });
export type UpdateDoctorBody = z.infer<typeof updateDoctorBody>;
