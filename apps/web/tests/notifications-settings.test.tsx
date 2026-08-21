import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_TRIGGERS, type NotificationSetting, type Ulid } from "@galaxy-farm/core";

/**
 * The Notifications tab (spec §6, §7 `/admin/settings`).
 *
 * Two things are asserted, and the second is the one that matters. The screen
 * renders every one of §6's twenty-two triggers, including the ones whose
 * module is not built yet — a preference somebody cannot find is a preference
 * they do not have. And choosing "Off" writes that choice, because the whole
 * §6 promise rests on the choice reaching the row the router reads.
 *
 * The subscribe button is deliberately not driven here: a jsdom has no
 * `PushManager`, and what it would test is the browser's API rather than any
 * decision this app makes. Those decisions live in `push-client.ts` and are
 * tested there.
 */

const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

const actions = vi.hoisted(() => ({
  channels: [] as { trigger: string; channel: string }[],
  revoked: [] as string[],
  tested: 0,
}));

vi.mock("@/app/(admin)/admin/settings/_components/notification-actions", () => ({
  subscribeDevice: async () => ({ ok: true, message: "" }),
  unsubscribeDevice: async () => ({ ok: true, message: "" }),
  identifyDevice: async () => undefined,
  revokeDevice: async (id: string) => {
    actions.revoked.push(id);
    return { ok: true, message: "Off." };
  },
  sendTestNotification: async () => {
    actions.tested += 1;
    return { ok: true, message: "Sent." };
  },
  setTriggerChannel: async (trigger: string, channel: string) => {
    actions.channels.push({ trigger, channel });
    return { ok: true, message: "Saved." };
  },
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { NotificationsScreen } =
  await import("../app/(admin)/admin/settings/_components/notifications-screen.js");

const setting = (over: Partial<NotificationSetting>): NotificationSetting =>
  ({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FS1" as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    trigger: "calving_watch",
    channel: "both",
    leadDays: 0,
    enabled: true,
    userId: ACTOR,
    ...over,
  }) as NotificationSetting;

const DEVICE = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FD1" as Ulid,
  deviceLabel: "iPhone",
  createdAt: new Date("2026-06-01"),
};

function screenWith(
  props: Partial<Parameters<typeof NotificationsScreen>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <NotificationsScreen
          actorId={ACTOR}
          devices={[]}
          settings={[]}
          publicKey="a-public-key"
          {...props}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  actions.channels.length = 0;
  actions.revoked.length = 0;
  actions.tested = 0;
});

describe("what a person is told about", () => {
  it("offers a choice for every one of §6's triggers", () => {
    // Including the ones whose module is Phase 5. A trigger with no control is
    // one nobody can switch off, and §6 asks for per-trigger opt-out.
    screenWith();

    expect(screen.getAllByRole("combobox")).toHaveLength(NOTIFICATION_TRIGGERS.length);
  });

  it("shows both channels as the default for a trigger nobody has configured", () => {
    screenWith();

    expect(screen.getByLabelText(/how calving watch arrives/i)).toHaveValue("both");
  });

  it("shows the choice somebody already made", () => {
    screenWith({ settings: [setting({ channel: "push" })] });

    expect(screen.getByLabelText(/how calving watch arrives/i)).toHaveValue("push");
  });

  it("records switching a trigger off", async () => {
    // The choice the §6 promise rests on: this is the row `preferenceRouter`
    // reads before either channel is offered the message.
    screenWith();

    await userEvent.selectOptions(screen.getByLabelText(/how frost warning arrives/i), "none");

    await waitFor(() =>
      expect(actions.channels).toEqual([{ trigger: "frost_warning", channel: "none" }]),
    );
  });

  it("says how far ahead each one is sent", () => {
    screenWith({ settings: [setting({ trigger: "med_expiring", leadDays: 45 })] });

    expect(screen.getByText("Sent 45 days ahead.")).toBeInTheDocument();
  });
});

describe("the devices list", () => {
  it("says plainly that nothing is being pushed anywhere", () => {
    screenWith();

    expect(screen.getByText(/no devices yet/i)).toBeInTheDocument();
  });

  it("confirms before silencing a device, and names it (§4.5 clause 3)", async () => {
    screenWith({ devices: [DEVICE] });

    await userEvent.click(screen.getAllByRole("button", { name: "Turn off" })[0] as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/iPhone/)).toBeInTheDocument();
    expect(actions.revoked).toEqual([]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(actions.revoked).toEqual([DEVICE.id]));
  });

  it("leaves the device alone when the dialog is cancelled", async () => {
    screenWith({ devices: [DEVICE] });

    await userEvent.click(screen.getAllByRole("button", { name: "Turn off" })[0] as HTMLElement);
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(actions.revoked).toEqual([]);
  });
});

describe("proving it actually arrives", () => {
  it("offers a test send once there is a device to send to", async () => {
    // "It is configured" and "it arrives" are different claims, and the gap
    // between them is a browser permission this side cannot see.
    screenWith({ devices: [DEVICE] });

    await userEvent.click(screen.getByRole("button", { name: /send a test/i }));

    await waitFor(() => expect(actions.tested).toBe(1));
  });

  it("does not offer one when nothing is subscribed", () => {
    screenWith();

    expect(screen.getByRole("button", { name: /send a test/i })).toBeDisabled();
  });
});

describe("when push is not set up", () => {
  it("says so, and names what to set rather than failing silently", () => {
    screenWith({ publicKey: undefined, pushUnavailable: "VAPID_PRIVATE_KEY is not set." });

    expect(screen.getByText(/not set up for this farm/i)).toBeInTheDocument();
    expect(screen.getByText(/VAPID_PRIVATE_KEY is not set\./)).toBeInTheDocument();
  });

  it("still offers the preferences, because email is still going out", () => {
    screenWith({ publicKey: undefined, pushUnavailable: "VAPID_PRIVATE_KEY is not set." });

    expect(screen.getAllByRole("combobox")).toHaveLength(NOTIFICATION_TRIGGERS.length);
  });
});
