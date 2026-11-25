import { jwtVerify, SignJWT } from "jose"; // jose is security lib for handling token
import type { UserRole } from "../models/enums";
import { userRole } from "../models/enums";

export const JWT_ISSUER = "agentdesk-api"; // JWT_ISSUER -> who is creating the token
export const JWT_AUDIENCE = "agentdesk-app"; // JWT_AUDIENCE -> who can use the token
const CLOCK_TOLERANCE_SECONDS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// We identify the user and it's role
export type AccessClaims = { userId: string; role: UserRole };


export async function signAccessToken(
  claims: AccessClaims, // info of userid and UserRole
  secret: Uint8Array, // It will be saved in .env as JWT_SECRET -> this is just to sign the token
  ttlSeconds: number, // time to live in seconds
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000); // iat -> issued At (when token is created)
  return new SignJWT({ role: claims.role }) // we add role
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }) // hs256 is algorithm
    .setSubject(claims.userId) // user id
    .setIssuer(JWT_ISSUER) // who created it
    .setAudience(JWT_AUDIENCE) // who can use it
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(secret);
}

// This is the custom error class, if the token is invalid, we throw this error
export class InvalidAccessToken extends Error {
  constructor() {
    super("Invalid access token");
    this.name = "InvalidAccessToken";
  }
}

// This function will verify the token
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

    // check the role for the token
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new InvalidAccessToken();
    if (typeof role !== "string" || !(userRole.enumValues as readonly string[]).includes(role)) {
      throw new InvalidAccessToken();
    }
    return { userId: payload.sub, role: role as UserRole };
  } catch {
    throw new InvalidAccessToken();
  }
}
