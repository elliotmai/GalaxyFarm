import { describe, expect, it, vi } from "vitest";

import { compositeNotifier, everyChannel } from "../src/ports/composite-notifier.js";
import type { NotificationMessage, Notifier } from "../src/ports/index.js";

/**
 * One port, two channels (spec §6).
 *
 * The tests that matter here are the two that describe promises rather than
 * plumbing: a preference switched off reaches neither channel, and one channel
 * failing does not turn a delivered notification into a reported failure.
 */

const message = (over: Partial<NotificationMessage> = {}): NotificationMessage => ({
  to: "sam@example.com",
  subject: "Andromeda's calving window opens soon",
  body: "Due 24 November.",
  ...over,
});

/** A notifier that records, and can be told to fail. */
function fake(id: string, fails = false): Notifier & { readonly sent: NotificationMessage[] } {
  const sent: NotificationMessage[] = [];
  return {
    sent,
    async send(input) {
      if (fails) throw new Error(`${id} is unreachable`);
      sent.push(input);
      return { id };
    },
  };
}

describe("compositeNotifier", () => {
  it("sends on every configured channel by default", async () => {
    const email = fake("email-1");
    const push = fake("push-1");

    await compositeNotifier({ email, push }).send(message());

    expect(email.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });

  it("returns the email receipt, which is the one a provider's log answers to", async () => {
    const receipt = await compositeNotifier({ email: fake("email-1"), push: fake("push-1") }).send(
      message(),
    );

    expect(receipt).toEqual({ id: "email-1" });
  });

  it("sends on a configured channel even when it is the only one", async () => {
    const push = fake("push-1");
    const receipt = await compositeNotifier({ push }).send(message());

    expect(push.sent).toHaveLength(1);
    expect(receipt).toEqual({ id: "push-1" });
  });

  it("does not reach a channel the router has ruled out", async () => {
    // The §6 promise, at the seam that could break it. A trigger somebody
    // turned off for push must not arrive on a phone merely because push is
    // configured property-wide.
    const email = fake("email-1");
    const push = fake("push-1");

    await compositeNotifier({ email, push }, () => ["email"]).send(
      message({ trigger: "calving_watch" }),
    );

    expect(email.sent).toHaveLength(1);
    expect(push.sent).toEqual([]);
  });

  it("does nothing, successfully, when the router allows no channel at all", async () => {
    const email = fake("email-1");
    const push = fake("push-1");

    const receipt = await compositeNotifier({ email, push }, () => []).send(
      message({ trigger: "chore_overdue" }),
    );

    expect(receipt).toEqual({});
    expect(email.sent).toEqual([]);
    expect(push.sent).toEqual([]);
  });

  it("awaits a router that has to read the settings", async () => {
    const push = fake("push-1");
    const route = vi.fn(async () => ["push"] as const);

    await compositeNotifier({ email: fake("email-1"), push }, route).send(message());

    expect(route).toHaveBeenCalledOnce();
    expect(push.sent).toHaveLength(1);
  });

  it("counts a send as delivered when one channel worked", async () => {
    // Push being unreachable while the email went is not a failure worth
    // showing somebody: they have the message.
    const push = fake("push-1");
    const receipt = await compositeNotifier({ email: fake("email-1", true), push }).send(message());

    expect(receipt).toEqual({ id: "push-1" });
    expect(push.sent).toHaveLength(1);
  });

  it("throws only when every channel failed, and names each one", async () => {
    const send = compositeNotifier({
      email: fake("email-1", true),
      push: fake("push-1", true),
    }).send(message());

    await expect(send).rejects.toThrow(
      /email: email-1 is unreachable.*push: push-1 is unreachable/,
    );
  });

  it("survives a channel that throws something that is not an Error", async () => {
    const thrower: Notifier = {
      send: () => Promise.reject("no route to host"),
    };

    await expect(compositeNotifier({ push: thrower }).send(message())).rejects.toThrow(
      /no route to host/,
    );
  });

  it("is a no-op with nothing configured", async () => {
    expect(await compositeNotifier({}).send(message())).toEqual({});
  });
});

describe("everyChannel", () => {
  it("is the §6 default — a message with no preference goes everywhere", () => {
    expect(everyChannel(message())).toEqual(["email", "push"]);
    expect(everyChannel(message({ trigger: "frost_warning" }))).toEqual(["email", "push"]);
  });
});
