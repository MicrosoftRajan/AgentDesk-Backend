import type { ToolResult } from "./tool.types.js";

export function ok(data: unknown): ToolResult {
  return { success: true, data };
}

export function fail(error: unknown, fallback: string): ToolResult {
  return {
    success: false,
    data: null,
    error: error instanceof Error ? error.message : fallback,
  };
}

export function asObject(
  input: unknown,
  toolName: string,
): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    throw new Error(`${toolName} input must be an object`);
  }

  return input as Record<string, unknown>;
}

export function requiredString(
  value: Record<string, unknown>,
  field: string,
  maxLength = 200,
): string {
  const raw = value[field];

  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} is required`);
  }

  const trimmed = raw.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long`);
  }

  return trimmed;
}

export function optionalString(
  value: Record<string, unknown>,
  field: string,
  maxLength = 200,
): string | null {
  const raw = value[field];

  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  return requiredString(value, field, maxLength);
}

export function requiredId(
  value: Record<string, unknown>,
  field = "appointment_id",
): string {
  const id = requiredString(value, field, 64);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new Error(`${field} must be a valid appointment id`);
  }

  return id;
}

/**
 * Parses an ISO 8601 timestamp. A timezone offset is mandatory, so the
 * model cannot silently book in the server's timezone.
 */
export function requiredFutureDate(
  value: Record<string, unknown>,
  field: string,
): string {
  const raw = requiredString(value, field, 40);

  if (!/(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw new Error(
      `${field} must include a timezone offset, e.g. 2026-10-08T15:30:00+05:30`,
    );
  }

  const time = Date.parse(raw);

  if (Number.isNaN(time)) {
    throw new Error(`${field} is not a valid date-time`);
  }

  if (time <= Date.now()) {
    throw new Error(`${field} must be in the future`);
  }

  return new Date(time).toISOString();
}
