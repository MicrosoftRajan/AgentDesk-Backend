export function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code) return String(error.code);
  return error instanceof Error ? error.name : "unknown";
}


/* When an error occurs, it may contain a lot of information. 
This function tries to extract a short identifier from that error, 
such as its error code or error name, so we can identify
the type of issue without logging the entire error object.
 If it cannot identify the error, it simply returns 'unknown' */