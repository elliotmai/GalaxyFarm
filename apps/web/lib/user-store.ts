import { and, asc, eq, gt, isNull } from "drizzle-orm";

import {
  accountState,
  encodeUlid,
  invitationExpiry,
  type AccountState,
  type Role,
  type Ulid,
  type User,
} from "@galaxy-farm/core";
import { hashInvitationToken, mintInvitation } from "@galaxy-farm/infra-auth";
import { users, type Database } from "@galaxy-farm/infra-db";

import { database, userFromRow } from "@/lib/credential-store";

/**
 * The people on the farm, in Postgres (spec §4.1, §4.3).
 *
 * The one entity that does **not** go through the local store. Every other
 * screen in this app reads from the device and syncs in the background, which
 * is what makes the barn usable at zero bars — but `users` carries password
 * hashes and invitation tokens, and §4.3 keeps those off devices entirely.
 * The server refuses to sync the table by name, so a device could not hold it
 * even if a screen asked.
 *
 * That means this screen is the exception: it reads the database directly on
 * the server and writes through server actions. Worth stating plainly, because
 * "why doesn't this one use `useRecords`" is otherwise a reasonable question
 * with an invisible answer.
 *
 * Nothing here returns a hash. `userFromRow` drops both, and the two functions
 * that need one take it as an argument rather than handing it back.
 */

/** A user as the People screen sees them: the record, plus where it stands. */
export interface ManagedUser {
  readonly user: User;
  readonly state: AccountState;
}

function standing(row: typeof users.$inferSelect) {
  return {
    active: row.active,
    hasPassword: row.passwordHash !== null && row.passwordHash !== "",
    ...(row.inviteExpiresAt === null ? {} : { inviteExpiresAt: row.inviteExpiresAt }),
  };
}

export async function listUsers(
  propertyId: Ulid,
  now: Date,
  db: Database = database(),
): Promise<ManagedUser[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.propertyId, propertyId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  return rows.map((row) => ({ user: userFromRow(row), state: accountState(standing(row), now) }));
}

/** Tombstoned accounts, for the restore path (§4.5 clause 4). */
export async function listDeletedUsers(
  propertyId: Ulid,
  now: Date,
  db: Database = database(),
): Promise<ManagedUser[]> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.propertyId, propertyId))
    .orderBy(asc(users.name));

  return rows
    .filter((row) => row.deletedAt !== null)
    .map((row) => ({ user: userFromRow(row), state: accountState(standing(row), now) }));
}

export async function findUser(
  id: Ulid,
  now: Date,
  db: Database = database(),
): Promise<ManagedUser | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row === undefined
    ? undefined
    : { user: userFromRow(row), state: accountState(standing(row), now) };
}

export async function findUserByEmail(
  email: string,
  db: Database = database(),
): Promise<User | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row === undefined ? undefined : userFromRow(row);
}

/**
 * Who could still manage people if this change went through.
 *
 * Live owners only: tombstoned, switched off, and never-accepted all fail to
 * qualify, because none of them can sign in and do it. `refuseUserChange`
 * turns this into the refusal.
 */
export async function liveOwnerIds(
  propertyId: Ulid,
  now: Date,
  db: Database = database(),
): Promise<Ulid[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.propertyId, propertyId), eq(users.role, "owner"), isNull(users.deletedAt)));

  return rows
    .filter((row) => accountState(standing(row), now) === "active")
    .map((row) => row.id as Ulid);
}

export interface NewUser {
  readonly propertyId: Ulid;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly accessFrom?: Date | undefined;
  readonly accessTo?: Date | undefined;
  readonly contactId?: Ulid | undefined;
}

/**
 * Create an account with no password and an invitation attached.
 *
 * Returns the token exactly once — it is not stored and cannot be read back,
 * so the caller either shows it now or mints a fresh one later.
 */
export async function inviteUser(
  input: NewUser,
  now: Date,
  db: Database = database(),
): Promise<{ readonly user: User; readonly token: string }> {
  const invitation = mintInvitation();
  const id = encodeUlid(now.getTime()) as Ulid;
  const expiresAt = invitationExpiry(now);

  const [row] = await db
    .insert(users)
    .values({
      id,
      propertyId: input.propertyId,
      createdAt: now,
      updatedAt: now,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      role: input.role,
      passwordHash: null,
      inviteTokenHash: invitation.tokenHash,
      inviteExpiresAt: expiresAt,
      accessFrom: input.accessFrom ?? null,
      accessTo: input.accessTo ?? null,
      contactId: input.contactId ?? null,
      active: true,
    })
    .returning();

  return { user: userFromRow(row!), token: invitation.token };
}

