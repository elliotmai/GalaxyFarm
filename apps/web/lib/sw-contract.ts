/**
 * What the page and its service worker have agreed on.
 *
 * Two constants, in their own file for a reason worth stating: this is the only
 * module imported by *both* programs. `app/sw.ts` is compiled against
 * `lib.webworker` — no `window`, no `document` — and everything else in the app
 * is compiled against `lib.dom`, so nothing that touches either can be shared
 * across the line. A file with no runtime at all can be.
 *
 * See the note in `apps/web/tsconfig.json` for why they are two programs.
 */

/**
 * The offline fallback route.
 *
 * Three places have to agree on it: the worker that serves it, the page that
 * renders it, and the precache entry in `next.config.ts` that puts it on the
 * device. The config cannot import this — Next loads it before any path alias
 * exists — so `apps/web/tests/pwa-wiring.test.ts` fails if the literal there
 * ever stops matching. A fallback precached at a URL the worker does not serve
 * from is a page nobody would ever see.
 */
export const OFFLINE_ROUTE = "/offline";

/**
 * The message a waiting worker understands as "take over now".
 *
 * Serwist registers a listener for exactly this shape when `skipWaiting` is
 * off, following the convention Workbox set. It is a string on a wire between
 * two programs, so it is written down once rather than typed out at both ends.
 */
export const SKIP_WAITING = "SKIP_WAITING";
