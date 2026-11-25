import { createHash, randomBytes } from "node:crypto";

// randomBytes -> cryptographically secure random bytes generate
// "base64url" -> base64 encoding that is safe to use in URLs and filenames
// createHash -> to convert any value in Hash


// This function genrate a random token and return its hash
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

// this function is used to hash the token
// it uses sha256 algorithm to hash the token
// and returns the hash

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
