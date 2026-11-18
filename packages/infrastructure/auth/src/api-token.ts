import { createHash, randomBytes } from "node:crypto";

/**
 * Connected-app API tokens (spec §4.3 "Connected apps").
 *
 * The same shape as a kiosk device token (`pairing.ts`), for the same reason:
 * 256 bits from the system CSPRNG, never typed by anybody, so SHA-256 rather
 * than scrypt — there is no dictionary to resist, and the request path has to
 * *find* the row by the hash. Only the hash is ever stored; the token is shown
 * to the owner once, when it is minted, and never again.
 *
 * A recognisable prefix so a token pasted into the wrong place — a log line, a
 * chat, a commit — is obviously a GalaxyFarm credential rather than noise. It
 * carries no information beyond that.
 */

export const API_TOKEN_PREFIX = "gfapp_";

const TOKEN_BYTES = 32;

export interface MintedApiToken {
  /** Handed to the owner once, to paste into the other app. Never stored. */
  readonly token: string;
  /** Goes in the row. */
  readonly tokenHash: string;
}

export function mintApiToken(): MintedApiToken {
  const token = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, tokenHash: hashApiToken(token) };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * The token out of an `Authorization` header, or undefined.
 *
 * Exactly `Bearer <token>`, case-insensitive on the scheme as RFC 6750 allows,
 * and nothing else: no query-string token, no cookie, no `Basic`. A token that
 * does not look like one this module minted is refused here rather than hashed
 * and looked up, which keeps junk traffic off the database.
 */
export function bearerToken(header: string | null | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  const token = match?.[1];
  if (token === undefined) return undefined;
  if (!token.startsWith(API_TOKEN_PREFIX)) return undefined;
  // Prefix plus 43 base64url characters; a little slack either way costs
  // nothing and a megabyte header is refused before it is hashed.
  if (token.length < API_TOKEN_PREFIX.length + 40 || token.length > 128) return undefined;
  return token;
}
