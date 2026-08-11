import { describe, expect, it, vi } from "vitest";

import { recordingNotifier, resendNotifier } from "../src/index.js";

/**
 * Resend, behind the kernel's `Notifier` port (spec §3, §6).
 *
 * §6: "email now (Resend), web push later behind the same `Notifier` port".
 * Nothing that sends a notification learns which of the two it got, which is
 * the property these tests are really about.
 */

const OPTIONS = { apiKey: "re_test", from: "Galaxy Farm <alerts@example.invalid>" };
const message = { to: "somebody@example.invalid", subject: "Calving watch", body: "Day 279." };

describe("resendNotifier", () => {
  it("posts the message with the configured sender", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }) as Response);

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message);

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      from: OPTIONS.from,
      to: ["somebody@example.invalid"],
      subject: "Calving watch",
      text: "Day 279.",
    });
  });

  it("authenticates with the key", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }) as Response);

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message);

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_test");
  });

  it("surfaces the provider's own reason for a failure", async () => {
    // Most failures here are an unverified sender domain, and "422" on its own
    // sends somebody looking in the wrong place.
    const fetcher = vi.fn(
      async () =>
        ({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          text: async () => "The from address is not verified",
        }) as Response,
    );

    await expect(
      resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message),
    ).rejects.toThrow(/not verified/);
  });

  it("still throws when the body cannot be read", async () => {
    const fetcher = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          statusText: "Server Error",
          text: async () => {
            throw new Error("connection reset");
          },
        }) as unknown as Response,
    );

    await expect(
      resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message),
    ).rejects.toThrow(/500/);
  });
});

describe("recordingNotifier", () => {
  it("keeps what it would have sent", async () => {
    // Useful in development for real: the app runs with notifications going
    // nowhere and you can still see what it tried to send.
    const notifier = recordingNotifier();

    await notifier.send(message);

    expect(notifier.sent).toEqual([message]);
  });
});
