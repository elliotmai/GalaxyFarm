"use server";

import { revalidatePath } from "next/cache";

import { can, isUlid, type Ulid } from "@galaxy-farm/core";

import { currentActor, signOut } from "@/lib/auth";
import { isDeviceLive, revokeDevice } from "@/lib/device-store";
import { forgetDeviceToken } from "@/lib/kiosk-session";
import { logEggsForKiosk, moveAnimalForKiosk, type LogEggsInput } from "@/lib/kiosk-store";
import { verifyKioskPin } from "@/lib/kiosk-pin-store";
import { tickChore } from "@/lib/sitter-store";

/**
 * The kiosk surface's server actions (spec §4.4).
 *
 * Every one of these re-checks its own capability, for the reason every other
 * action file in this app repeats: a server action is a POST endpoint with a
 * generated name, and a barn screen is an unattended machine anybody can send
 * a request from. Nothing here trusts that `/kiosk`'s UI only shows what the
 * whitelist allows.
 */

export type KioskResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

async function kioskActor() {
  const actor = await currentActor();
  return actor?.role === "kiosk" || actor?.role === "owner" || actor?.role === "member"
    ? actor
    : undefined;
}

const asUlid = (value: string | undefined): Ulid | undefined =>
  value !== undefined && isUlid(value) ? value : undefined;

/**
 * Ticking a chore off, from a kiosk (spec §4.3 `chores.complete`).
 *
 * Reuses `tickChore` directly rather than `/sitter`'s action — a kiosk's
 * write is attributed to the *device*, not `sitter:${actorId}`, so the audit
 * log names the screen rather than borrowing a housesitter's label.
 */
export async function setKioskChoreDone(input: {
  readonly taskId?: string | undefined;
  readonly templateId?: string | undefined;
  /** A derived feeding trip's own id — re-derived and checked in `tickChore`. */
  readonly sourceKey?: string | undefined;
  readonly day: string;
  readonly done: boolean;
}): Promise<KioskResult> {
  const actor = await kioskActor();
  if (actor === undefined) return { ok: false, error: "Not signed in to this screen." };

  const now = new Date();
  if (!can(actor, "chores.complete", now)) {
    return { ok: false, error: "This screen cannot change chores." };
  }
  if (actor.role === "kiosk" && actor.deviceId !== undefined) {
    const live = await isDeviceLive(actor.deviceId as Ulid, actor.propertyId);
    if (!live) return { ok: false, error: "This screen has been unpaired." };
  }

  const taskId = asUlid(input.taskId);
  const templateId = asUlid(input.templateId);
  // Length-checked only: the key is an opaque derived id whose real
  // validation is `tickChore` rebuilding the occurrence from the plans.
  const sourceKey =
    typeof input.sourceKey === "string" &&
    input.sourceKey.length > 0 &&
    input.sourceKey.length <= 200
      ? input.sourceKey
      : undefined;
  if (taskId === undefined && templateId === undefined && sourceKey === undefined) {
    return { ok: false, error: "That chore is not on the list any more." };
  }

  const date = new Date(`${input.day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "That day is not a day." };

  const result = await tickChore({
    propertyId: actor.propertyId,
    actorId: actor.id,
    ...(taskId === undefined ? {} : { taskId }),
    ...(templateId === undefined ? {} : { templateId }),
    ...(sourceKey === undefined ? {} : { sourceKey }),
    date,
    at: now,
    done: input.done,
    deviceId: actor.deviceId ?? `kiosk-surface:${actor.id}`,
  });

  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/kiosk/chores");
  revalidatePath("/kiosk/housesitter");
  return { ok: true };
}

export async function logKioskEggs(input: LogEggsInput): Promise<KioskResult> {
  const actor = await kioskActor();
  if (actor === undefined) return { ok: false, error: "Not signed in to this screen." };

  const now = new Date();
  const outcome = await logEggsForKiosk(actor, input, now);
  if (!outcome.ok) return { ok: false, error: outcome.reason };

  revalidatePath("/kiosk/eggs");
  return { ok: true };
}

export async function moveKioskAnimal(input: {
  readonly animalId: string;
  readonly zoneId: string;
}): Promise<KioskResult> {
  const actor = await kioskActor();
  if (actor === undefined) return { ok: false, error: "Not signed in to this screen." };
  if (!isUlid(input.animalId) || !isUlid(input.zoneId)) {
    return { ok: false, error: "That is not a real animal or pen." };
  }

  const now = new Date();
  const outcome = await moveAnimalForKiosk(
    actor,
    { animalId: input.animalId as Ulid, zoneId: input.zoneId as Ulid },
    now,
  );
  if (!outcome.ok) return { ok: false, error: outcome.reason };

  revalidatePath("/kiosk/pen-board");
  return { ok: true };
}

/**
 * Check the shared kiosk PIN, without ever sending its hash — or its
 * plaintext — to the browser. The Elevated confirm dialog asks "are you
 * sure"; this is the separate, server-verified "prove somebody is really
 * standing here" step in front of the one destructive thing a kiosk can do to
 * itself.
 */
export async function checkKioskPin(pin: string): Promise<boolean> {
  const actor = await currentActor();
  if (actor === undefined) return false;
  return verifyKioskPin(actor.propertyId, pin);
}

/**
 * A screen taking itself out of service (spec §4.5: revoking a device is an
 * Elevated, irreversible non-delete). Self-service and PIN-gated rather than
 * routed through `devices.manage`, because the authority to do this is
 * standing in front of the screen, not a capability on the session — the same
 * reasoning that lets a kiosk log eggs without `records.write`.
 */
export async function unpairThisDevice(): Promise<KioskResult> {
  const actor = await currentActor();
  if (actor === undefined || actor.role !== "kiosk" || actor.deviceId === undefined) {
    return { ok: false, error: "This is not a paired screen." };
  }

  // The write half of an Elevated confirmation, plus a server-verified PIN
  // when one is set, kiosk-home.tsx's UnpairButton already ran before this.
  // crud-guard: allow-unconfirmed — confirmed client-side before this runs
  await revokeDevice(actor.deviceId as Ulid, new Date());
  // Both halves of being signed in, not just the session: a screen that kept
  // its device token would sit at `/kiosk/pair` trying to resume with a token
  // that is now revoked, and "unpair" has to mean the screen stops rather than
  // fails repeatedly.
  await forgetDeviceToken();
  await signOut({ redirect: false });
  return { ok: true };
}

/** Whether this session is even allowed to ask — used to hide the PIN step when there is none set. */
export async function kioskCapabilities(): Promise<{
  readonly canMoveAnimals: boolean;
  readonly canLogEggs: boolean;
  readonly canCompleteChores: boolean;
}> {
  const actor = await currentActor();
  const now = new Date();
  return {
    canMoveAnimals: actor !== undefined && can(actor, "animals.move", now),
    canLogEggs: actor !== undefined && can(actor, "eggs.log", now),
    canCompleteChores: actor !== undefined && can(actor, "chores.complete", now),
  };
}
