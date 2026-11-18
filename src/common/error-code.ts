export function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code) return String(error.code);
  return error instanceof Error ? error.name : "unknown";
}
