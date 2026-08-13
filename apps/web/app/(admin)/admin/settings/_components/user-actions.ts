"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { ROLES, can, refuseUserChange, type Role, type Ulid } from "@galaxy-farm/core";
import { invitationUrl } from "@galaxy-farm/infra-auth";

import { currentActor } from "@/lib/auth";
import {
  findUser,
  findUserByEmail,
  inviteUser,
  liveOwnerIds,
  reinviteUser,
  restoreUser,
  tombstoneUser,
  updateUser,
} from "@/lib/user-store";

/**
 * Managing people (spec §4.3, §7 `/admin/settings`).
 *
 * Server actions rather than a REST route, for one reason worth stating: the
 * `users` table is the one thing that never reaches a device, so there is no
 * local store to write through and no outbox to drain. Everything here runs on
 * the server, against Postgres, and the screen re-reads afterwards.
 *
 * **Every action re-checks the capability.** Not because the screen is
 * unreachable without it — §4.3 is explicit that a hidden button is not a
 * permission check — but because a server action is a POST endpoint with a
 * generated name, and anything that can be posted to has to answer for itself.
 * `users.manage` belongs to `owner` alone.
 */

export type ActionResult =
  | { readonly ok: true; readonly message: string; readonly link?: string }
  | { readonly ok: false; readonly error: string; readonly field?: string };

const REFUSED: ActionResult = {
  ok: false,
  error: "You do not have permission to manage people.",
};

/**
 * Who is asking, and may they.
 *
 * Returns the actor or nothing; every caller turns nothing into the same
 * refusal, so a signed-out caller and a member cannot tell each other apart.
 */
async function managingActor() {
  const actor = await currentActor();
  if (actor === undefined) return undefined;
  return can(actor, "users.manage", new Date()) ? actor : undefined;
}

/**
 * Where this app is being served from, for the link in the invitation.
 *
 * Read from the request rather than configured, so it is right on the
 * Netlify URL, on a laptop at `localhost:3000`, and on a box in the barn —
 * three places this will genuinely be used from before there is a domain.
 */
async function origin(): Promise<string> {
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Both screens that read the people list.
 *
 * `/admin/housesitter` shows the sitter accounts and their access windows
 * (§7), and it reads the same server-rendered list this file writes to.
 * Revalidating only settings left it showing yesterday's window until
 * somebody happened to hard-refresh — the sort of staleness nobody notices
 * until the person at the gate cannot sign in.
 */
function revalidated(): void {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/housesitter");
}

/** `""` from an empty date input is "not set", not "the epoch". */
function dateOrUndefined(value: string | undefined): Date | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export interface InviteInput {
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly accessFrom?: string | undefined;
  readonly accessTo?: string | undefined;
}

/**
 * Add somebody by email, with a role, and hand back the link they use to set
 * a password.
 *
 * The link is returned once and never stored — only its hash is — so the only
 * way to see it again is to issue a new one, which is exactly the property
 * that makes it safe to leave lying in a database.
 */
export async function invitePerson(input: InviteInput): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (name === "") return { ok: false, error: "A name is needed.", field: "name" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That does not look like an email address.", field: "email" };
  }
  if (!isRole(input.role)) return { ok: false, error: "Pick a role.", field: "role" };

  const existing = await findUserByEmail(email);
  if (existing !== undefined) {
    // Named rather than silently ignored: this is an owner looking at their
    // own farm's list, so there is nothing to leak, and "already there" is the
    // only answer that says what to do next.
    return {
      ok: false,
      error:
        existing.deletedAt === undefined
          ? "Somebody already has that address. Send them a new invitation instead."
          : "A deleted account has that address. Restore it from the list below.",
      field: "email",
    };
  }

  const now = new Date();
  const accessFrom = dateOrUndefined(input.accessFrom);
  const accessTo = dateOrUndefined(input.accessTo);

  // §4.5 clause 2: what Zod cannot express is enforced here, not in the form.
  // A housesitter with no window is the one this catches — access that never
  // lapses is the single thing the role exists to prevent.
  const refusal = refuseUserChange(
    {
      actorId: actor.id,
      target: { id: "" as Ulid, role: input.role },
      role: input.role,
      accessFrom,
      accessTo,
    },
    { liveOwnerIds: await liveOwnerIds(actor.propertyId, now) },
    now,
  );
  if (refusal !== undefined) {
    return { ok: false, error: refusal.message, field: "accessFrom" };
  }

  const { user, token } = await inviteUser(
    {
      propertyId: actor.propertyId,
      email,
      name,
      role: input.role,
      accessFrom,
      accessTo,
    },
    now,
  );

  revalidated();
  return {
    ok: true,
    message: `${user.name} added. Send them this link — it is the only time it is shown.`,
    link: invitationUrl(await origin(), token),
  };
}

