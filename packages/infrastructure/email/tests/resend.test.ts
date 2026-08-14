import { describe, expect, it, vi } from "vitest";

import {
  recordingNotifier,
  resendNotifier,
  resolveEmailConfig,
  senderAddress,
  SHARED_SENDER,
} from "../src/index.js";

/**
 * Resend, behind the kernel's `Notifier` port (spec §3, §6).
 *
 * §6: "email now (Resend), web push later behind the same `Notifier` port".
 * Nothing that sends a notification learns which of the two it got, which is
 * the property these tests are really about.
 */

const OPTIONS = { apiKey: "re_test", from: "Flying Double M <alerts@example.invalid>" };
const message = { to: "somebody@example.invalid", subject: "Calving watch", body: "Day 279." };

/** An accepted send, with Resend's id in the body the way the real one sends it. */
function accepted(id = "b1c2d3e4") {
  return vi.fn(
    async () => ({ ok: true, status: 200, json: async () => ({ id }) }) as unknown as Response,
  );
}

/**
 * The first call's arguments.
 *
 * Cast because `vi.fn(async () => …)` infers a zero-argument signature, so
 * `mock.calls` is typed as a tuple of length nought. The stub genuinely is
 * called with two arguments; only the inference disagrees.
 */
function calledWith(fetcher: ReturnType<typeof accepted>): [string, RequestInit] {
  return fetcher.mock.calls[0] as unknown as [string, RequestInit];
}

function bodyOf(fetcher: ReturnType<typeof accepted>): Record<string, unknown> {
  const [, init] = calledWith(fetcher);
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("resendNotifier", () => {
  it("posts the message with the configured sender", async () => {
    const fetcher = accepted();

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message);

    expect(bodyOf(fetcher)).toEqual({
      from: OPTIONS.from,
      to: ["somebody@example.invalid"],
      subject: "Calving watch",
      text: "Day 279.",
    });
  });

  it("authenticates with the key", async () => {
    const fetcher = accepted();

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message);

    const [, init] = calledWith(fetcher);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_test");
  });

  it("sends the HTML part alongside the text when there is one", async () => {
    const fetcher = accepted();

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send({
      ...message,
      html: "<p>Day 279.</p>",
      replyTo: "owner@example.invalid",
    });

    const body = bodyOf(fetcher);
    expect(body["html"]).toBe("<p>Day 279.</p>");
    // Resend spells it with an underscore; the port spells it the way the rest
    // of the codebase does. The mapping is this adapter's job.
    expect(body["reply_to"]).toBe("owner@example.invalid");
    expect(body["text"]).toBe("Day 279.");
  });

  it("omits the HTML key entirely rather than sending an empty one", async () => {
    // A present-but-empty html part renders as a blank email in every client
    // that prefers HTML, which is a worse outcome than not offering one.
    const fetcher = accepted();

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message);

    expect(bodyOf(fetcher)).not.toHaveProperty("html");
    expect(bodyOf(fetcher)).not.toHaveProperty("reply_to");
  });

  it("hands back the provider's id for the message", async () => {
    // The difference between "we sent it" and "it arrived" is a question only
    // Resend's log can answer, and this id is how it is asked.
    const receipt = await resendNotifier({ ...OPTIONS, fetch: accepted("abc123") as never }).send(
      message,
    );

    expect(receipt.id).toBe("abc123");
  });

  it("treats an unreadable success as a success with no id", async () => {
    // A 200 whose body will not parse is still a message Resend accepted.
    // Throwing here would turn a delivered email into a reported failure, and
    // a reported failure is what has somebody send it a second time.
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("unexpected end of JSON input");
          },
        }) as unknown as Response,
    );

    await expect(
      resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message),
    ).resolves.toEqual({});
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

  it("posts to Resend's own endpoint unless told otherwise", async () => {
    const fetcher = accepted();

    await resendNotifier({ ...OPTIONS, fetch: fetcher as never }).send(message);
    expect(calledWith(fetcher)[0]).toBe("https://api.resend.com/emails");

    const local = accepted();
    await resendNotifier({
      ...OPTIONS,
      endpoint: "http://localhost:9999/emails",
      fetch: local as never,
    }).send(message);
    expect(calledWith(local)[0]).toBe("http://localhost:9999/emails");
  });
});

describe("recordingNotifier", () => {
  it("keeps what it would have sent", async () => {
    // Useful in development for real: the app runs with notifications going
    // nowhere and you can still see what it tried to send.
    const notifier = recordingNotifier();

    await notifier.send(message);

    expect(notifier.sent).toEqual([{ ...message, html: undefined, replyTo: undefined }]);
  });

  it("answers with a receipt, so a caller that reports an id has one", async () => {
    const notifier = recordingNotifier();

    expect(await notifier.send(message)).toEqual({ id: "recorded-1" });
    expect(await notifier.send(message)).toEqual({ id: "recorded-2" });
  });
});

describe("resolveEmailConfig", () => {
  it("refuses, with somewhere to go, when there is no key", () => {
    const config = resolveEmailConfig({});

    expect(config.ok).toBe(false);
    if (config.ok) throw new Error("unreachable");
    // Both places the key has to be set, named. The variable on its own sends
    // somebody to .env.local and leaves the deployed site still broken.
    expect(config.reason).toMatch(/RESEND_API_KEY/);
    expect(config.reason).toMatch(/Netlify/);
  });

  it("treats whitespace as unset", () => {
    // A pasted-in variable with a trailing newline is otherwise a key that
    // fails authentication for reasons nothing on screen would explain.
    expect(resolveEmailConfig({ RESEND_API_KEY: "   " }).ok).toBe(false);
  });

  it("falls back to Resend's shared sender, and says what that costs", () => {
    const config = resolveEmailConfig({ RESEND_API_KEY: "re_live" });

    expect(config).toMatchObject({ ok: true, apiKey: "re_live", from: SHARED_SENDER });
    if (!config.ok) throw new Error("unreachable");
    // The send will succeed and the mail will not arrive. That has to be said
    // where somebody reads it, not discovered from an empty inbox.
    expect(config.limitation).toMatch(/only delivers to the address/);
  });

  it("uses a configured sender with no caveat", () => {
    const config = resolveEmailConfig({
      RESEND_API_KEY: "re_live",
      EMAIL_FROM: "Flying Double M <alerts@flyingdoublem.com>",
    });

    expect(config).toEqual({
      ok: true,
      apiKey: "re_live",
      from: "Flying Double M <alerts@flyingdoublem.com>",
    });
  });

  it("still warns when the shared sender is dressed up with a display name", () => {
    // `Galaxy Farm <onboarding@resend.dev>` is the same restricted address as
    // the bare form, and losing the warning to a display name is exactly the
    // sort of thing that goes unnoticed until an alert does not arrive.
    const config = resolveEmailConfig({
      RESEND_API_KEY: "re_live",
      EMAIL_FROM: `Galaxy Farm <${SHARED_SENDER.toUpperCase()}>`,
    });

    expect(config.ok).toBe(true);
    if (!config.ok) throw new Error("unreachable");
    expect(config.limitation).toMatch(/shared sender/);
  });
});

describe("senderAddress", () => {
  it("reads the address out of either spelling", () => {
    expect(senderAddress("alerts@example.invalid")).toBe("alerts@example.invalid");
    expect(senderAddress("Flying Double M <Alerts@Example.Invalid>")).toBe(
      "alerts@example.invalid",
    );
  });
});
