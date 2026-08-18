/**
 * The browser's half of subscribing to push (spec §6, issue #41).
 *
 * Everything here runs in a page, not in the worker — the worker receives
 * notifications, the page asks for permission and registers the subscription.
 * The split matters for one reason above all others: **permission is asked for
 * in context and never on load.** A prompt that appears while somebody is
 * reading is denied, and a denial is permanent in every browser that matters —
 * there is no second chance and no way for the app to ask again. So nothing
 * here is called on mount. It is called when a person taps a button that says
 * what they are about to get.
 *
 * The pure parts are exported separately from the parts that touch the
 * browser, so the encoding and the labelling can be tested without a
 * `PushManager` — which no test environment has.
 */

/** What the server needs to store one subscription. */
export interface SubscriptionPayload {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly deviceLabel: string;
}

/**
 * The VAPID public key, as `pushManager.subscribe` wants it.
 *
 * It is base64url in the environment and a `Uint8Array` in the API, and there
 * is no browser helper for the conversion — every web push implementation
 * carries a copy of this function, which is a wart of the standard rather than
 * of this app.
 */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));

  // Built over an ArrayBuffer explicitly rather than with `Uint8Array.from`,
  // which infers the shared-memory-capable `ArrayBufferLike` that
  // `pushManager.subscribe` will not take.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * A name a person will recognise for the device they are looking at.
 *
 * A push endpoint is two hundred characters of opaque URL, and "revoke this
 * one" is only a meaningful choice if the list says which one. Guessed from
 * the user agent, which is imprecise and does not need to be precise: it has
 * to tell a phone from the laptop on the kitchen table, and both from the
 * screen in the barn.
 */
export function deviceLabelFor(userAgent: string): string {
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent))
    return /Mobile/i.test(userAgent) ? "Android phone" : "Android tablet";
  if (/Macintosh/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows PC";
  if (/Linux/i.test(userAgent)) return "Linux PC";
  return "This device";
}

/** The two keys, off a subscription, in the form the store holds them. */
export function keysOf(
  subscription: Pick<PushSubscription, "toJSON">,
): { readonly p256dh: string; readonly auth: string } | undefined {
  const keys = subscription.toJSON().keys;
  if (keys === undefined) return undefined;

  const p256dh = keys["p256dh"];
  const auth = keys["auth"];
  return p256dh === undefined || auth === undefined ? undefined : { p256dh, auth };
}

/** Whether this browser can do any of it. Safari before 16.4 and every iOS browser outside a home-screen app cannot. */
export function pushSupported(scope: {
  readonly Notification?: unknown;
  readonly navigator?: { readonly serviceWorker?: unknown };
  readonly PushManager?: unknown;
}): boolean {
  return (
    scope.Notification !== undefined &&
    scope.PushManager !== undefined &&
    scope.navigator?.serviceWorker !== undefined
  );
}

export type SubscribeResult =
  | { readonly ok: true; readonly payload: SubscriptionPayload }
  | { readonly ok: false; readonly reason: string };

/**
 * Ask for permission and subscribe this browser.
 *
 * Every failure is a returned sentence rather than a throw, because each one
 * has a different thing for a person to do about it and only one of them is
 * fixable in the app. A denial in particular has to be explained on the screen:
 * the browser will never prompt again, and the fix is in browser settings where
 * this app cannot reach.
 */
export async function subscribeThisDevice(
  publicKey: string,
  browser: {
    readonly requestPermission: () => Promise<NotificationPermission>;
    readonly registration: () => Promise<ServiceWorkerRegistration>;
    readonly userAgent: string;
  },
): Promise<SubscribeResult> {
  const permission = await browser.requestPermission();
  if (permission === "denied") {
    return {
      ok: false,
      reason:
        "This browser has notifications blocked for the site. It will not ask again — turn them back on in the browser's own site settings, then try once more.",
    };
  }
  if (permission !== "granted") {
    return { ok: false, reason: "Notifications were not turned on." };
  }

  const registration = await browser.registration();
  const subscription = await registration.pushManager.subscribe({
    // Required, and required to be true: a push a browser will not show is a
    // silent push, and browsers punish those.
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });

  const keys = keysOf(subscription);
  if (keys === undefined) {
    // Nothing can be encrypted to it, so it is worse than useless stored —
    // every send would fail against it forever.
    await subscription.unsubscribe().catch(() => undefined);
    return {
      ok: false,
      reason:
        "This browser subscribed without handing over its keys, so nothing could be sent to it.",
    };
  }

  return {
    ok: true,
    payload: {
      endpoint: subscription.endpoint,
      ...keys,
      deviceLabel: deviceLabelFor(browser.userAgent),
    },
  };
}

/**
 * Unsubscribe this browser, and report the endpoint that was dropped.
 *
 * The endpoint is what the server deletes by, and it has to be read before the
 * unsubscribe: afterwards the object is dead and the row would be orphaned —
 * which is the exact state that has a push service answering 410 to every
 * future send.
 */
export async function unsubscribeThisDevice(
  registration: ServiceWorkerRegistration,
): Promise<string | undefined> {
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return undefined;

  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

/** The endpoint this browser already holds, if it holds one. */
export async function currentEndpoint(
  registration: ServiceWorkerRegistration,
): Promise<string | undefined> {
  const subscription = await registration.pushManager.getSubscription();
  return subscription === null ? undefined : subscription.endpoint;
}
