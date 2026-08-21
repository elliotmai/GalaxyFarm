"use server";

import { revalidatePath } from "next/cache";

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TRIGGERS,
  isUlid,
  type NotificationChannel,
  type NotificationTrigger,
  type Ulid,
} from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";
import { saveSetting } from "@/lib/notification-prefs";
import { pushNotifier } from "@/lib/notifier";
import {
  deleteDevice,
  deviceIdForEndpoint,
  forgetEndpointFor,
  saveSubscription,
} from "@/lib/push-store";
import { findUser } from "@/lib/user-store";

/**
 * Turning push on and off, and choosing what arrives (spec §6, §4.5).
 *
 * The same shape as `device-actions.ts` beside it: `push_subscriptions` and
 * `notification_settings` never reach a local store, so this is a server-action
 * screen that re-reads afterwards rather than a `useMutations` one.
 *
 * **No capability gate, deliberately** — unlike People and Kiosk devices, which
 * are owner-only. Everything here is a person acting on themselves: their own
 * phone, their own preferences. The scoping is the actor's own id on every
 * query, so there is no id a caller could pass to reach somebody else's row.
 *
 * **A kiosk cannot subscribe.** §6's preferences are per person and a barn
 * screen is a device with no person behind it — see the note on the screen.
 * The check is here rather than only in the UI for the reason every sibling
 * file repeats: a server action is a POST endpoint with a generated name.
 */

export type ActionResult =
  { readonly ok: true; readonly message: string } | { readonly ok: false; readonly error: string };

const REFUSED: ActionResult = {
  ok: false,
  error: "Only somebody signed in as themselves can change notification settings.",
};

async function person(): Promise<{ readonly id: Ulid; readonly propertyId: Ulid } | undefined> {
  const actor = await currentActor();
  if (actor === undefined || actor.role === "kiosk") return undefined;
  return { id: actor.id, propertyId: actor.propertyId };
}

function revalidated(): void {
  revalidatePath("/admin/settings");
}

/** What the browser handed back from `pushManager.subscribe`. */
export interface SubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly deviceLabel: string;
}

export async function subscribeDevice(input: SubscriptionInput): Promise<ActionResult> {
  const actor = await person();
  if (actor === undefined) return REFUSED;

  // Validated rather than trusted, like every other boundary (§4.5 clause 2).
  // These are the sizes the browser's own API produces; anything else is a
  // subscription nothing could ever be encrypted to.
  const endpoint = input.endpoint.trim();
  if (!/^https:\/\//.test(endpoint)) {
    return { ok: false, error: "That is not a push endpoint." };
  }
  if (Buffer.from(input.p256dh, "base64url").length !== 65) {
    return { ok: false, error: "This browser's subscription key is the wrong size." };
  }
  if (Buffer.from(input.auth, "base64url").length !== 16) {
    return { ok: false, error: "This browser's subscription secret is the wrong size." };
  }

  await saveSubscription(
    {
      propertyId: actor.propertyId,
      userId: actor.id,
      endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      deviceLabel: input.deviceLabel.trim().slice(0, 60) || "This device",
    },
    new Date(),
  );

  revalidated();
  return { ok: true, message: "Notifications are on for this device." };
}

/** This browser, unsubscribing itself. The endpoint is what it knows about. */
export async function unsubscribeDevice(endpoint: string): Promise<ActionResult> {
  const actor = await person();
  if (actor === undefined) return REFUSED;

  await forgetEndpointFor(endpoint, actor.id);

  revalidated();
  return { ok: true, message: "Notifications are off for this device." };
}

/**
 * Which row in the list is the browser asking.
 *
 * Not a permission question and not a write — it answers only about the
 * asker's own subscriptions, and an endpoint that is not one of theirs simply
 * matches nothing.
 */
export async function identifyDevice(endpoint: string): Promise<string | undefined> {
  const actor = await person();
  if (actor === undefined) return undefined;

  return deviceIdForEndpoint(endpoint, actor.id);
}

/** Another device, revoked from this one — the phone left in a feed store. */
export async function revokeDevice(id: string): Promise<ActionResult> {
  const actor = await person();
  if (actor === undefined) return REFUSED;
  if (!isUlid(id)) return { ok: false, error: "That device is not on your account." };

  // crud-guard: allow-unconfirmed — confirmed client-side before this runs
  const removed = await deleteDevice(id as Ulid, actor.id);
  if (!removed) return { ok: false, error: "That device is not on your account." };

  revalidated();
  return { ok: true, message: "That device will stop receiving notifications." };
}

/**
 * Send a real notification to this person's own devices.
 *
 * The push equivalent of the People screen's **Test email** button, and it
 * exists for the same reason that one does: "it is configured" and "it
 * arrives" are different claims, the gap between them is a browser permission,
 * a wrong VAPID pair, or an iPhone that was never added to the home screen,
 * and none of those is visible from this side. §6's whole point is a phone
 * that buzzes with the app closed — so there has to be a way to find out
 * whether it does, without waiting for a hard freeze.
 *
 * Push only, never email. This is a question about push.
 */
export async function sendTestNotification(): Promise<ActionResult> {
  const actor = await person();
  if (actor === undefined) return REFUSED;

  const send = pushNotifier();
  if (send === undefined) {
    return { ok: false, error: "Push is not set up for this farm, so there is nothing to test." };
  }

  const now = new Date();
  const self = await findUser(actor.id, now);
  if (self === undefined) return { ok: false, error: "Could not find your own account." };

  try {
    const receipt = await send.send({
      to: self.user.email,
      subject: "Galaxy Farm test",
      body: "If this arrived, the farm can reach this device with the app closed.",
    });

    // An empty receipt means no device took it — every subscription was
    // pruned, or there never was one. Worth saying, because the alternative
    // is a success message and a phone that never buzzes.
    return receipt.id === undefined
      ? {
          ok: false,
          error:
            "Nothing was sent: no device of yours is subscribed. Turn notifications on for this device first.",
        }
      : { ok: true, message: "Sent. It should arrive on every device listed below." };
  } catch (error) {
    // The push service's own words, for the same reason the Test email button
    // reports Resend's: a 400 covers an expired token and a malformed payload
    // alike, and only the service knows which.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setTriggerChannel(trigger: string, channel: string): Promise<ActionResult> {
  const actor = await person();
  if (actor === undefined) return REFUSED;

  // Both arrive as strings off a form control, so both are resolved against
  // the closed lists rather than used to index anything.
  if (!NOTIFICATION_TRIGGERS.includes(trigger as NotificationTrigger)) {
    return { ok: false, error: "There is no such notification." };
  }
  if (!NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) {
    return { ok: false, error: "There is no such channel." };
  }

  await saveSetting(
    {
      propertyId: actor.propertyId,
      userId: actor.id,
      trigger: trigger as NotificationTrigger,
      channel: channel as NotificationChannel,
    },
    new Date(),
  );

  revalidated();
  return { ok: true, message: "Saved." };
}
