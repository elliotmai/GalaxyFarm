import type { Ulid } from "../types/ids.js";
import type { CrudError } from "../crud/contracts.js";
import type { Result } from "../types/result.js";

/**
 * Roles and capabilities (spec §4.3).
 *
 * §4.3 is explicit that permission checks live in the application layer — use
 * cases declare the capability they need — and **not** in UI conditionals. A
 * hidden button is not a permission check: the route is still there, the API
 * is still there, and the only thing standing between a housesitter and the
 * cull list is that nobody told them the URL.
 *
 * So capabilities are a domain concept, defined here with the entities, and
 * the answer to "may this actor do this" is a pure function of the actor and
 * the capability. Infrastructure supplies the actor; it does not decide.
 */

export const ROLES = ["owner", "member", "customer", "housesitter", "kiosk"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What a capability names is an *action*, not a screen.
 *
 * Screens move and get renamed; "may they end an animal's life in the records"
 * does not. The list is closed so a typo is a compile error rather than a
 * silently-granted permission.
 */
export const CAPABILITIES = [
  // Reading
  "records.read",
  "records.read.own", // a customer's own animals only
  "care.read", // the housesitter guide, today's chores
  // Writing
  "records.write",
  "records.delete",
  "records.purge", // owner-only, past the retention window (§4.5 clause 4)
  // The whitelisted kiosk actions (§4.4)
  "chores.complete",
  "eggs.log",
  "animals.move",
  // Administration
  "users.manage",
  "settings.manage",
  /**
   * What the farm is called (§5.1).
   *
   * Separate from `settings.manage` because it is not the same decision.
   * Settings holds thresholds and preferences — things a member tunes while
   * doing the job. The farm and business names are injected into every page
   * title, email, PDF, kiosk board and the customer portal, so renaming the
   * farm renames it to everybody the farm deals with. That is an owner's call.
   */
  "branding.manage",
  "devices.manage",
  "billing.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * The grant table.
 *
 * Written out per role rather than layered by inheritance. Inheritance reads
 * well until the day a role needs everything above it *except* one thing, and
 * then the exception is invisible at the place where the role is defined. This
 * is longer and says exactly what each role may do.
 */
const GRANTS: Readonly<Record<Role, readonly Capability[]>> = {
  owner: [...CAPABILITIES],

  member: [
    "records.read",
    "care.read",
    "records.write",
    "records.delete",
    "chores.complete",
    "eggs.log",
    "animals.move",
    "settings.manage",
    // Deliberately not `records.purge`, `users.manage`, `devices.manage`,
    // `billing.manage` or `branding.manage`. Purge is the one action §4.5
    // makes unrecoverable, two of the others decide who else gets in, and
    // branding renames the farm to everyone it deals with.
  ],

  customer: ["records.read.own"],

  // Time-boxed; see `isWithinAccessWindow`. Read-only except for ticking off
  // the chores they were asked to do.
  housesitter: ["care.read", "chores.complete"],

  // §4.4: read plus a whitelist. A barn screen is unattended and unlocked, so
  // it can log what it is for and nothing else. Anything further wants a PIN,
  // which elevates the actor rather than widening the device.
  kiosk: ["records.read", "care.read", "chores.complete", "eggs.log", "animals.move"],
};

export interface Actor {
  readonly id: Ulid;
  readonly role: Role;
  readonly propertyId: Ulid;
  /** Set for `customer`: the animals they may see. */
  readonly ownedAnimalIds?: readonly Ulid[];
  /** Set for `housesitter`: outside this window they have no access at all. */
  readonly accessWindow?: { readonly from: Date; readonly to: Date };
  /** Set for `kiosk`: which device, so a lost screen can be revoked by id. */
  readonly deviceId?: string;
}

export function capabilitiesOf(role: Role): readonly Capability[] {
  return GRANTS[role];
}

/**
 * Synced entities a general `records.write` does not cover.
 *
 * The push channel takes a patch for any entity a device holds, so hiding a
 * screen hides nothing — §4.3's "a hidden button is not a permission check",
 * stated as data. Anything named here is checked against its own capability
 * before the patch is applied; everything else needs `records.write`.
 *
 * Keyed by the entity name a `Patch` carries, which is the local store's name
 * for it. A typo is a silently *widened* permission rather than a compile
 * error — the lookup would simply miss — so `capabilities.test.ts` asserts
 * every key here is a real synced entity.
 */
export const ENTITY_WRITE_CAPABILITY: Readonly<Record<string, Capability>> = {
  brandingConfigs: "branding.manage",
};

/** What it takes to write this entity. */
export function capabilityToWrite(entity: string): Capability {
  return ENTITY_WRITE_CAPABILITY[entity] ?? "records.write";
}

/**
 * May this actor write this entity at all?
 *
 * Asked per patch by the push handler, before anything is merged. A device
 * whose user lost a capability between queueing and syncing is the ordinary
 * case here, not an attack: the patch is refused, the outbox sets it aside,
 * and the sync panel reports it rather than the write vanishing quietly.
 */
export function canWriteEntity(actor: Actor, entity: string, now: Date): boolean {
  return can(actor, capabilityToWrite(entity), now);
}

/**
 * May this actor do this, right now?
 *
 * `now` is a parameter because the housesitter window is a real expiry, and a
 * permission function that reads the wall clock cannot be tested against the
 * moment it lapses.
 */
export function can(actor: Actor, capability: Capability, now: Date): boolean {
  if (!isWithinAccessWindow(actor, now)) return false;
  return GRANTS[actor.role].includes(capability);
}

/**
 * A housesitter's access ends when the window does.
 *
 * The window is the whole point of the role — someone is watching the place
 * for a week, not forever, and access that quietly outlives the arrangement is
 * the kind of thing nobody notices until it matters. Roles without a window
 * are unaffected.
 */
export function isWithinAccessWindow(actor: Actor, now: Date): boolean {
  if (actor.accessWindow === undefined) return true;
  return now >= actor.accessWindow.from && now <= actor.accessWindow.to;
}

/**
 * The application-layer guard. Use cases call this; screens do not.
 *
 * Returns a `Result` rather than throwing so the caller handles refusal the
 * same way it handles a validation failure — §4.5 already has `forbidden` in
 * its error union for exactly this.
 */
export function requireCapability<T>(
  actor: Actor,
  capability: Capability,
  now: Date,
  proceed: () => T,
): Result<T, CrudError> {
  if (!can(actor, capability, now)) {
    return { ok: false, error: { kind: "forbidden", capability } };
  }
  return { ok: true, value: proceed() };
}

/**
 * Can this actor see this specific record?
 *
 * Capability alone is not enough for a customer: `records.read.own` is a
 * permission over *their* animals, and the difference between that and
 * `records.read` is the entire boarding business's privacy.
 */
export function canSeeRecord(
  actor: Actor,
  record: { readonly id: Ulid; readonly propertyId: Ulid },
  now: Date,
): boolean {
  // Property scoping comes first and applies to everyone. §5 puts propertyId
  // on every record so a second location is a filter; this is that filter.
  if (record.propertyId !== actor.propertyId) return false;
  if (!isWithinAccessWindow(actor, now)) return false;

  if (GRANTS[actor.role].includes("records.read")) return true;
  if (GRANTS[actor.role].includes("records.read.own")) {
    return (actor.ownedAnimalIds ?? []).includes(record.id);
  }
  return false;
}
