import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing, on Node's own scrypt.
 *
 * No dependency at all, which is the point. bcrypt and argon2 are both native
 * modules that need compiling for whatever the deployment target happens to
 * be, and §2 says the move from Netlify to a box in the barn should be a
 * change of `DATABASE_URL` — not a rebuild that fails on a Raspberry Pi
 * because a binding was built for x86. scrypt is in the standard library, is
 * memory-hard, and is what RFC 7914 exists for.
 *
 * The hash string carries its own parameters, so raising the cost later does
 * not invalidate the hashes already stored — `verify` reads N, r, and p from
 * the record it is checking rather than assuming today's settings.
 */

/**
 * Cost parameters. N is the memory/CPU cost; 2^16 puts a single hash at
 * roughly a tenth of a second and 64 MB, which is unremarkable for a sign-in
 * and expensive across a stolen table.
 */
export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
}

export const SCRYPT_PARAMS: ScryptParams = { N: 65_536, r: 8, p: 1, keyLength: 64 };

/**
 * Promisified `scrypt`. Hand-written rather than `promisify`d because the
 * options overload does not survive promisify's type inference.
 */
function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

const SALT_BYTES = 16;
const PREFIX = "scrypt";

/** `scrypt$N$r$p$salt$hash`, all base64url after the parameters. */
export async function hashPassword(
  password: string,
  params: ScryptParams = SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password.normalize("NFKC"), salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    // Node's default maxmem is 32 MB, which N=2^16 exceeds. Without this the
    // call throws rather than running slowly, which is a confusing failure.
    maxmem: 256 * params.N * params.r,
  });

  return [
    PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Check a password against a stored hash.
 *
 * Never throws on a malformed record — a corrupt row is a failed sign-in, not
 * a 500 that tells an attacker they found something interesting.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (parsed === undefined) return false;

  const derived = await derive(password.normalize("NFKC"), parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: 256 * parsed.N * parsed.r,
  });

  // Constant-time: a byte-by-byte comparison leaks how much of the hash
  // matched, which is enough to reconstruct it one byte at a time.
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

export function parseHash(stored: string): ParsedHash | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return undefined;

  const [, n, r, p, salt, hash] = parts;
  const parsed = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt!, "base64url"),
    hash: Buffer.from(hash!, "base64url"),
  };

  const sane =
    Number.isInteger(parsed.N) &&
    Number.isInteger(parsed.r) &&
    Number.isInteger(parsed.p) &&
    parsed.N > 1 &&
    parsed.r > 0 &&
    parsed.p > 0 &&
    parsed.salt.length > 0 &&
    parsed.hash.length > 0;

  return sane ? parsed : undefined;
}

/**
 * Was this hash made with weaker parameters than we use now?
 *
 * Sign-in is the only moment the plaintext exists, so it is the only moment a
 * hash can be upgraded. Callers re-hash and store when this says yes.
 */
export function needsRehash(stored: string, params: ScryptParams = SCRYPT_PARAMS): boolean {
  const parsed = parseHash(stored);
  if (parsed === undefined) return true;
  return parsed.N < params.N || parsed.r < params.r || parsed.p < params.p;
}
