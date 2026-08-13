import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "./record.js";
import { ROLES, type Actor, type Role } from "../auth/capabilities.js";
import { ulidSchema, type Ulid } from "../types/ids.js";

/**
 * A person who can sign in (spec §4.3).
 *
 * In our own database rather than a provider's — §10's move home is a
 * `pg_dump | pg_restore`, and an identity provider holding the accounts would
 * make it a re-registration of every one of them instead.
 *
 * The entity carries no password. `passwordHash` lives on the row and never
 * leaves the auth adapter, because a `User` reaches screens, sync payloads,
 * and API responses, and a hash that travels with it will eventually be
 * logged.
 */

export interface User extends BaseRecord {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  /** `housesitter` only: outside this window they have no access at all. */
  readonly accessFrom?: Date | undefined;
  readonly accessTo?: Date | undefined;
  /** `customer` only: their record in the CRM. */
  readonly contactId?: Ulid | undefined;
  readonly lastSignedInAt?: Date | undefined;
  /** Cleared rather than deleted when someone leaves — history survives. */
  readonly active: boolean;
  /**
   * When the outstanding invitation stops working.
   *
   * The *token* is not here, and must never be: this field is the half a
   * screen legitimately needs — whether an invitation is still live and when
   * it lapses — and the half that could be used to sign in as somebody else
   * stays on the row beside the password hash.
   */
  readonly inviteExpiresAt?: Date | undefined;
}

export const userSchema = baseRecordSchema.extend({
  // Lowercased on the way in: "Eli@" and "eli@" are one account, and a second
  // row for the same person is a support call nobody enjoys.
  email: z.string().email().max(320).toLowerCase(),
  name: z.string().min(1).max(200),
  role: z.enum(ROLES),
  accessFrom: z.coerce.date().optional(),
  accessTo: z.coerce.date().optional(),
  contactId: ulidSchema.optional(),
  lastSignedInAt: z.coerce.date().optional(),
  active: z.boolean(),
  inviteExpiresAt: z.coerce.date().optional(),
});

/**
 * The window, only when both ends are set.
 *
 * A half-specified window is worse than none: "from the 10th, forever" reads
 * as time-boxed and is not.
 */
export function accessWindowOf(user: User): { from: Date; to: Date } | undefined {
  if (user.accessFrom === undefined || user.accessTo === undefined) return undefined;
  return { from: user.accessFrom, to: user.accessTo };
}

/**
 * The actor a use case checks capabilities against.
 *
 * `ownedAnimalIds` is passed in rather than read from the user, because it is
 * a query against the herd — an animal's owner can change without the customer
 * record changing at all, and a stale copy on the session would keep showing
 * someone an animal they sold.
 */
export function actorFromUser(user: User, ownedAnimalIds: readonly Ulid[] = []): Actor {
  const window = accessWindowOf(user);
  return {
    id: user.id,
    role: user.role,
    propertyId: user.propertyId,
    ...(window === undefined ? {} : { accessWindow: window }),
    ...(user.role === "customer" ? { ownedAnimalIds } : {}),
  };
}

/**
 * Adding somebody (spec §4.3, §7 `/admin/settings`).
 *
 * An account is created by name, email, and role — never with a password
 * chosen for them. Somebody else's password is a password two people know,
 * it arrives over whatever channel was to hand, and it is almost never
 * changed afterwards. So the account is created *without* one and carries an
 * invitation instead: a single-use link the person follows to set their own.
 *
 * Until they do, the account exists, appears in the list, holds its role, and
 * cannot sign in. That is a state worth being able to see — "invited three
 * days ago and never accepted" and "deactivated" are different problems with
 * different answers, and a single `active` flag would say the same thing
 * about both.
 */

/** A week. Long enough for somebody on a farm, short enough to matter. */
export const INVITATION_DAYS = 7;

/**
 * The shortest password the farm accepts.
 *
 * Length rather than a character-class rule: "at least twelve" produces
 * passphrases, and "one capital, one digit, one symbol" produces `Passw0rd!`.
 * Here rather than beside the hashing, because the form that enforces it runs
 * in a browser and cannot import anything that reaches for `node:crypto`.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;

export const ACCOUNT_STATES = ["invited", "invitation-expired", "active", "deactivated"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/**
 * Everything needed to say where an account stands, and nothing more.
 *
 * `hasPassword` rather than the hash: whether one has been set is what decides
 * this, the hash itself decides nothing here, and a function that took it
 * would be a function somebody could log.
 */