/**
 * Replace the outstanding invitation with a fresh one.
 *
 * Also the way back for somebody who has forgotten their password: the old
 * token stops working the moment this returns, and the account goes back to
 * having none rather than keeping one nobody knows.
 */
export async function reinviteUser(
  id: Ulid,
  now: Date,
  db: Database = database(),
): Promise<string> {
  const invitation = mintInvitation();

  await db
    .update(users)
    .set({
      passwordHash: null,
      inviteTokenHash: invitation.tokenHash,
      inviteExpiresAt: invitationExpiry(now),
      updatedAt: now,
    })
    .where(eq(users.id, id));

  return invitation.token;
}

export interface UserEdits {
  readonly name?: string | undefined;
  readonly role?: Role | undefined;
  readonly active?: boolean | undefined;
  readonly accessFrom?: Date | null | undefined;
  readonly accessTo?: Date | null | undefined;
}

export async function updateUser(
  id: Ulid,
  edits: UserEdits,
  now: Date,
  db: Database = database(),
): Promise<void> {
  await db
    .update(users)
    .set({
      ...(edits.name === undefined ? {} : { name: edits.name.trim() }),
      ...(edits.role === undefined ? {} : { role: edits.role }),
      ...(edits.active === undefined ? {} : { active: edits.active }),
      ...(edits.accessFrom === undefined ? {} : { accessFrom: edits.accessFrom }),
      ...(edits.accessTo === undefined ? {} : { accessTo: edits.accessTo }),
      updatedAt: now,
    })
    .where(eq(users.id, id));
}

/** A tombstone, never a DELETE (§4.5 clause 4). */
export async function tombstoneUser(
  id: Ulid,
  by: Ulid,
  now: Date,
  reason?: string,
  db: Database = database(),
): Promise<void> {
  await db
    .update(users)
    .set({
      deletedAt: now,
      deletedBy: by,
      deletedReason: reason ?? null,
      // The invitation goes with them. A link that still worked would let a
      // deleted account be claimed and revived from outside.
      inviteTokenHash: null,
      inviteExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(users.id, id));
}

export async function restoreUser(id: Ulid, now: Date, db: Database = database()): Promise<void> {
  await db
    .update(users)
    .set({ deletedAt: null, deletedBy: null, deletedReason: null, updatedAt: now })
    .where(eq(users.id, id));
}

export interface PendingInvitation {
  readonly id: Ulid;
  readonly name: string;
  readonly email: string;
}

/**
 * Find the account a link belongs to, if the link is still worth anything.
 *
 * By hash, so the token is never compared against in the database and never
 * appears in a query log. Tombstoned and switched-off accounts are excluded
 * here rather than after: a deleted account must not be claimable.
 */
export async function findPendingInvitation(
  token: string,
  now: Date,
  db: Database = database(),
): Promise<PendingInvitation | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.inviteTokenHash, hashInvitationToken(token)), isNull(users.deletedAt)))
    .limit(1);

  if (row === undefined || !row.active) return undefined;
  if (row.inviteExpiresAt === null || row.inviteExpiresAt <= now) return undefined;

  return { id: row.id as Ulid, name: row.name, email: row.email };
}

/**
 * Accept: set the password and spend the invitation.
 *
 * One statement, and the whole condition lives in the WHERE clause rather than
 * in a check before it. That is what makes it single-use: two tabs racing the
 * same link produce one update and one no-op, without a transaction or a lock.
 * Every reason to refuse — spent, expired, deleted, switched off — is in there
 * too, so the check the page did on the way in cannot go stale between the
 * page rendering and the form being submitted.
 */
export async function acceptInvitation(
  token: string,
  passwordHash: string,
  now: Date,
  db: Database = database(),
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({
      passwordHash,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(users.inviteTokenHash, hashInvitationToken(token)),
        gt(users.inviteExpiresAt, now),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    )
    .returning({ id: users.id });

  return updated.length > 0;
}
