import { describe, expect, it } from "vitest";

import {
  alertNotifier,
  emailConfig,
  emailNotifier,
  noChannelReason,
  pushConfig,
  pushNotifier,
} from "@/lib/notifier";

/**
 * The notification composition root (spec §4.1, §6).
 *
 * The env is passed in rather than mutated on `process.env`, which is the
 * whole reason these functions take a parameter: a test that sets a real
 * environment variable leaks into whatever runs next in the same worker.
 *
 * Nothing here sends anything. What is being checked is which channels exist
 * for a given environment — the wiring §6 turns into "web push later behind
 * the same port" — and the behaviour of each adapter is its own package's
 * problem.
 */

/** A structurally valid VAPID pair. Never used to sign anything here. */
const VAPID = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: Buffer.alloc(65, 4).toString("base64url"),
  VAPID_PRIVATE_KEY: Buffer.alloc(32, 7).toString("base64url"),
  VAPID_SUBJECT: "mailto:alerts@example.invalid",
};

describe("emailConfig", () => {
  it("reports what is missing rather than throwing", () => {
    // Email is not load-bearing. §6's calving watch still writes to the
    // calendar with no key set, so an unset variable has to degrade to a
    // sentence somebody can act on rather than take a screen down.
    const config = emailConfig({});

    expect(config.ok).toBe(false);
    if (config.ok) throw new Error("unreachable");
    expect(config.reason).toMatch(/RESEND_API_KEY/);
  });

  it("reads the key and sender out of the environment it is given", () => {
    expect(
      emailConfig({ RESEND_API_KEY: "re_live", EMAIL_FROM: "Farm <alerts@example.invalid>" }),
    ).toEqual({ ok: true, apiKey: "re_live", from: "Farm <alerts@example.invalid>" });
  });
});

describe("pushConfig", () => {
  it("reports what is missing rather than throwing, like email", () => {
    const config = pushConfig({});

    expect(config.ok).toBe(false);
    expect(config.ok ? "" : config.reason).toMatch(/VAPID_PRIVATE_KEY/);
  });

  it("reads a complete pair out of the environment it is given", () => {
    expect(pushConfig(VAPID).ok).toBe(true);
  });
});

describe("emailNotifier", () => {
  it("is nothing at all when email is not configured", () => {
    // Nothing rather than a recorder that silently swallows the send: a caller
    // has to be able to see there was nowhere to send it, and say so.
    expect(emailNotifier({})).toBeUndefined();
  });

  it("is a notifier once there is a key", () => {
    const send = emailNotifier({ RESEND_API_KEY: "re_live" });

    expect(send).toBeDefined();
    expect(typeof send?.send).toBe("function");
  });

  it("is email alone, even with push configured", () => {
    // The distinction the two functions exist for: an invitation link and the
    // Test email button are email features, and pushing either to a phone
    // would be nonsense — the invited person may have no account yet.
    expect(emailNotifier(VAPID)).toBeUndefined();
  });

  it("does not read the ambient environment when handed one", () => {
    // The guarantee that makes every test above safe to run in any order.
    const before = process.env["RESEND_API_KEY"];
    process.env["RESEND_API_KEY"] = "re_ambient";
    try {
      expect(emailNotifier({})).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env["RESEND_API_KEY"];
      else process.env["RESEND_API_KEY"] = before;
    }
  });
});

describe("pushNotifier", () => {
  it("is nothing at all without a VAPID pair", () => {
    expect(pushNotifier({ RESEND_API_KEY: "re_live" })).toBeUndefined();
  });

  it("is a notifier once there is one", () => {
    expect(typeof pushNotifier(VAPID)?.send).toBe("function");
  });
});

describe("alertNotifier", () => {
  it("is nothing when no channel is configured at all", () => {
    expect(alertNotifier({})).toBeUndefined();
  });

  it("exists on either channel alone", () => {
    // §6's degradation, both ways round: a farm with only email keeps working
    // exactly as it did, and a farm with only push still gets its alerts.
    expect(alertNotifier({ RESEND_API_KEY: "re_live" })).toBeDefined();
    expect(alertNotifier(VAPID)).toBeDefined();
  });

  it("is one notifier when both are configured, not two", () => {
    // The property that keeps callers unchanged: they hold a `Notifier` and
    // call `send` once, whether that reaches one channel or both.
    const send = alertNotifier({ ...VAPID, RESEND_API_KEY: "re_live" });

    expect(typeof send?.send).toBe("function");
  });
});

describe("noChannelReason", () => {
  it("names both channels when neither is set up", () => {
    // "Email is not configured" on a screen where push is also unset sends
    // somebody to fix half the problem.
    const reason = noChannelReason({});

    expect(reason).toMatch(/RESEND_API_KEY/);
    expect(reason).toMatch(/VAPID_PRIVATE_KEY/);
  });

  it("says nothing when either channel works", () => {
    expect(noChannelReason({ RESEND_API_KEY: "re_live" })).toBeUndefined();
    expect(noChannelReason(VAPID)).toBeUndefined();
  });
});
