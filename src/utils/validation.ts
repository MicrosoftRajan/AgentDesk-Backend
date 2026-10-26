export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,18}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

/** Trimmed non-empty string within `maxLength`, or null. */
export function trimmedString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}
