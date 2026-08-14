import { eq } from "drizzle-orm";

import type { Ulid } from "@galaxy-farm/core";
import { hashPassword, verifyPassword } from "@galaxy-farm/infra-auth";
import { kioskPins, type Database } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";

/**
 * The shared kiosk PIN (spec §4.3, §4.4, §4.5 tier "Elevated").
 *
 * One row per property. Hashed with `hashPassword` — the same scrypt used for
 * a person's password, and for the same reason: a PIN is chosen by a human, so
 * it is exactly the kind of low-entropy secret a memory-hard KDF is for. That
 * is the opposite call from `pairing.ts`'s device token, which is 256 bits of
 * CSPRNG with nothing to be resistant to.
 *
 * `kioskPins` is deliberately not a `Repository` and not in `allTables` — see
 * the doc comment on the table itself. This file is its only reader and
 * writer, on the server, the same shape as `credential-store.ts` for `users`.
 */

export async function hasKioskPin(propertyId: Ulid, db: Database = database()): Promise<boolean> {
  const [row] = await db
    .select()
    .from(kioskPins)
    .where(eq(kioskPins.propertyId, propertyId))
    .limit(1);
  return row !== undefined && row.pinHash !== null && row.pinHash !== "";
}

export async function setKioskPin(
  propertyId: Ulid,
  pin: string,
  now: Date,
  db: Database = database(),
): Promise<void> {
  const pinHash = await hashPassword(pin);

  await db
    .insert(kioskPins)
    .values({ propertyId, pinHash, updatedAt: now })
    .onConflictDoUpdate({ target: kioskPins.propertyId, set: { pinHash, updatedAt: now } });
}

/** Turn the gate off. An unset PIN means the Elevated dialog has no PIN field at all. */
export async function clearKioskPin(
  propertyId: Ulid,
  now: Date,
  db: Database = database(),
): Promise<void> {
  await db
    .insert(kioskPins)
    .values({ propertyId, pinHash: null, updatedAt: now })
    .onConflictDoUpdate({ target: kioskPins.propertyId, set: { pinHash: null, updatedAt: now } });
}

/**
 * Checked server-side, always. The plaintext PIN never ships to a browser —
 * unlike `packages/ui`'s `ConfirmDialog`, which compares a PIN it was handed
 * as a prop, a kiosk screen calls a server action and learns only yes or no.
 */
export async function verifyKioskPin(
  propertyId: Ulid,
  pin: string,
  db: Database = database(),
): Promise<boolean> {
  if (pin.trim() === "") return false;

  const [row] = await db
    .select()
    .from(kioskPins)
    .where(eq(kioskPins.propertyId, propertyId))
    .limit(1);

  if (row === undefined || row.pinHash === null || row.pinHash === "") return false;
  return verifyPassword(pin, row.pinHash);
}
