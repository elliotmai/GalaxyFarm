import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens (spec §4.3).
 *
 * The link somebody follows to set their first password. What it has to be is
 * unguessable and short-lived; what it must not be is recoverable from the
 * database, because a row that can be turned back into a working link makes a
 * stolen backup a way to become the owner.
 *
 * So the row keeps a hash. **SHA-256, not scrypt** — and that is a deliberate
 * departure from how passwords are handled two files over, for two reasons.
 * The token is 256 bits from the system CSPRNG, so there is no dictionary to
 * be resistant to and nothing for a memory-hard function to buy. And the
 * accept path arrives holding only the token, so the lookup has to *find* the
 * row by it, which a per-row salt makes impossible without scanning every
 * account and burning a tenth of a second on each.
 */

const TOKEN_BYTES = 32;

export interface MintedInvitation {
  /** Goes in the link, shown once, never stored. */
  readonly token: string;
  /** Goes in the row. */
  readonly tokenHash: string;
}

export function mintInvitation(): MintedInvitation {
  // base64url: survives a URL, an email client that adds line breaks, and
  // being read down a phone if it comes to that.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * Compare in constant time.
 *
 * The lookup is by hash and a mismatched length is already a mismatch, so the
 * timing here leaks very little — but "very little" is the sort of judgement
 * that ages badly, and this costs nothing.
 */
export function invitationTokenMatches(token: string, storedHash: string): boolean {
  const offered = Buffer.from(hashInvitationToken(token));
  const stored = Buffer.from(storedHash);
  return offered.length === stored.length && timingSafeEqual(offered, stored);
}

/** Is the token in this link still worth anything? */
export function isInvitationLive(
  invitation: { readonly tokenHash?: string | undefined; readonly expiresAt?: Date | undefined },
  now: Date,
): boolean {
  if (invitation.tokenHash === undefined || invitation.tokenHash === "") return false;
  return invitation.expiresAt !== undefined && invitation.expiresAt > now;
}

/**
 * The link to hand over.
 *
 * Built here so the shape lives in one place: the accept page reads the token
 * out of the path, and a second spelling of this URL somewhere else is how
 * that quietly stops matching.
 */
export function invitationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}