/**
 * Issue a fresh invitation.
 *
 * Both the "they never accepted" path and the password-reset path, because
 * they are the same thing: the account goes back to having no password and one
 * live link. Any earlier link stops working immediately.
 */
export async function resendInvitation(id: Ulid): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const now = new Date();
  const found = await findUser(id, now);
  if (found === undefined || found.user.propertyId !== actor.propertyId) {
    return { ok: false, error: "That account is not on this property." };
  }

  const token = await reinviteUser(id, now);

  revalidated();
  return {
    ok: true,
    message: `New link for ${found.user.name}. Any earlier one has stopped working.`,
    link: invitationUrl(await origin(), token),
  };
}

export interface EditInput {
  readonly name?: string | undefined;
  readonly role?: string | undefined;
  readonly accessFrom?: string | undefined;
  readonly accessTo?: string | undefined;
}

export async function editPerson(id: Ulid, input: EditInput): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const now = new Date();
  const found = await findUser(id, now);
  if (found === undefined || found.user.propertyId !== actor.propertyId) {
    return { ok: false, error: "That account is not on this property." };
  }

  if (input.role !== undefined && !isRole(input.role)) {
    return { ok: false, error: "Pick a role.", field: "role" };
  }

  const role = input.role as Role | undefined;
  const accessFrom = dateOrUndefined(input.accessFrom);
  const accessTo = dateOrUndefined(input.accessTo);

  const refusal = refuseUserChange(
    {
      actorId: actor.id,
      target: { id: found.user.id, role: found.user.role },
      ...(role === undefined ? {} : { role }),
      accessFrom,
      accessTo,
    },
    { liveOwnerIds: await liveOwnerIds(actor.propertyId, now) },
    now,
  );
  if (refusal !== undefined) {
    return {
      ok: false,
      error: refusal.message,
      field: refusal.kind === "missing-access-window" ? "accessFrom" : "role",
    };
  }

  await updateUser(
    id,
    {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(role === undefined ? {} : { role }),
      // Null rather than undefined: leaving the boxes empty on somebody who is
      // no longer a housesitter has to actually clear the window, and
      // `undefined` in this store means "leave it alone".
      accessFrom: accessFrom ?? null,
      accessTo: accessTo ?? null,
    },
    now,
  );

  revalidated();
  return { ok: true, message: `${found.user.name} saved.` };
}

/** Switch an account off, or back on. Reversible, so no confirmation tier. */
export async function setPersonActive(id: Ulid, active: boolean): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const now = new Date();
  const found = await findUser(id, now);
  if (found === undefined || found.user.propertyId !== actor.propertyId) {
    return { ok: false, error: "That account is not on this property." };
  }

  const refusal = refuseUserChange(
    {
      actorId: actor.id,
      target: { id: found.user.id, role: found.user.role },
      active,
      // Carried through so switching a housesitter back on does not trip the
      // window rule on a window they already have.
      accessFrom: found.user.accessFrom,
      accessTo: found.user.accessTo,
    },
    { liveOwnerIds: await liveOwnerIds(actor.propertyId, now) },
    now,
  );
  if (refusal !== undefined) return { ok: false, error: refusal.message };

  await updateUser(id, { active }, now);

  revalidated();
  return {
    ok: true,
    message: `${found.user.name} ${active ? "switched back on" : "switched off"}.`,
  };
}

/**
 * Soft delete. The row survives as a tombstone and the account can be brought
 * back from the list (§4.5 clause 4).
 */
export async function deletePerson(id: Ulid, reason?: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const now = new Date();
  const found = await findUser(id, now);
  if (found === undefined || found.user.propertyId !== actor.propertyId) {
    return { ok: false, error: "That account is not on this property." };
  }

  if (found.user.id === actor.id) {
    return { ok: false, error: "You cannot delete your own account." };
  }

  const refusal = refuseUserChange(
    {
      actorId: actor.id,
      target: { id: found.user.id, role: found.user.role },
      deleting: true,
    },
    { liveOwnerIds: await liveOwnerIds(actor.propertyId, now) },
    now,
  );
  if (refusal !== undefined) return { ok: false, error: refusal.message };

  await tombstoneUser(id, actor.id, now, reason);

  revalidated();
  return { ok: true, message: `${found.user.name} deleted.` };
}

export async function restorePerson(id: Ulid): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const now = new Date();
  const found = await findUser(id, now);
  if (found === undefined || found.user.propertyId !== actor.propertyId) {
    return { ok: false, error: "That account is not on this property." };
  }

  await restoreUser(id, now);

  revalidated();
  return {
    ok: true,
    // Said out loud because the invitation went with the tombstone: a restored
    // account that had never accepted has no way in until somebody issues one.
    message: `${found.user.name} restored. If they had not signed in yet, send a new invitation.`,
  };
}
