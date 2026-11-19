/**
 * The time zone of the device somebody is holding.
 *
 * Screens that read IndexedDB already run on the device's clock. Code that
 * runs on the server does not: Netlify runs in UTC, so after about 6 p.m. in
 * Texas the server thinks it is already tomorrow. The device writes its zone
 * into this cookie, and server code reads it back with `requestTimeZone`
 * (`lib/request-time-zone.ts`), so a page drawn on the server and a chore
 * ticked through a server action use the same day as the phone does.
 *
 * Imports nothing, so both the client component that writes the cookie and the
 * server code that reads it can use it.
 */
export const TIME_ZONE_COOKIE = "gf-tz";

/** This device's IANA zone, or undefined when the browser does not say. */
export function browserTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : undefined;
  } catch {
    return undefined;
  }
}
