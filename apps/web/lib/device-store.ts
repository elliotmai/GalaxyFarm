import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { encodeUlid, type Ulid } from "@galaxy-farm/core";
import {
  hashDeviceToken,
  mintDeviceToken,
  mintPairingCode,
  normalisePairingCode,
  pairingExpiry,
} from "@galaxy-farm/infra-auth";
import { kioskDevices, type Database } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";

/**
 * Paired barn screens, in Postgres (spec §4.1, §4.4).
 *
 * `kioskDevices` never reaches a local store — it carries a token hash, and
 * §4.3 keeps credentials off devices the same way it keeps `users` off them.
 * So this is the same shape as `user-store.ts`: read the table directly on the
 * server, write through server actions, and the settings screen re-reads
 * afterwards.
 *
 * Nothing here ever hands back `tokenHash`. `pairingCode` is the one secret
 * this file *does* return — it is stored in the clear on the row already
 * (spec §4.4's own doc comment on the column), because it is single-use and
 * expires in `PAIRING_TTL_MINUTES`: there is nothing a leaked value would give
 * away that the clock has not already taken back.
 */

export interface KioskDevice {
  readonly id: Ulid;
  readonly propertyId: Ulid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly name: string;
  readonly pairingCode?: string | undefined;
  readonly pairingExpiresAt?: Date | undefined;
  readonly pairedAt?: Date | undefined;
  readonly lastSeenAt?: Date | undefined;
  readonly lockedToBoard?: string | undefined;
  readonly revokedAt?: Date | undefined;
  readonly deletedAt?: Date | undefined;
}

function deviceFromRow(row: typeof kioskDevices.$inferSelect): KioskDevice {
  return {
    id: row.id as Ulid,
    propertyId: row.propertyId as Ulid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    name: row.name,
    ...(row.pairingCode === null ? {} : { pairingCode: row.pairingCode }),
    ...(row.pairingExpiresAt === null ? {} : { pairingExpiresAt: row.pairingExpiresAt }),
    ...(row.pairedAt === null ? {} : { pairedAt: row.pairedAt }),
    ...(row.lastSeenAt === null ? {} : { lastSeenAt: row.lastSeenAt }),
    ...(row.lockedToBoard === null ? {} : { lockedToBoard: row.lockedToBoard }),
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt }),
    ...(row.deletedAt === null ? {} : { deletedAt: row.deletedAt }),
  };
}

export function isPaired(device: Pick<KioskDevice, "pairedAt">): boolean {
  return device.pairedAt !== undefined;
}

export function isRevoked(device: Pick<KioskDevice, "revokedAt">): boolean {
  return device.revokedAt !== undefined;
}

export function isDeleted(device: Pick<KioskDevice, "deletedAt">): boolean {
  return device.deletedAt !== undefined;
}

export async function listDevices(
  propertyId: Ulid,
  db: Database = database(),
): Promise<KioskDevice[]> {
  const rows = await db
    .select()
    .from(kioskDevices)
    .where(and(eq(kioskDevices.propertyId, propertyId), isNull(kioskDevices.deletedAt)))
    .orderBy(asc(kioskDevices.name));

  return rows.map(deviceFromRow);
}

/** Tombstoned screens, for the restore path (§4.5 clause 4). */
export async function listDeletedDevices(
  propertyId: Ulid,
  db: Database = database(),
): Promise<KioskDevice[]> {
  const rows = await db
    .select()
    .from(kioskDevices)
    .where(and(eq(kioskDevices.propertyId, propertyId), isNotNull(kioskDevices.deletedAt)))
    .orderBy(asc(kioskDevices.name));

  return rows.map(deviceFromRow);
}

export async function findDevice(
  id: Ulid,
  db: Database = database(),
): Promise<KioskDevice | undefined> {
  const [row] = await db.select().from(kioskDevices).where(eq(kioskDevices.id, id)).limit(1);
  return row === undefined ? undefined : deviceFromRow(row);
}

