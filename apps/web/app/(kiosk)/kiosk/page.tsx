import { redirect } from "next/navigation";

import type { Ulid } from "@galaxy-farm/core";

import { KioskHome } from "@/app/(kiosk)/kiosk/_components/kiosk-home";
import { currentActor } from "@/lib/auth";
import { withDeadline } from "@/lib/deadline";
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

  /*
   * Both reads are bounded, and a bare `.catch` is not a substitute.
   *
   * This page renders on the server and asks Postgres two questions. A catch
   * handles a query that *fails*; it does nothing for one that never answers,
   * and never answering is what an unreachable database does here — the
   * driver's connect timeout is thirty seconds and the pool is one connection
   * deep, so a second request queues behind the first one's backoff. The page
   * then hangs rather than rendering, which on a barn screen is a black
   * rectangle somebody has to power-cycle.
   *
   * `/admin/settings` already wraps this same `hasKioskPin` call for exactly
   * this reason. This page was missed, and `lib/deadline.ts` still describes
   * settings and the invitation page as the only two that read from Postgres
   * — the kiosk home is a third.
   *
   * The redirect stays outside the catches: `redirect()` works by throwing,
   * and swallowing that would leave a locked screen sitting on the picker it
   * is locked away from.
   */
  if (actor.role === "kiosk" && actor.deviceId !== undefined) {
    const device = await withDeadline(findDevice(actor.deviceId as Ulid), "the kiosk device").catch(
      (error: unknown) => {
        console.error("[kiosk:device]", error);
        return undefined;
      },
    );
    deviceName = device?.name;

    const locked = kioskBoardFor(device?.lockedToBoard);
    if (locked !== undefined) redirect(locked.route);
  }

  // False on failure, which is the safe way round: the PIN gate is offered
  // when one is set, and a screen that cannot tell falls back to asking.
  const pinSet = await withDeadline(hasKioskPin(actor.propertyId), "the kiosk PIN").catch(
    (error: unknown) => {
      console.error("[kiosk:pin]", error);
      return false;
    },
  );

  return <KioskHome {...(deviceName === undefined ? {} : { deviceName })} pinSet={pinSet} />;
}
