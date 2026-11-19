import { cookies } from "next/headers";

import { TIME_ZONE_COOKIE } from "@/lib/device-time-zone";
import { isTimeZone } from "@/lib/farm-time";

/**
 * The zone of the device that made this request, or undefined if it has not
 * said yet (`lib/device-time-zone.ts`).
 *
 * Server-only. Callers fall back to the property's own zone, which is the
 * best guess for a device that has not reported its zone yet.
 */
export async function requestTimeZone(): Promise<string | undefined> {
  try {
    const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
    const zone = value === undefined ? undefined : decodeURIComponent(value);
    return isTimeZone(zone) ? zone : undefined;
  } catch {
    // Outside a request (a test, a script), so there is no device to ask.
    return undefined;
  }
}
