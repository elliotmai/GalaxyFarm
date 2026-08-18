import type { NotificationMessage, NotificationReceipt, Notifier } from "@galaxy-farm/core";

import { encryptPayload, type SubscriptionKeys } from "./encryption.js";
import { vapidAuthorization } from "./vapid.js";

/**
 * Web push, behind the kernel's `Notifier` port (spec §6).
 *
 * §6 said "email now (Resend), web push later behind the same `Notifier`
 * port", and this is later. Nothing that sends a notification changes: it holds
 * a `Notifier`, calls `send`, and whether that reaches an inbox, a phone, or
 * both is decided once in the composition root.
 *
 * The one thing this adapter knows that the email one does not is that a
 * *person* is not an address here. A subscription belongs to a browser on a
 * device — a phone and a laptop are two of them, revoking one leaves the other
 * alone — so a message addressed to somebody fans out to every subscription
 * they hold, and the lookup that turns an address into subscriptions is
 * injected rather than known here.
 *
 * Written against `fetch` and the push protocol directly rather than the
 * `web-push` package, following `resend.ts`: the surface needed is one POST
 * with two headers, and a `fetch` this file can be handed is what lets every
 * test run without a network.
 */

/** One browser on one device. */
export interface PushSubscriptionRecord {
  /** The push service's capability URL for this device. Unique, and the identity. */
  readonly endpoint: string;
  readonly keys: SubscriptionKeys;
}

export interface WebPushOptions {
  readonly config: {
    readonly publicKey: string;
    readonly privateKey: string;
    readonly subject: string;
  };
  /** Every subscription belonging to the address a message is sent to. */
  readonly subscriptions: (to: string) => Promise<readonly PushSubscriptionRecord[]>;
  /**
   * A subscription the push service says no longer exists.
   *
   * Called on 404 and 410 and nothing else. Those two are the browser's answer
   * to "this permission was revoked, this profile was wiped, this app was
   * uninstalled" — the row will never work again, and a store that does not
   * delete it retries it on every alert forever, which is how a dead phone
   * ends up costing a request per notification per day.
   */
  readonly onGone: (subscription: PushSubscriptionRecord) => Promise<void>;
  /** Where a tap should land. A path, resolved against the app's own origin by the worker. */
  readonly defaultUrl?: string;
  readonly ttlSeconds?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

/**
 * How long a push service holds a message for a device that is offline.
 *
 * A day. Long enough for a phone that spent the night in a truck, short enough
 * that a tank-freeze warning is never delivered after the freeze — an alert
 * about weather that has already happened is worse than no alert, because it
 * teaches somebody to ignore the next one.
 */
export const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * What the service worker is handed, as JSON.
 *
 * Kept to the three fields `sw.ts` reads. `apps/web/lib/sw-contract.ts` holds
 * the parsing half of this agreement and `apps/web/tests/push-payload.test.ts`
 * runs one against the other, because the two halves are compiled into
 * different programs and nothing else would notice them drifting apart.
 */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

/** Gone for good, rather than failed. */
const GONE_STATUSES = [404, 410];

export function webPushNotifier(options: WebPushOptions): Notifier {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const url = options.defaultUrl ?? "/";

  async function deliver(
    subscription: PushSubscriptionRecord,
    input: NotificationMessage,
  ): Promise<{ readonly receipt?: NotificationReceipt; readonly failure?: string }> {
    const payload: PushPayload = { title: input.subject, body: input.body, url };
    const { body } = encryptPayload(JSON.stringify(payload), subscription.keys);

    const response = await doFetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(options.config, subscription.endpoint, now()),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
      },
      body: new Uint8Array(body),
    });

    if (GONE_STATUSES.includes(response.status)) {
      await options.onGone(subscription);
      return {};
    }

    if (!response.ok) {
      // The body carries the push service's own reason, which is worth
      // surfacing for the same reason Resend's is: 400 covers a malformed
      // payload and an expired VAPID token alike, and the two send somebody
      // looking in different places.
      const detail = await response.text().catch(() => "");
      return {
        failure: `${response.status} ${response.statusText} from ${origin(subscription.endpoint)}: ${detail}`,
      };
    }

    // Push services return the message's own URL. It is the nearest thing to
    // Resend's id, and it is what a support conversation with one of them
    // would be about.
    return { receipt: idFrom(response) ?? {} };
  }

  return {
    async send(input: NotificationMessage): Promise<NotificationReceipt> {
      const subscriptions = await options.subscriptions(input.to);
      // Nobody subscribed a device, or every one of them has been pruned.
      // Successfully nothing: this is the normal state for anybody who has not
      // turned push on, and it is not a failure to report to a caller that
      // never asked for push in the first place.
      if (subscriptions.length === 0) return {};

      const results = await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            return await deliver(subscription, input);
          } catch (error) {
            return { failure: error instanceof Error ? error.message : String(error) };
          }
        }),
      );

      const receipt = results.find((result) => result.receipt !== undefined)?.receipt;
      if (receipt !== undefined) return receipt;

      const failures = results.flatMap((result) =>
        result.failure === undefined ? [] : [result.failure],
      );
      // Every failure was a subscription that no longer exists, so there is
      // nothing wrong and nothing left to retry — the rows are gone.
      if (failures.length === 0) return {};

      throw new Error(`Web push failed for every device — ${failures.join("; ")}`);
    },
  };
}

/** The push service, for an error message. The path is the subscription and is not ours to log. */
function origin(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "the push service";
  }
}

function idFrom(response: Response): { readonly id: string } | undefined {
  const location = response.headers?.get?.("location") ?? undefined;
  return location === undefined || location === null || location === ""
    ? undefined
    : { id: location };
}
