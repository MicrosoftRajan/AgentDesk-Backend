import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from "node:crypto";

export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

const LIMITS = { memoryMax: 262_144, passesMax: 10, parallelismMax: 8, saltMin: 8, tagMin: 16, tagMax: 64 };

// it checks the hash format
const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

type Params = { memory: number; passes: number; parallelism: number };

// Actual password Hashing
// normalize() JavaScript ka string method hai, jo Unicode characters ko ek standardized representation mein convert karta hai.
function derive(password: string, salt: Buffer, params: Params, tagLength: number): Promise<Buffer> {
  const parameters: Argon2Parameters = {
    message: Buffer.from(password.normalize("NFKC"), "utf8"),
    nonce: salt,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength,
  };
  // Through this we have run Hashing
  return new Promise((resolve, reject) => {
    argon2("argon2id", parameters, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

// This convert Binary data into Base64 string
/* salt and hash are in binary form so we convert them into base64 string for storage in DB */
const b64 = (buffer: Buffer) => buffer.toString("base64").replace(/=+$/, "");

// Hashing the Password during SignUp
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES); // Random 16 bytes of each pass
  const hash = await derive(password, salt, ARGON2_PARAMS, ARGON2_PARAMS.tagLength); // Hashing the password
  const { memory, passes, parallelism } = ARGON2_PARAMS; // Getting the parameters from ARGON2_PARAMS
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`; // Returning the hashed password
}

// it read the value comes from DB, first check regex(valid format or invalid)
function parse(stored: string) {
  const match = PHC.exec(stored);
  if (!match) return undefined;
  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  // it decode the salt and hash intially Base64 string format, now they are converting into BinaryDB
  const salt = Buffer.from(match[4]!, "base64");
  const hash = Buffer.from(match[5]!, "base64");

  // Safety Check
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

// this is use during Login, it check the user match with hash or not 
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  // recalculate the entered password
  const candidate = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  // timingSafeEqual is used to prevent timing attacks
  return timingSafeEqual(candidate, parsed.hash);
}

export function needsRehash(stored: string): boolean {

  // parse() -> Use store hash and fetch the setting
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


// if the user password is not in DB then, we use this function
// this generates a random password and hashes it.
// it generates a dummy password hash

let dummy: Promise<string> | undefined;

export function dummyPasswordHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(32).toString("hex")));
}
