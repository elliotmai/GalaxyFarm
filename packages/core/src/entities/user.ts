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
