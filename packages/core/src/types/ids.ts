import { z } from "zod";

/**
 * ULIDs, not UUIDs.
 *
 * Every id is generated on-device, often offline, and has to survive being
 * merged with ids from another device later (spec §4.2). ULIDs are unique
 * without coordination like UUIDs, but they also sort by creation time, which
 * means the outbox drains in a sensible order and list queries get a usable
 * default sort for free.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export type Ulid = string & { readonly __brand: "Ulid" };

export const ulidSchema = z
  .string()
  .regex(ULID_PATTERN, "Not a valid ULID")
  .transform((value) => value as Ulid);

export function isUlid(value: string): value is Ulid {
  return ULID_PATTERN.test(value);
}

/**
 * Encode a timestamp and 80 bits of randomness as a 26-character ULID.
 *
 * `random` is injected rather than reaching for `Math.random` directly so the
 * domain layer stays pure and tests can be deterministic.
 */
export function encodeUlid(timestampMs: number, random: () => number = Math.random): Ulid {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError(`ULID timestamp must be a non-negative number, got ${timestampMs}`);
  }
  if (timestampMs > 0xffffffffffff) {
    throw new RangeError("ULID timestamp exceeds the 48 bits available");
  }

  let time = "";
  let remaining = Math.floor(timestampMs);
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }

  let randomness = "";
  for (let i = 0; i < 16; i++) {
    randomness += CROCKFORD[Math.floor(random() * 32) % 32];
  }

  return (time + randomness) as Ulid;
}

/** Milliseconds since the epoch encoded in a ULID's time component. */
export function ulidTimestamp(id: Ulid): number {
  let time = 0;
  for (const char of id.slice(0, 10)) {
    time = time * 32 + CROCKFORD.indexOf(char);
  }
  return time;
}
