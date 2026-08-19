import { describe, expect, it, vi } from "vitest";

import type { NotificationMessage } from "@galaxy-farm/core";

import { generateVapidKeys } from "../src/vapid.js";
import { webPushNotifier, type PushSubscriptionRecord } from "../src/web-push.js";
import { decrypt, receiver } from "./receiver.js";

/**
 * The adapter (spec §6).
 *
 * The two behaviours worth the most here are the ones an issue would be filed
 * about a year from now: a revoked subscription being pruned rather than
 * retried forever, and one dead device not silencing the others.
 */

const CONFIG = { ...generateVapidKeys(), subject: "mailto:alerts@flyingdoublemranch.com" };

const PHONE = receiver("a".repeat(64), "0123456789abcdef");
const LAPTOP = receiver("c".repeat(64), "fedcba9876543210");

const phone: PushSubscriptionRecord = {
  endpoint: "https://fcm.googleapis.com/fcm/send/phone",
  keys: { p256dh: PHONE.p256dh, auth: PHONE.auth },
};
const laptop: PushSubscriptionRecord = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/laptop",
  keys: { p256dh: LAPTOP.p256dh, auth: LAPTOP.auth },
};

const message: NotificationMessage = {
  to: "sam@example.com",
  subject: "Tank freeze tonight",
  body: "Lows of 24°F. Break ice on the North Trap tank.",
  trigger: "tank_freeze_warning",
};

/** A push service that accepts everything, and remembers what it was sent. */
function acceptingService(status = 201) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status, headers: { location: `${String(url)}/message-1` } });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

/** Answers with whatever status each endpoint is mapped to. */
function servicePerEndpoint(statuses: Readonly<Record<string, number>>) {
  return vi.fn(async (url: string | URL | Request) => {
    const status = statuses[String(url)] ?? 201;
    return new Response(status >= 400 ? "no such subscription" : null, { status });
  }) as unknown as typeof globalThis.fetch;
}

function notifier(
  fetch: typeof globalThis.fetch,
  subscriptions: readonly PushSubscriptionRecord[],
  onGone = vi.fn(async () => {}),
) {
  return {
    onGone,
    send: webPushNotifier({
      config: CONFIG,
      subscriptions: async () => subscriptions,
      onGone,
      fetch,
      defaultUrl: "/admin",
      now: () => new Date("2026-11-05T12:00:00Z"),
    }),
  };
}

describe("webPushNotifier", () => {
  it("reaches every device a person subscribed", async () => {
    const service = acceptingService();
    await notifier(service.fetch, [phone, laptop]).send.send(message);

    expect(service.calls.map((call) => call.url)).toEqual([phone.endpoint, laptop.endpoint]);
  });

  it("sends a payload only that device can read", async () => {
    const service = acceptingService();
    await notifier(service.fetch, [phone]).send.send(message);

    const body = Buffer.from(service.calls[0]?.init.body as Uint8Array);
    expect(JSON.parse(decrypt(body, PHONE))).toEqual({
      title: message.subject,
      body: message.body,
      url: "/admin",
    });
  });

  it("encrypts per device, so one subscription's payload is unreadable by another", () => {
    // Belt and braces on the fan-out: the same words, two subscriptions, two
    // separate ECDH derivations.
    const service = acceptingService();

    return notifier(service.fetch, [phone, laptop])
      .send.send(message)
      .then(() => {
        const forPhone = Buffer.from(service.calls[0]?.init.body as Uint8Array);
        expect(() => decrypt(forPhone, LAPTOP)).toThrow();
      });
  });

  it("sends the headers a push service requires", async () => {
    const service = acceptingService();
    await notifier(service.fetch, [phone]).send.send(message);

    const headers = service.calls[0]?.init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["TTL"]).toBe(String(24 * 60 * 60));
    expect(headers["Authorization"]).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  });

  it("hands back the push service's own message URL as the receipt", async () => {
    const receipt = await notifier(acceptingService().fetch, [phone]).send.send(message);

    expect(receipt).toEqual({ id: `${phone.endpoint}/message-1` });
  });

  it("says nothing happened when nobody has subscribed a device", async () => {
    // The normal state for anybody who has not turned push on. Not a failure:
    // the caller asked for a notification, not for push.
    const service = acceptingService();
    const receipt = await notifier(service.fetch, []).send.send(message);

    expect(receipt).toEqual({});
    expect(service.calls).toEqual([]);
  });

  it("prunes a subscription the browser has revoked", async () => {
    // 410 Gone is what a push service says once permission is withdrawn, the
    // profile is wiped, or the app is uninstalled. Retried forever otherwise.
    const { onGone, send } = notifier(servicePerEndpoint({ [phone.endpoint]: 410 }), [phone]);

    await send.send(message);

    expect(onGone).toHaveBeenCalledWith(phone);
  });

  it("prunes on 404 as well, which is the other way a service says gone", async () => {
    const { onGone, send } = notifier(servicePerEndpoint({ [phone.endpoint]: 404 }), [phone]);

    await send.send(message);

    expect(onGone).toHaveBeenCalledWith(phone);
  });

  it("does not treat a pruned subscription as a failure", async () => {
    // Nothing arrived and nothing is wrong: the row is gone, and there is
    // nothing left to retry or to report to a person.
    const { send } = notifier(servicePerEndpoint({ [phone.endpoint]: 410 }), [phone]);

    await expect(send.send(message)).resolves.toEqual({});
  });

  it("keeps delivering to the devices that are still alive", async () => {
    // The failure this rules out: a stale phone silencing a laptop that works.
    const { onGone, send } = notifier(servicePerEndpoint({ [phone.endpoint]: 410 }), [
      phone,
      laptop,
    ]);

    await expect(send.send(message)).resolves.toEqual({});
    expect(onGone).toHaveBeenCalledOnce();
  });

  it("prunes nothing on a failure that is not a revocation", async () => {
    // A 500 or a 429 is the service having a bad day. Deleting the
    // subscription would turn a retryable minute into a device that never
    // hears anything again.
    const { onGone, send } = notifier(servicePerEndpoint({ [phone.endpoint]: 503 }), [phone]);

    await expect(send.send(message)).rejects.toThrow(/503/);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("throws only when every device failed, naming the service and its reason", async () => {
    const { send } = notifier(
      servicePerEndpoint({ [phone.endpoint]: 429, [laptop.endpoint]: 500 }),
      [phone, laptop],
    );

    await expect(send.send(message)).rejects.toThrow(
      /429 .*fcm\.googleapis\.com.*no such subscription.*500 .*mozilla\.com/s,
    );
  });

  it("survives a device that could not be reached at all", async () => {
    const { send } = notifier(
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }) as unknown as typeof globalThis.fetch,
      [phone],
    );

    await expect(send.send(message)).rejects.toThrow(/ENOTFOUND/);
  });

  it("defaults a tap to the app's root when no landing page is configured", async () => {
    const service = acceptingService();
    await webPushNotifier({
      config: CONFIG,
      subscriptions: async () => [phone],
      onGone: async () => {},
      fetch: service.fetch,
    }).send(message);

    const body = Buffer.from(service.calls[0]?.init.body as Uint8Array);
    expect(JSON.parse(decrypt(body, PHONE)).url).toBe("/");
  });

  it("accepts a 200 as readily as a 201 — services differ", async () => {
    await expect(
      notifier(acceptingService(200).fetch, [phone]).send.send(message),
    ).resolves.toEqual({ id: `${phone.endpoint}/message-1` });
  });
});
