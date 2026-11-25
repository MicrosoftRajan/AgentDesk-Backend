/* Shared request schemas, reused by every module so IDs, dates and paging are checked the same way. */
import { z } from "zod";
import { isIsoDate } from "../utils/clinic-time";

export const uuid = z.uuid();

export const idParams = z.strictObject({ id: uuid });

/* A real calendar date written as YYYY-MM-DD. */
export const isoDate = z.string().refine(isIsoDate, { message: "Use a real date in YYYY-MM-DD format" });

/* Query strings arrive as text; this accepts only plain whole numbers ("1", "20"), not "1e3" or " 2". */
const wholeNumber = (min: number, max: number, fallback: number) =>
  z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(fallback);

export const MAX_PAGE_SIZE = 100;

export const pagination = {
  page: wholeNumber(1, 10_000, 1),
  pageSize: wholeNumber(1, MAX_PAGE_SIZE, 20),
};

export type Page = { page: number; pageSize: number };

export function pageInfo({ page, pageSize }: Page, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