/**
 * A device is live if it is paired-or-pairing, not revoked, and not deleted.
 *
 * Asked on every pull and every kiosk write action (spec §4.4): a revoked
 * screen has to stop working within the sync interval, not merely fail to
 * sign in again the next time its JWT happens to expire.
 */
export async function isDeviceLive(
  id: Ulid,
  propertyId: Ulid,
  db: Database = database(),
): Promise<boolean> {
  const device = await findDevice(id, db);
  return (
    device !== undefined &&
    device.propertyId === propertyId &&
    !isRevoked(device) &&
    !isDeleted(device)
  );
}

/** A fresh, unpaired row with a code to hand over. */
export async function createDevice(
  input: { readonly propertyId: Ulid; readonly name: string },
  now: Date,
  db: Database = database(),
): Promise<KioskDevice> {
  const id = encodeUlid(now.getTime()) as Ulid;

  const [row] = await db
    .insert(kioskDevices)
    .values({
      id,
      propertyId: input.propertyId,
      createdAt: now,
      updatedAt: now,
      name: input.name.trim(),
      // Empty rather than a real hash: no token exists until the code is
      // redeemed, and an empty string can never match a SHA-256 digest.
      tokenHash: "",
      pairingCode: mintPairingCode(),
      pairingExpiresAt: pairingExpiry(now),
    })
    .returning();

  return deviceFromRow(row!);
}

/**
 * The barn screen's half of pairing (spec §4.4).
 *
 * Consumes the code — it is single-use whether it succeeds or is about to
 * expire a second from now — and mints the token the screen holds from then
 * on. Returns the token exactly once, like an invitation link: only its hash
 * is kept.
 */
