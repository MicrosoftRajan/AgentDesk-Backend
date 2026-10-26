import { HttpError } from "../../utils/http.js";
import {
  PHONE_PATTERN,
  bodyObject,
  trimmedString,
} from "../../utils/validation.js";

export function validateProfileBody(
  body: unknown,
):
  | { ok: true; fullName: string; phone: string }
  | { ok: false; code: string; message: string } {
  const record = bodyObject(body);
  const fullName = trimmedString(record.fullName, 100);
  const phone = trimmedString(record.phone, 20);

  if (!fullName) {
    return {
      ok: false,
      code: "INVALID_NAME",
      message: "Enter your full name (max 100 characters).",
    };
  }

  if (!phone || !PHONE_PATTERN.test(phone)) {
    return {
      ok: false,
      code: "INVALID_PHONE",
      message: "Enter a valid phone number, e.g. +919876543210.",
    };
  }

  return { ok: true, fullName, phone };
}

export function parseScheduledAt(
  body: unknown,
):
  | { ok: true; scheduledAt: string }
  | { ok: false; code: string; message: string } {
  const record = bodyObject(body);
  const rawScheduledAt = trimmedString(record.scheduledAt, 40);
  const scheduledTime = rawScheduledAt ? Date.parse(rawScheduledAt) : NaN;

  if (!rawScheduledAt || Number.isNaN(scheduledTime)) {
    return {
      ok: false,
      code: "INVALID_TIME",
      message: "Choose a valid appointment time.",
    };
  }

  return {
    ok: true,
    scheduledAt: new Date(scheduledTime).toISOString(),
  };
}

export function parseReason(
  body: unknown,
):
  | { ok: true; reason: string | null }
  | { ok: false; code: string; message: string } {
  const record = bodyObject(body);

  if (
    record.reason !== undefined &&
    record.reason !== null &&
    record.reason !== ""
  ) {
    const reason = trimmedString(record.reason, 200);

    if (!reason) {
      return {
        ok: false,
        code: "INVALID_REASON",
        message: "Reason must be under 200 characters.",
      };
    }

    return { ok: true, reason };
  }

  return { ok: true, reason: null };
}

export function rejectInvalid(result: {
  ok: false;
  code: string;
  message: string;
}): never {
  throw new HttpError(400, result.code, result.message);
}
