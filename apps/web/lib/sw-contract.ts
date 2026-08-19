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

/**
 * What a push notification carries, once the worker has opened it.
 *
 * The wire shape agreed with `@galaxy-farm/infra-push`, which writes it. It
 * cannot be imported from there: this file is compiled into the worker, which
 * has no `node:crypto` and no business linking an adapter — so the two halves
 * are held together by `apps/web/tests/push-payload.test.ts` running the real
 * encoder through the parser below.
 */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  /** Where a tap lands, as a path on this origin. */
  readonly url: string;
}

/**
 * What a notification says when the payload is missing or unreadable.
 *
 * There has to be one. A `push` event that shows no notification is a "silent
 * push", and browsers answer repeated silent pushes by showing their own
 * "this site was updated in the background" notice or revoking the permission
 * outright — so the failure mode of a truncated payload has to be a vague
 * notification, never no notification.
 */
export const PUSH_FALLBACK: PushPayload = {
  title: "Galaxy Farm",
  body: "Something needs looking at. Open the app to see what.",
  url: "/admin",
};

/**
 * Read a payload defensively.
 *
 * Every field is checked rather than trusted, because this runs on data that
 * arrived over a push service and is parsed inside a worker where a thrown
 * error means the event handler dies and nothing is shown at all.
 */
export function parsePushPayload(raw: string | undefined): PushPayload {
  if (raw === undefined || raw === "") return PUSH_FALLBACK;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A push service that delivered something we did not send, or a payload
    // cut short. Neither is worth losing the notification over.
    return PUSH_FALLBACK;
  }

  if (typeof parsed !== "object" || parsed === null) return PUSH_FALLBACK;
  const fields = parsed as Record<string, unknown>;
  const text = (key: string, fallback: string): string =>
    typeof fields[key] === "string" && fields[key] !== "" ? (fields[key] as string) : fallback;

  return {
    title: text("title", PUSH_FALLBACK.title),
    body: text("body", PUSH_FALLBACK.body),
    // A relative path only. An absolute URL in a payload is somebody else's
    // origin, and a notification that opens one is the app handing its own
    // tap to a stranger.
    url: text("url", PUSH_FALLBACK.url).startsWith("/")
      ? text("url", PUSH_FALLBACK.url)
      : PUSH_FALLBACK.url,
  };
}
