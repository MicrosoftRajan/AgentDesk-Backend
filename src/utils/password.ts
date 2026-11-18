import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from "node:crypto";

export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

const LIMITS = { memoryMax: 262_144, passesMax: 10, parallelismMax: 8, saltMin: 8, tagMin: 16, tagMax: 64 };

const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

type Params = { memory: number; passes: number; parallelism: number };

function derive(password: string, salt: Buffer, params: Params, tagLength: number): Promise<Buffer> {
  const parameters: Argon2Parameters = {
    message: Buffer.from(password.normalize("NFKC"), "utf8"),
    nonce: salt,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength,
  };
  return new Promise((resolve, reject) => {
    argon2("argon2id", parameters, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

const b64 = (buffer: Buffer) => buffer.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, ARGON2_PARAMS, ARGON2_PARAMS.tagLength);
  const { memory, passes, parallelism } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

function parse(stored: string) {
  const match = PHC.exec(stored);
  if (!match) return undefined;
  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  const salt = Buffer.from(match[4]!, "base64");
  const hash = Buffer.from(match[5]!, "base64");
  const ok =
    parallelism >= 1 &&
    parallelism <= LIMITS.parallelismMax &&
    passes >= 1 &&
    passes <= LIMITS.passesMax &&
    memory >= 8 * parallelism &&
    memory <= LIMITS.memoryMax &&
    salt.length >= LIMITS.saltMin &&
    hash.length >= LIMITS.tagMin &&
    hash.length <= LIMITS.tagMax;
  return ok ? { params: { memory, passes, parallelism }, salt, hash } : undefined;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  return timingSafeEqual(candidate, parsed.hash);
}

export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  const { memory, passes, parallelism } = parsed.params;
  return (
    memory < ARGON2_PARAMS.memory ||
    passes < ARGON2_PARAMS.passes ||
    parallelism !== ARGON2_PARAMS.parallelism ||
    parsed.hash.length !== ARGON2_PARAMS.tagLength
  );
}

let dummy: Promise<string> | undefined;

export function dummyPasswordHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(32).toString("hex")));
}
