import { describe, expect, it } from "vitest";

import { emailConfig, notifier } from "@/lib/notifier";

/**
 * Email's corner of the composition root (spec §4.1, §6).
 *
 * The env is passed in rather than mutated on `process.env`, which is the
 * whole reason these two functions take a parameter: a test that sets a real
 * environment variable leaks into whatever runs next in the same worker.
 */

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

describe("notifier", () => {
  it("is nothing at all when email is not configured", () => {
    // Nothing rather than a recorder that silently swallows the send: a caller
    // has to be able to see there was nowhere to send it, and say so.
    expect(notifier({})).toBeUndefined();
  });

  it("is a notifier once there is a key", () => {
    const send = notifier({ RESEND_API_KEY: "re_live" });

    expect(send).toBeDefined();
    expect(typeof send?.send).toBe("function");
  });

  it("does not read the ambient environment when handed one", () => {
    // The guarantee that makes every test above safe to run in any order.
    const before = process.env["RESEND_API_KEY"];
    process.env["RESEND_API_KEY"] = "re_ambient";
    try {
      expect(notifier({})).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env["RESEND_API_KEY"];
      else process.env["RESEND_API_KEY"] = before;
    }
  });
});
