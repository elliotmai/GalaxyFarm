"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  INVITATION_DAYS,
  ROLES,
  can,
  refuseUserChange,
  type Role,
  type Ulid,
} from "@galaxy-farm/core";
import { invitationUrl } from "@galaxy-farm/infra-auth";
import { invitationEmail, testEmailMessage } from "@galaxy-farm/infra-email";

import { currentActor } from "@/lib/auth";
import { farmName } from "@/lib/farm-name";
import { emailConfig, notifier } from "@/lib/notifier";
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
  | {
      readonly ok: true;
      readonly message: string;
      readonly link?: string;
      /**
       * What happened to the email, when one was part of the action.
       *
       * Carried separately from `message` because it is a *second* outcome
       * with its own success: an invitation whose email bounced still created
       * the account and still produced a working link, so "added" and "not
       * emailed" are both true and the screen has to say both. `ok` is data
       * rather than a colour — the screen decides how alarmed to look.
       */
      readonly email?: { readonly ok: boolean; readonly detail: string };
    }
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

/** For the access window in a housesitter's invitation. */
function emailDate(value: Date): string {
  return value.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Email somebody their invitation link, and report what happened to it.
 *
 * **Never throws, and never fails the invitation.** The account is already
 * created and the link already works by the time this runs, so an unreachable
 * Resend has to degrade to a sentence on the screen — rolling the invitation
 * back would destroy a good account because a third party was down, and
 * leaving the caller to catch would mean the link never got shown.
 *
 * Which is also why the screen still shows the link. Sending it is a
 * convenience laid on top; handing it over is the path that always works, and
 * it stays the one the screen is built around (§4.3).
 */
async function emailInvitation(input: {
  readonly to: string;
  readonly name: string;
  readonly url: string;
  readonly invitedBy: string;
  readonly propertyId: Ulid;
  readonly accessFrom?: Date | undefined;
  readonly accessTo?: Date | undefined;
  readonly reissued: boolean;
}): Promise<{ readonly ok: boolean; readonly detail: string }> {
  const config = emailConfig();
  const send = notifier();
  if (!config.ok || send === undefined) {
    return {
      ok: false,
      detail: `${config.ok ? "Email is not configured." : config.reason} Hand them the link below instead.`,
    };
  }

  const message = invitationEmail({
    farmName: await farmName(input.propertyId),
    name: input.name,
    invitedBy: input.invitedBy,
    url: input.url,
    expiresInDays: INVITATION_DAYS,
    ...(input.accessFrom === undefined || input.accessTo === undefined
      ? {}
      : {
          accessWindow: { from: emailDate(input.accessFrom), to: emailDate(input.accessTo) },
        }),
    reissued: input.reissued,
  });

  try {
    await send.send({
      to: input.to,
      subject: message.subject,
      body: message.body,
      html: message.html,
    });
  } catch (error) {
    console.error("[settings:invitation-email]", error);
    return {
      ok: false,
      detail: `Emailed nothing — Resend refused it: ${trimmed(error)}. Hand them the link below instead.`,
    };
  }

  return {
    ok: true,
    detail:
      config.limitation === undefined
        ? `Emailed to ${input.to}.`
        : `Sent to ${input.to}, but ${config.limitation} Until then, hand them the link below.`,
  };
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

  const url = invitationUrl(await origin(), token);
  const sender = await findUser(actor.id, now);
  const sent = await emailInvitation({
    to: email,
    name: user.name,
    url,
    invitedBy: sender?.user.name ?? "An owner",
    propertyId: actor.propertyId,
    accessFrom,
    accessTo,
    reissued: false,
  });

  revalidated();
  return {
    ok: true,
    message: `${user.name} added. This is the only time the link is shown.`,
    link: url,
    email: sent,
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

  const url = invitationUrl(await origin(), token);
  const sender = await findUser(actor.id, now);
  const sent = await emailInvitation({
    to: found.user.email,
    name: found.user.name,
    url,
    invitedBy: sender?.user.name ?? "An owner",
    propertyId: actor.propertyId,
    accessFrom: found.user.accessFrom,
    accessTo: found.user.accessTo,
    // The reset path as well as the never-accepted one — §4.3 makes them the
    // same action, so they are the same email with one sentence different.
    reissued: true,
  });

  revalidated();
  return {
    ok: true,
    message: `New link for ${found.user.name}. Any earlier one has stopped working.`,
    link: url,
    email: sent,
  };
}

/**
 * Send one real email to somebody on the list, and report what came back.
 *
 * This is the only path in the app that proves email works end to end, and it
 * exists because every other path is one nobody wants to exercise on purpose:
 * §6's twenty-two triggers fire on a schedule, from a cron route, about things
 * that have to actually be true — you cannot check the wiring by waiting for a
 * cow to reach day 279.
 *
 * **Every failure is reported in the provider's own words.** Deliberately, and
 * it is the whole value of the button: an unverified sender domain, a revoked
 * key and a typo in `EMAIL_FROM` all look identical from outside, and Resend
 * says which it is. The alternative — "Could not send the email" — leaves
 * somebody reading Netlify logs for a sentence that was already in their hand.
 * Nothing here is secret; the key never appears in a Resend error.
 *
 * Owner-only, like everything else in this file: sending mail from the farm's
 * address to an address of the caller's choosing is not something a member
 * gets, and a hidden button is not a permission check (§4.3).
 */
export async function sendTestEmail(id: Ulid): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const now = new Date();
  const found = await findUser(id, now);
  if (found === undefined || found.user.propertyId !== actor.propertyId) {
    return { ok: false, error: "That account is not on this property." };
  }

  const config = emailConfig();
  const send = notifier();
  if (!config.ok || send === undefined) {
    // The reason names the variable and where to set it. Not a field error:
    // there is no input on this screen that would fix it.
    return { ok: false, error: config.ok ? "Email is not configured." : config.reason };
  }

  // Named in the body so the person opening it knows who to ask about it.
  // `Actor` carries a role and an id rather than a name — it is what the
  // session holds, and a name is not a permission — so it comes from the row.
  const sender = await findUser(actor.id, now);

  const message = testEmailMessage({
    farmName: await farmName(actor.propertyId),
    sentBy: sender?.user.name ?? "Somebody with an owner account",
    sentAt: now,
    origin: await origin(),
  });

  try {
    const receipt = await send.send({
      to: found.user.email,
      subject: message.subject,
      body: message.body,
      html: message.html,
    });

    return {
      ok: true,
      message: `Test email sent to ${found.user.email}${
        receipt.id === undefined ? "" : ` — Resend id ${receipt.id}`
      }.`,
      ...(config.limitation === undefined
        ? {}
        : { email: { ok: true, detail: config.limitation } }),
    };
  } catch (error) {
    // Logged as well as shown. The shown copy is trimmed to something that
    // fits in a box; the log keeps the whole of it.
    console.error("[settings:test-email]", error);
    return {
      ok: false,
      error: `Resend refused it: ${trimmed(error)}`,
    };
  }
}

/** Enough of a provider's complaint to act on, without a wall of JSON. */
function trimmed(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length <= 400 ? text : `${text.slice(0, 400)}…`;
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
