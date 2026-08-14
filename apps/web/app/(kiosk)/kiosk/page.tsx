import { redirect } from "next/navigation";

import type { Ulid } from "@galaxy-farm/core";

import { KioskHome } from "@/app/(kiosk)/kiosk/_components/kiosk-home";
import { currentActor } from "@/lib/auth";
import { findDevice } from "@/lib/device-store";
import { hasKioskPin } from "@/lib/kiosk-pin-store";
import { kioskBoardFor } from "@/lib/kiosk-boards";

export const metadata = { title: "Kiosk" };

/**
 * The kiosk home screen (spec §4.4).
 *
 * "Any screen can be locked to a single board from Settings" is enforced
 * here, not by hiding the picker: a locked screen never renders it at all —
 * it lands straight on its board, every time it is opened or refreshed, which
 * is what makes "locked" mean something on a machine nobody is going to go
 * change the URL on.
 */
export default async function KioskPage() {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/kiosk");

  let deviceName: string | undefined;

  if (actor.role === "kiosk" && actor.deviceId !== undefined) {
    const device = await findDevice(actor.deviceId as Ulid).catch(() => undefined);
    deviceName = device?.name;

    const locked = kioskBoardFor(device?.lockedToBoard);
    if (locked !== undefined) redirect(locked.route);
  }

  const pinSet = await hasKioskPin(actor.propertyId).catch(() => false);

  return <KioskHome {...(deviceName === undefined ? {} : { deviceName })} pinSet={pinSet} />;
}
