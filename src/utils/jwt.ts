import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "../models/enums";
import { userRole } from "../models/enums";

export const JWT_ISSUER = "agentdesk-api";
export const JWT_AUDIENCE = "agentdesk-app";
const CLOCK_TOLERANCE_SECONDS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccessClaims = { userId: string; role: UserRole };

export async function signAccessToken(
  claims: AccessClaims,
  secret: Uint8Array,
  ttlSeconds: number,
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(secret);
}

export class InvalidAccessToken extends Error {
  constructor() {
    super("Invalid access token");
    this.name = "InvalidAccessToken";
  }
}

export async function verifyAccessToken(token: string, secret: Uint8Array, now: Date): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    });
    const role = payload.role;
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new InvalidAccessToken();
    if (typeof role !== "string" || !(userRole.enumValues as readonly string[]).includes(role)) {
      throw new InvalidAccessToken();
    }
    return { userId: payload.sub, role: role as UserRole };
  } catch {
    throw new InvalidAccessToken();
  }
}
