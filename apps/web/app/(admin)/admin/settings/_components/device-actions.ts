"use server";

import { revalidatePath } from "next/cache";

import { can, isUlid, type Ulid } from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";
import {
  createDevice,
  findDevice,
  isDeleted,
  lockDeviceToBoard,
  reissuePairing,
  renameDevice,
  restoreDevice,
  revokeDevice,
  tombstoneDevice,
  type KioskDevice,
} from "@/lib/device-store";
import { clearKioskPin, setKioskPin } from "@/lib/kiosk-pin-store";
import { kioskBoardFor } from "@/lib/kiosk-boards";

/**
 * Managing kiosk devices (spec §4.4, §4.5). The same shape as
 * `user-actions.ts`: `kioskDevices` never reaches a local store, so this is a
 * server action screen that re-reads afterwards, not a `useMutations` one.
 *
 * `devices.manage` belongs to `owner` alone (§4.3) — a lost or misused screen
 * is the same class of decision as who else gets an account, and every action
 * here re-checks it for the reason every sibling file repeats: a server
 * action is a POST endpoint with a generated name.
 */

export type ActionResult =
  | { readonly ok: true; readonly message: string; readonly device?: KioskDevice }
  | { readonly ok: false; readonly error: string; readonly field?: string };

const REFUSED: ActionResult = {
  ok: false,
  error: "You do not have permission to manage kiosk devices.",
};

async function managingActor() {
  const actor = await currentActor();
  if (actor === undefined) return undefined;
  return can(actor, "devices.manage", new Date()) ? actor : undefined;
}

function revalidated(): void {
  revalidatePath("/admin/settings");
}

export async function addDevice(name: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: "Give the screen a name.", field: "name" };

  const device = await createDevice({ propertyId: actor.propertyId, name: trimmed }, new Date());

  revalidated();
  return {
    ok: true,
    message: `${device.name} is ready to pair. The code is good for fifteen minutes.`,
    device,
  };
}

async function owned(id: string, propertyId: string): Promise<KioskDevice | undefined> {
  if (!isUlid(id)) return undefined;
  const device = await findDevice(id as Ulid);
  return device !== undefined && device.propertyId === propertyId ? device : undefined;
}

export async function renameDeviceAction(id: string, name: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const device = await owned(id, actor.propertyId);
  if (device === undefined) return { ok: false, error: "That screen is not on this property." };

  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: "Give the screen a name.", field: "name" };

  await renameDevice(device.id, trimmed, new Date());
  revalidated();
  return { ok: true, message: `Renamed to ${trimmed}.` };
}

export async function lockDeviceAction(
  id: string,
  boardSlug: string | null,
): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const device = await owned(id, actor.propertyId);
  if (device === undefined) return { ok: false, error: "That screen is not on this property." };

  if (boardSlug !== null && kioskBoardFor(boardSlug) === undefined) {
    return { ok: false, error: "That is not a real board." };
  }

  await lockDeviceToBoard(device.id, boardSlug, new Date());
  revalidated();
  return {
    ok: true,
    message:
      boardSlug === null
        ? `${device.name} now shows the board picker.`
        : `${device.name} is locked to ${kioskBoardFor(boardSlug)!.label}.`,
  };
}

/**
 * A fresh code for a device that already exists — moving the same identity
 * onto a new physical screen, or recovering one that never finished pairing.
 * The old token stops working the instant this returns.
 */
export async function reissueDeviceAction(id: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const device = await owned(id, actor.propertyId);
  if (device === undefined) return { ok: false, error: "That screen is not on this property." };

  const reissued = await reissuePairing(device.id, new Date());
  if (reissued === undefined) return { ok: false, error: "Could not issue a new code." };

  revalidated();
  return {
    ok: true,
    message: `New code for ${device.name}. The old one has stopped working.`,
    device: reissued,
  };
}

/** Elevated, irreversible (§4.5): the screen stops working within one sync interval. */
export async function revokeDeviceAction(id: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const device = await owned(id, actor.propertyId);
  if (device === undefined) return { ok: false, error: "That screen is not on this property." };

  // The write half of an Elevated confirmation devices-screen.tsx's client
  // component already showed before calling revokeDeviceAction.
  // crud-guard: allow-unconfirmed — confirmed client-side before this runs
  await revokeDevice(device.id, new Date());
  revalidated();
  return { ok: true, message: `${device.name} revoked. It will stop syncing shortly.` };
}

/**
 * Delete — a tombstone the screen can be brought back from (§4.5 clause 4).
 *
 * Elevated rather than Typed: it is a screen, not an aggregate root, and
 * nothing on the farm is recorded against it — its three whitelisted writes
 * are attributed to the device, and they stay attributed to it whether the row
 * is in the list or in the tombstones. What makes it more than Standard is
 * that a live screen goes dark, which is §4.5's "anything on a kiosk".
 */
export async function deleteDeviceAction(id: string, reason?: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const device = await owned(id, actor.propertyId);
  if (device === undefined) return { ok: false, error: "That screen is not on this property." };
  if (isDeleted(device)) return { ok: false, error: `${device.name} is already deleted.` };

  // The write half of an Elevated confirmation devices-screen.tsx's client
  // component already showed before calling deleteDeviceAction.
  // crud-guard: allow-unconfirmed — confirmed client-side before this runs
  await tombstoneDevice(device.id, actor.id, new Date(), reason);
  revalidated();
  return {
    ok: true,
    message: `${device.name} deleted. Restore it from Deleted screens if that was a slip.`,
  };
}

export async function restoreDeviceAction(id: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const device = await owned(id, actor.propertyId);
  if (device === undefined) return { ok: false, error: "That screen is not on this property." };
  if (!isDeleted(device)) return { ok: false, error: `${device.name} is not deleted.` };

  await restoreDevice(device.id, new Date());
  revalidated();
  return {
    ok: true,
    // Said out loud because a restored screen picks its own session back up
    // without anybody touching it, which is not what "restore" implies
    // everywhere else in the app.
    message:
      device.revokedAt === undefined && device.pairedAt !== undefined
        ? `${device.name} restored, and syncing again shortly.`
        : `${device.name} restored.`,
  };
}

export async function setKioskPinAction(pin: string): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  if (!/^\d{4,8}$/.test(pin)) {
    return { ok: false, error: "The PIN needs to be 4 to 8 digits.", field: "pin" };
  }

  await setKioskPin(actor.propertyId, pin, new Date());
  revalidated();
  return { ok: true, message: "Kiosk PIN set." };
}

export async function clearKioskPinAction(): Promise<ActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  // The write half of an Elevated confirmation devices-screen.tsx's client
  // component already showed before calling clearKioskPinAction.
  // crud-guard: allow-unconfirmed — confirmed client-side before this runs
  await clearKioskPin(actor.propertyId, new Date());
  revalidated();
  return { ok: true, message: "Kiosk PIN cleared." };
}
