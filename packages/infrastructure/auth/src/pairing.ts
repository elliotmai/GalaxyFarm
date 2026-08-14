import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * Kiosk device pairing (spec §4.4).
 *
 * Two secrets, two different shapes, for the same reason `invitation.ts` gives
 * two treatments to one problem: what each one has to resist.
 *
 * The **pairing code** is typed by a person standing at a barn screen with a
 * gloved thumb, so it has to be short and unambiguous — six characters from an
 * alphabet with no `0`/`O`, `1`/`I`/`L`. Short means guessable, so it is
 * single-use, expires quickly (`PAIRING_TTL_MINUTES`), and is stored in the
 * clear: it is worthless the moment it is redeemed or expires, so there is
 * nothing a leaked row would give away that a stopwatch would not already have
 * taken back.
 *
 * The **device token** is what the code turns into: 256 bits from the system
 * CSPRNG, held by the screen for as long as it stays paired. It is never typed
 * by anyone, so it can be long, and it is looked up the same way an invitation
 * token is — SHA-256, not scrypt, because there is no dictionary to be
 * resistant to and the accept path has to *find* the row by it.
 */

const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;
export const PAIRING_TTL_MINUTES = 15;

const TOKEN_BYTES = 32;

/** Six characters, easy to read off a phone and type into a screen across the barn. */
export function mintPairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_ALPHABET[randomInt(0, PAIRING_ALPHABET.length)];
  }
  return code;
}

/** How the code is compared: case- and space-insensitive, since it is read aloud as often as typed. */
export function normalisePairingCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function pairingExpiry(now: Date): Date {
  return new Date(now.getTime() + PAIRING_TTL_MINUTES * 60_000);
}

export interface MintedDeviceToken {
  /** Handed to the screen once, to hold as its session credential. Never stored. */
  readonly token: string;
  /** Goes in the row. */
  readonly tokenHash: string;
}

export function mintDeviceToken(): MintedDeviceToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
