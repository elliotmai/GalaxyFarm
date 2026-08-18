/**
 * Web push, behind the kernel's `Notifier` port (spec §3, §6).
 *
 * The adapter is in `web-push.ts`, the payload encryption RFC 8291 demands is
 * in `encryption.ts`, and the application-server identity RFC 8292 demands is
 * in `vapid.ts` — split because only the first of the three has anything to do
 * with notifications. The other two are cryptography that happens to be
 * specified by the push standards, and they are tested against those standards'
 * own vectors rather than against this app's behaviour.
 */

export * from "./web-push.js";
export * from "./encryption.js";
export * from "./vapid.js";
