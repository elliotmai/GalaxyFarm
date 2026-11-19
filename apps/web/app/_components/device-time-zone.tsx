"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { browserTimeZone, TIME_ZONE_COOKIE } from "@/lib/device-time-zone";

/**
 * Tells the server which time zone this device is in (`lib/device-time-zone.ts`).
 *
 * Written on every load, so a phone that travels and changes zone corrects
 * itself the next time it opens the app. When the cookie actually changes, the
 * page is refreshed once, so anything the server drew with the old zone is
 * drawn again with the new one. Screens that read IndexedDB do not depend on
 * this.
 */
export function DeviceTimeZone() {
  const router = useRouter();

  useEffect(() => {
    const zone = browserTimeZone();
    if (zone === undefined) return;

    const encoded = encodeURIComponent(zone);
    const current = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${TIME_ZONE_COOKIE}=`))
      ?.slice(TIME_ZONE_COOKIE.length + 1);
    if (current === encoded) return;

    document.cookie = `${TIME_ZONE_COOKIE}=${encoded}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
