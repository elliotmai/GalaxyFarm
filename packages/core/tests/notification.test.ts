import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEAD_DAYS,
  NOTIFICATION_TRIGGERS,
  deliveryChannels,
  dueNotifications,
  notificationSettingSchema,
  settingFor,
  unsent,
  type NotificationSetting,
  type PendingNotification,
} from "../src/entities/notification.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Notification settings (spec §5.1, §6).
 *
 * §6 asks for "per-trigger opt-out and lead-time settings". The reason that is
 * not a nicety: a farm app that cannot be told to stop mentioning something is
 * one whose mail gets filtered to a folder, and at that point all twenty-two
 * triggers are lost including the calving watch.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-11-05T12:00:00Z");

const candidate = (over: Partial<PendingNotification> = {}): PendingNotification => ({
  trigger: "calving_window_opening",
  key: "calving_window_opening:breedingRecord:1",
  subject: "Andromeda's calving window opens soon",
  body: "Due 24 November.",
  dueOn: new Date("2026-11-10T00:00:00Z"),
  ...over,
});

const setting = (over: Partial<NotificationSetting> = {}): NotificationSetting => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  trigger: "calving_window_opening",
  channel: "email",
  leadDays: 7,
  enabled: true,
  ...over,
});

describe("the trigger list", () => {
  it("carries all twenty-two of §6's default triggers", () => {
    expect(NOTIFICATION_TRIGGERS).toHaveLength(22);
  });

  it("gives every one a default lead time", () => {
    const missing = NOTIFICATION_TRIGGERS.filter(
      (trigger) => DEFAULT_LEAD_DAYS[trigger] === undefined,
    );
    expect(missing).toEqual([]);
  });
});

describe("dueNotifications", () => {
  it("fires once the lead time is reached", () => {
    // Seven days ahead of a window opening on the 10th.
    expect(dueNotifications([candidate()], [setting()], AT)).toHaveLength(1);
  });

  it("stays quiet before the lead time", () => {
    expect(dueNotifications([candidate()], [setting()], new Date("2026-10-20"))).toEqual([]);
  });

  it("uses the default lead time when nothing is configured", () => {
    // Opting out has to be deliberate: a trigger that silently defaulted to off
    // would be one nobody knows they are missing.
    expect(dueNotifications([candidate()], [], AT)).toHaveLength(1);
  });

  it("honours a per-trigger opt-out", () => {
    expect(dueNotifications([candidate()], [setting({ enabled: false })], AT)).toEqual([]);
    expect(dueNotifications([candidate()], [setting({ channel: "none" })], AT)).toEqual([]);
  });

  it("honours a longer lead time", () => {
    const early = dueNotifications(
      [candidate()],
      [setting({ leadDays: 30 })],
      new Date("2026-10-20"),
    );
    expect(early).toHaveLength(1);
  });

  it("prefers a per-user setting to the property default", () => {
    // Two people want different amounts of noise.
    const settings = [setting(), setting({ id: id(2), userId: id(9), enabled: false })];

    expect(dueNotifications([candidate()], settings, AT, id(9))).toEqual([]);
    expect(dueNotifications([candidate()], settings, AT, id(8))).toHaveLength(1);
  });

  it("orders by due date, soonest first", () => {
    const later = candidate({ key: "b", dueOn: new Date("2026-11-11T00:00:00Z") });
    const sooner = candidate({ key: "a", dueOn: new Date("2026-11-08T00:00:00Z") });

    expect(dueNotifications([later, sooner], [], AT).map((n) => n.key)).toEqual(["a", "b"]);
  });

  it("holds back one whose lead time has not arrived, even beside one that has", () => {
    // The list is a queue of things to act on now, not a preview of the month.
    const distant = candidate({ key: "b", dueOn: new Date("2026-12-20T00:00:00Z") });

    expect(dueNotifications([distant, candidate()], [], AT).map((n) => n.key)).toEqual([
      candidate().key,
    ]);
  });
});

describe("settingFor", () => {
  it("falls back to the property setting when the user has none", () => {
    expect(settingFor([setting()], "calving_window_opening", id(9))?.leadDays).toBe(7);
  });

  it("says nothing about a trigger nobody has configured", () => {
    expect(settingFor([setting()], "frost_warning")).toBeUndefined();
  });
});

describe("unsent", () => {
  it("keeps a stable key, so two devices do not both send the same alert", () => {
    const due = dueNotifications([candidate()], [], AT);
    expect(unsent(due, new Set([candidate().key]))).toEqual([]);
    expect(unsent(due, new Set())).toHaveLength(1);
  });
});

describe("notificationSettingSchema", () => {
  it("accepts a setting", () => {
    expect(notificationSettingSchema.safeParse(setting()).success).toBe(true);
  });

  it("refuses a negative lead time", () => {
    expect(notificationSettingSchema.safeParse(setting({ leadDays: -1 })).success).toBe(false);
  });
});

describe("deliveryChannels", () => {
  it("uses every channel for a trigger nobody has configured", () => {
    expect(deliveryChannels([], "calving_watch")).toEqual(["email", "push"]);
  });

  it("uses every channel for a message that is not one of §6's triggers", () => {
    // An invitation. Nobody has a preference about it, so nothing suppresses it.
    expect(deliveryChannels([setting({ channel: "none" })], undefined)).toEqual(["email", "push"]);
  });

  it("routes to exactly the channel the setting names", () => {
    expect(deliveryChannels([setting({ channel: "email" })], "calving_window_opening")).toEqual([
      "email",
    ]);
    expect(deliveryChannels([setting({ channel: "push" })], "calving_window_opening")).toEqual([
      "push",
    ]);
    expect(deliveryChannels([setting({ channel: "both" })], "calving_window_opening")).toEqual([
      "email",
      "push",
    ]);
  });

  it("delivers a switched-off trigger nowhere at all", () => {
    // The §6 promise that push has to keep: something turned off must not
    // arrive by the second route just because a second route now exists.
    expect(deliveryChannels([setting({ channel: "none" })], "calving_window_opening")).toEqual([]);
    expect(deliveryChannels([setting({ enabled: false })], "calving_window_opening")).toEqual([]);
    expect(
      deliveryChannels([setting({ enabled: false, channel: "push" })], "calving_window_opening"),
    ).toEqual([]);
  });

  it("prefers a person's own setting over the property-wide one", () => {
    const settings = [
      setting({ channel: "none" }),
      setting({ id: id(2), channel: "push", userId: id(8) }),
    ];

    expect(deliveryChannels(settings, "calving_window_opening", id(8))).toEqual(["push"]);
    expect(deliveryChannels(settings, "calving_window_opening", id(9))).toEqual([]);
  });

  it("says nothing about a trigger the settings do not mention", () => {
    expect(deliveryChannels([setting({ channel: "none" })], "frost_warning")).toEqual([
      "email",
      "push",
    ]);
  });
});