export interface AccountStanding {
  readonly active: boolean;
  readonly hasPassword: boolean;
  readonly inviteExpiresAt?: Date | undefined;
}

export function accountState(standing: AccountStanding, now: Date): AccountState {
  // Deactivation wins. Someone switched off mid-invitation should not read as
  // "waiting on them" — it is waiting on us.
  if (!standing.active) return "deactivated";
  if (standing.hasPassword) return "active";
  return standing.inviteExpiresAt !== undefined && standing.inviteExpiresAt > now
    ? "invited"
    : "invitation-expired";
}

/** Can this account be signed in to at all? */
export function canSignIn(standing: AccountStanding, now: Date): boolean {
  return accountState(standing, now) === "active";
}

/** When an invitation minted now runs out. */
export function invitationExpiry(now: Date, days: number = INVITATION_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/**
 * Why a change to a user is refused (spec §4.3).
 *
 * These are invariants rather than validation, so they live here and are
 * enforced in the use case — §4.5 clause 2 is explicit that what Zod cannot
 * express does not belong in the form. A screen that merely hid the button
 * would leave the action reachable and the rule unwritten.
 */
export type UserChangeRefusal =
  | { readonly kind: "last-owner"; readonly message: string }
  | { readonly kind: "self-change"; readonly message: string }
  | { readonly kind: "missing-access-window"; readonly message: string };

/** What the farm currently has, for the last-owner check. */
export interface OwnerCensus {
  /** Every user who is an owner, can still sign in, and is not tombstoned. */
  readonly liveOwnerIds: readonly Ulid[];
}

export interface ProposedUserChange {
  readonly actorId: Ulid;
  readonly target: Pick<User, "id" | "role">;
  /** Absent when the role is not changing. */
  readonly role?: Role | undefined;
  readonly active?: boolean | undefined;
  readonly accessFrom?: Date | undefined;
  readonly accessTo?: Date | undefined;
  /** A soft delete is the strongest form of "this person is going away". */
  readonly deleting?: boolean | undefined;
}

/**
 * The one rule that cannot be recovered from in the app.
 *
 * `users.manage` is granted to `owner` alone (§4.3), so an owner who removes,
 * deactivates, or demotes the last one locks the farm out of its own account
 * management — and the only way back is a shell and `pnpm db:user`. Cheap to
 * check, and the check is the difference between a mistake and an outage.
 */
export function refuseUserChange(
  change: ProposedUserChange,
  census: OwnerCensus,
  now: Date,
): UserChangeRefusal | undefined {
  const nextRole = change.role ?? change.target.role;
  const leaving =
    change.deleting === true || change.active === false || change.target.role !== nextRole;

  if (change.target.role === "owner" && leaving) {
    const remaining = census.liveOwnerIds.filter((id) => id !== change.target.id);
    if (remaining.length === 0) {
      return {
        kind: "last-owner",
        message:
          "This is the last owner. Someone has to be able to manage people — make another owner first.",
      };
    }
  }

  // Changing your own role or switching yourself off is the other way to end
  // up locked out, and it is always a mistake rather than an intent.
  if (
    change.actorId === change.target.id &&
    (change.active === false || change.role !== undefined)
  ) {
    if (change.role !== undefined && change.role !== change.target.role) {
      return {
        kind: "self-change",
        message: "You cannot change your own role. Ask another owner to do it.",
      };
    }
    if (change.active === false) {
      return {
        kind: "self-change",
        message: "You cannot switch off your own account.",
      };
    }
  }

  // The gap that made the role dishonest: a housesitter with no window has
  // access that never ends, which is the one thing the role exists to prevent.
  if (nextRole === "housesitter" && change.deleting !== true) {
    if (change.accessFrom === undefined || change.accessTo === undefined) {
      return {
        kind: "missing-access-window",
        message: "A housesitter needs a start and an end. Access that never lapses is not a visit.",
      };
    }
    if (change.accessTo < change.accessFrom) {
      return {
        kind: "missing-access-window",
        message: "The end of the visit cannot come before the start.",
      };
    }
    if (change.accessTo < now) {
      return {
        kind: "missing-access-window",
        message: "That window has already closed, so the account would be locked out on arrival.",
      };
    }
  }

  return undefined;
}
