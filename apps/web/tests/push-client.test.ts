import { describe, expect, it, vi } from "vitest";

import {
  applicationServerKey,
  currentEndpoint,
  deviceLabelFor,
  keysOf,
  pushSupported,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "../lib/push-client.js";

/**
 * The browser's half of subscribing (spec §6).
 *
 * A test environment has no `PushManager`, so the parts that touch one are
 * driven through the seams `push-client.ts` exposes for the purpose. What is
 * being checked is the decisions — asked for permission, refused politely,
 * cleaned up after a subscription that cannot be encrypted to — rather than
 * the browser's own API doing its job.
 */

const PUBLIC_KEY = Buffer.alloc(65, 4).toString("base64url");
const P256DH = Buffer.alloc(65, 9).toString("base64url");
const AUTH = Buffer.from("0123456789abcdef").toString("base64url");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/phone";

/** `null` means a browser that subscribed without handing its keys over. */
function subscription(keys: Record<string, string> | null = { p256dh: P256DH, auth: AUTH }) {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, ...(keys === null ? {} : { keys }) }),
    unsubscribe: vi.fn(async () => true),
  };
}

function registration(subscribed: ReturnType<typeof subscription> | null) {
  const subscribe = vi.fn(
    async (_options: PushSubscriptionOptionsInit) => subscribed ?? subscription(),
  );
  return {
    registration: {
      pushManager: {
        subscribe,
        getSubscription: async () => subscribed,
      },
    } as unknown as ServiceWorkerRegistration,
    subscribe,
  };
}

describe("applicationServerKey", () => {
  it("decodes the base64url key the API wants as bytes", () => {
    const bytes = applicationServerKey(PUBLIC_KEY);

    expect(bytes).toHaveLength(65);
    expect([...bytes.slice(0, 3)]).toEqual([4, 4, 4]);
  });

  it("handles a key whose length needs padding restored", () => {
    // base64url drops the "=" padding, and `atob` insists on it. This is the
    // wart every web push implementation carries a copy of.
    expect(applicationServerKey(Buffer.from("abc").toString("base64url"))).toHaveLength(3);
    expect(applicationServerKey(Buffer.from("abcd").toString("base64url"))).toHaveLength(4);
  });
});

describe("deviceLabelFor", () => {
  it("tells the phone from the laptop from the tablet", () => {
    expect(deviceLabelFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("iPhone");
    expect(deviceLabelFor("Mozilla/5.0 (iPad; CPU OS 18_0)")).toBe("iPad");
    expect(deviceLabelFor("Mozilla/5.0 (Linux; Android 15; Pixel) Mobile")).toBe("Android phone");
    expect(deviceLabelFor("Mozilla/5.0 (Linux; Android 15; Tab)")).toBe("Android tablet");
    expect(deviceLabelFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("Mac");
    expect(deviceLabelFor("Mozilla/5.0 (Windows NT 10.0; Win64)")).toBe("Windows PC");
    expect(deviceLabelFor("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux PC");
  });

  it("says something rather than nothing for a browser it does not recognise", () => {
    // The label is what a person picks a device to revoke by, so a blank is
    // worse than a guess.
    expect(deviceLabelFor("")).toBe("This device");
  });
});

describe("pushSupported", () => {
  it("needs all three of the APIs this depends on", () => {
    const full = { Notification: {}, PushManager: {}, navigator: { serviceWorker: {} } };

    expect(pushSupported(full)).toBe(true);
    expect(pushSupported({ ...full, PushManager: undefined })).toBe(false);
    expect(pushSupported({ ...full, Notification: undefined })).toBe(false);
    expect(pushSupported({ ...full, navigator: {} })).toBe(false);
    expect(pushSupported({})).toBe(false);
  });
});

describe("keysOf", () => {
  it("reads both keys off a subscription", () => {
    expect(keysOf(subscription())).toEqual({ p256dh: P256DH, auth: AUTH });
  });

  it("is nothing when either is missing", () => {
    expect(keysOf(subscription(null))).toBeUndefined();
    expect(keysOf(subscription({ p256dh: P256DH }))).toBeUndefined();
    expect(keysOf(subscription({ auth: AUTH }))).toBeUndefined();
  });
});

describe("subscribeThisDevice", () => {
  const browser = (permission: NotificationPermission, registered = registration(null)) => ({
    requestPermission: vi.fn(async () => permission),
    registration: async () => registered.registration,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
  });

  it("subscribes once permission is granted, and labels the device", async () => {
    const result = await subscribeThisDevice(PUBLIC_KEY, browser("granted"));

    expect(result).toEqual({
      ok: true,
      payload: { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, deviceLabel: "iPhone" },
    });
  });

  it("asks for permission every time, never assuming a previous answer", async () => {
    const asking = browser("granted");
    await subscribeThisDevice(PUBLIC_KEY, asking);

    expect(asking.requestPermission).toHaveBeenCalledOnce();
  });

  it("explains a denial, because the browser will not ask again", async () => {
    const result = await subscribeThisDevice(PUBLIC_KEY, browser("denied"));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/site settings/);
  });

  it("says nothing happened when the prompt was dismissed", async () => {
    const result = await subscribeThisDevice(PUBLIC_KEY, browser("default"));

    expect(result).toEqual({ ok: false, reason: "Notifications were not turned on." });
  });

  it("throws away a subscription with no keys rather than storing it", async () => {
    // Nothing could ever be encrypted to it, so a stored row would fail on
    // every send forever.
    const keyless = subscription(null);
    const result = await subscribeThisDevice(PUBLIC_KEY, browser("granted", registration(keyless)));

    expect(result.ok).toBe(false);
    expect(keyless.unsubscribe).toHaveBeenCalledOnce();
  });

  it("hands the push manager the key as bytes, and insists on a visible notification", async () => {
    const registered = registration(null);
    await subscribeThisDevice(PUBLIC_KEY, browser("granted", registered));

    const options = registered.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect(options?.applicationServerKey).toHaveLength(65);
  });
});

describe("unsubscribeThisDevice", () => {
  it("reads the endpoint before dropping it, so the row can be deleted", async () => {
    // Afterwards the subscription object is dead and the row would be
    // orphaned — which is exactly the state that has a push service
    // answering 410 to every future send.
    const existing = subscription();
    const dropped = await unsubscribeThisDevice(registration(existing).registration);

    expect(dropped).toBe(ENDPOINT);
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
  });

  it("is nothing to do when this browser was not subscribed", async () => {
    expect(await unsubscribeThisDevice(registration(null).registration)).toBeUndefined();
  });
});

describe("currentEndpoint", () => {
  it("reports what this browser already holds", async () => {
    expect(await currentEndpoint(registration(subscription()).registration)).toBe(ENDPOINT);
  });

  it("reports nothing when it holds nothing", async () => {
    expect(await currentEndpoint(registration(null).registration)).toBeUndefined();
  });
});