export async function redeemPairing(
  code: string,
  now: Date,
  db: Database = database(),
): Promise<{ readonly device: KioskDevice; readonly token: string } | undefined> {
  const normalised = normalisePairingCode(code);
  if (normalised === "") return undefined;

  const [row] = await db
    .select()
    .from(kioskDevices)
    .where(
      and(
        eq(kioskDevices.pairingCode, normalised),
        isNull(kioskDevices.deletedAt),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .limit(1);

  if (row === undefined) return undefined;
  if (row.pairingExpiresAt === null || row.pairingExpiresAt <= now) return undefined;

  const minted = mintDeviceToken();

  const [updated] = await db
    .update(kioskDevices)
    .set({
      tokenHash: minted.tokenHash,
      pairingCode: null,
      pairingExpiresAt: null,
      pairedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(kioskDevices.id, row.id))
    .returning();

  return { device: deviceFromRow(updated!), token: minted.token };
}

/**
 * The barn screen's every-request half of being signed in.
 *
 * Looked up by the hash rather than compared against it — the token is 256
 * bits from the system CSPRNG, so the lookup itself is the check (see
 * `pairing.ts`). Touches `lastSeenAt` so Settings can show which screens are
 * actually reporting in.
 */
export async function authenticateDevice(
  token: string,
  now: Date,
  db: Database = database(),
): Promise<KioskDevice | undefined> {
  if (token === "") return undefined;
  const hash = hashDeviceToken(token);

  const [row] = await db
    .select()
    .from(kioskDevices)
    .where(
      and(
        eq(kioskDevices.tokenHash, hash),
        isNull(kioskDevices.deletedAt),
        isNull(kioskDevices.revokedAt),
      ),
    )
    .limit(1);

  if (row === undefined) return undefined;

  await db.update(kioskDevices).set({ lastSeenAt: now }).where(eq(kioskDevices.id, row.id));

  return deviceFromRow({ ...row, lastSeenAt: now });
}

export async function renameDevice(
  id: Ulid,
  name: string,
  now: Date,
  db: Database = database(),
): Promise<void> {
  await db
    .update(kioskDevices)
    .set({ name: name.trim(), updatedAt: now })
    .where(eq(kioskDevices.id, id));
}

/** Lock the screen to one board, or hand it back the picker with `null` (spec §4.4). */
export async function lockDeviceToBoard(
  id: Ulid,
  board: string | null,
  now: Date,
  db: Database = database(),
): Promise<void> {
  await db
    .update(kioskDevices)
    .set({ lockedToBoard: board, updatedAt: now })
    .where(eq(kioskDevices.id, id));
}

/**
 * Move the same device row onto a new physical screen.
 *
 * The old token stops working the moment this returns — there is a fresh
 * pairing code and no token at all until it is redeemed — which is what makes
 * this different from `revokeDevice`: the device's identity (its name, its
 * locked board) survives, only the screen behind it changes.
 */
export async function reissuePairing(
  id: Ulid,
  now: Date,
  db: Database = database(),
): Promise<KioskDevice | undefined> {
  const [row] = await db
    .update(kioskDevices)
    .set({
      tokenHash: "",
      pairingCode: mintPairingCode(),
      pairingExpiresAt: pairingExpiry(now),
      pairedAt: null,
      updatedAt: now,
    })
    .where(eq(kioskDevices.id, id))
    .returning();

  return row === undefined ? undefined : deviceFromRow(row);
}

/**
 * Revoke — spec §4.5's exception list names device pairing tokens explicitly:
 * "system-owned rows... revocable, not editable." The *token* is what that
 * exempts: there is no editing a credential, only ending it. The row carrying
 * it is an ordinary record, and it gets the ordinary surface — a name somebody
 * can correct, and the tombstone below.
 *
 * Revoking is not deleting, and the two answer different questions. Revoke
 * says *this screen has stopped*, and leaves the row in Settings, greyed out,
 * as the record that it existed and when it ended. Delete says *stop showing
 * me this row at all*.
 */
export async function revokeDevice(id: Ulid, now: Date, db: Database = database()): Promise<void> {
  await db
    .update(kioskDevices)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(kioskDevices.id, id));
}

/**
 * Delete — a tombstone, never a `DELETE` (§4.5 clause 4).
 *
 * It stops the screen as surely as revoking does, and by the same mechanism:
 * `authenticateDevice`, `redeemPairing` and `isDeviceLive` all pass over a
 * tombstoned row, so a deleted screen loses its session and its pull within
 * one sync interval whether it was revoked first or not.
 *
 * `revokedAt` is deliberately left alone. Clause 4 exists so the answer to
 * "what if I confirm by mistake" is always "restore it", and that answer is
 * only worth anything if restoring gives back what was there — a screen that
 * was working goes on working, without somebody walking a fresh code out to
 * the barn. Revoking as a side effect of deleting would take that back and
 * charge a misclick the price of a trip to the barn.
 *
 * A live pairing code is left alone for the same reason, and unlike
 * `tombstoneUser`'s invitation it costs nothing to leave: `redeemPairing`
 * refuses a tombstoned row outright, so the code is unusable while the screen
 * is deleted and usable again the moment it is not — which is what somebody
 * standing in the barn with a code and a fifteen-minute clock needs a restore
 * to mean.
 */
export async function tombstoneDevice(
  id: Ulid,
  by: Ulid,
  now: Date,
  reason?: string,
  db: Database = database(),
): Promise<void> {
  await db
    .update(kioskDevices)
    .set({ deletedAt: now, deletedBy: by, deletedReason: reason ?? null, updatedAt: now })
    .where(eq(kioskDevices.id, id));
}

/**
 * Bring a tombstoned screen back (§4.5 clause 4).
 *
 * Its token survived the tombstone, so a screen that was paired and working
 * when it was deleted is paired and working again — it fails a pull or two in
 * between and retries, which is the same thing losing signal looks like. A
 * pairing code that had not run out yet is live again too.
 */
export async function restoreDevice(id: Ulid, now: Date, db: Database = database()): Promise<void> {
  await db
    .update(kioskDevices)
    .set({ deletedAt: null, deletedBy: null, deletedReason: null, updatedAt: now })
    .where(eq(kioskDevices.id, id));
}
