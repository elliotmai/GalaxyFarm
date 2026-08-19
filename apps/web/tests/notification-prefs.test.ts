import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  compositeNotifier,
  type NotificationMessage,
  type Notifier,
  type Ulid,
} from "@galaxy-farm/core";
import { users, type Database } from "@galaxy-farm/infra-db";

import { preferenceRouter, saveSetting, settingsFor } from "../lib/notification-prefs.js";
import { saveSubscription } from "../lib/push-store.js";

/**
 * The §6 preference model, and the promise push had to keep (spec §6).
 *
 * The suite below is mostly one assertion said several ways, because it is the
 * one that would matter a year from now: **a notification somebody switched
 * off must not arrive by the channel that did not exist when they switched it
 * off.** Everything else here is the plumbing that makes that answerable.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const SAM = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const ALEX = "01ARZ3NDEKTSV4RRFFQ69G5FU2" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");
const LATER = new Date("2026-06-15T12:05:00Z");

let client: PGlite;
let db: Database;

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await client.exec(statement);
    }
  }
  db = drizzle(client) as unknown as Database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("truncate table notification_settings");
  await client.exec("truncate table push_subscriptions");
  await client.exec("truncate table users");

  await db.insert(users).values([
    {
      id: SAM,
      propertyId: PROPERTY,
      createdAt: NOW,
      updatedAt: NOW,
      name: "Sam",
      email: "sam@example.invalid",
      role: "owner",
      active: true,
    },
    {
      id: ALEX,
      propertyId: PROPERTY,
      createdAt: NOW,
      updatedAt: NOW,
      name: "Alex",
      email: "alex@example.invalid",
      role: "member",
      active: true,
    },
  ] as never);
});

const message = (over: Partial<NotificationMessage> = {}): NotificationMessage => ({
  to: "sam@example.invalid",
  subject: "Tank freeze tonight",
  body: "Lows of 24 °F.",
  trigger: "tank_freeze_warning",
  ...over,
});

/** A notifier that records what it was asked to send. */
function recorder(id: string): Notifier & { readonly sent: NotificationMessage[] } {
  const sent: NotificationMessage[] = [];
  return {
    sent,
    async send(input) {
      sent.push(input);
      return { id };
    },
  };
}

describe("saveSetting", () => {
  it("records a choice and reads it back", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "chore_overdue", channel: "push" },
      NOW,
      db,
    );

    const [setting] = await settingsFor(PROPERTY, SAM, db);
    expect(setting).toMatchObject({
      trigger: "chore_overdue",
      channel: "push",
      enabled: true,
      userId: SAM,
    });
  });

  it("changes the existing row rather than stacking a second one", async () => {
    // Two rows for one trigger would leave which preference applies to
    // whichever the query happened to return first.
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "chore_overdue", channel: "push" },
      NOW,
      db,
    );
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "chore_overdue", channel: "none" },
      LATER,
      db,
    );

    const settings = await settingsFor(PROPERTY, SAM, db);
    expect(settings).toHaveLength(1);
    expect(settings[0]?.channel).toBe("none");
  });

  it("keeps `enabled` and `channel` agreeing about being off", async () => {
    // `dueNotifications` reads one and `deliveryChannels` reads the other. Two
    // fields that could disagree eventually would.
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "chore_overdue", channel: "none" },
      NOW,
      db,
    );

    expect((await settingsFor(PROPERTY, SAM, db))[0]?.enabled).toBe(false);
  });

  it("gives the trigger its §6 default lead time when none is given", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "med_expiring", channel: "email" },
      NOW,
      db,
    );

    expect((await settingsFor(PROPERTY, SAM, db))[0]?.leadDays).toBe(30);
  });

  it("keeps one person's choices out of another's", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: ALEX, trigger: "chore_overdue", channel: "none" },
      NOW,
      db,
    );

    expect(await settingsFor(PROPERTY, SAM, db)).toEqual([]);
  });
});

describe("preferenceRouter", () => {
  const route = () => preferenceRouter(db);

  it("allows both channels for somebody who has chosen nothing", async () => {
    expect(await route()(message())).toEqual(["email", "push"]);
  });

  it("allows both for a message that is not one of §6's triggers", async () => {
    expect(await route()(message({ trigger: undefined }))).toEqual(["email", "push"]);
  });

  it("routes to the channel that person picked", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "tank_freeze_warning", channel: "push" },
      NOW,
      db,
    );

    expect(await route()(message())).toEqual(["push"]);
  });

  it("allows nothing for a trigger that person switched off", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "tank_freeze_warning", channel: "none" },
      NOW,
      db,
    );

    expect(await route()(message())).toEqual([]);
  });

  it("reads the recipient's settings, not the sender's", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "tank_freeze_warning", channel: "none" },
      NOW,
      db,
    );

    expect(await route()(message({ to: "alex@example.invalid" }))).toEqual(["email", "push"]);
  });

  it("defaults for an address that belongs to nobody on the farm", async () => {
    expect(await route()(message({ to: "vet@example.invalid" }))).toEqual(["email", "push"]);
  });
});

describe("a switched-off trigger, end to end", () => {
  /** The whole chain a caller gets: composite notifier over the real router. */
  function notifierFor(email: Notifier, push: Notifier) {
    return compositeNotifier({ email, push }, preferenceRouter(db));
  }

  it("arrives on neither channel", async () => {
    // The acceptance criterion, with a real subscription in the table so that
    // the only thing stopping the push is the preference.
    await saveSubscription(
      {
        propertyId: PROPERTY,
        userId: SAM,
        endpoint: "https://fcm.googleapis.com/fcm/send/phone",
        p256dh: Buffer.alloc(65, 4).toString("base64url"),
        auth: "0123456789abcdef",
        deviceLabel: "iPhone",
      },
      NOW,
      db,
    );
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "tank_freeze_warning", channel: "none" },
      NOW,
      db,
    );

    const email = recorder("email-1");
    const push = recorder("push-1");
    const receipt = await notifierFor(email, push).send(message());

    expect(receipt).toEqual({});
    expect(email.sent).toEqual([]);
    expect(push.sent).toEqual([]);
  });

  it("does not take a different trigger down with it", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "tank_freeze_warning", channel: "none" },
      NOW,
      db,
    );

    const email = recorder("email-1");
    const push = recorder("push-1");
    await notifierFor(email, push).send(message({ trigger: "calving_watch" }));

    expect(email.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });

  it("goes only to email when that is what was asked for", async () => {
    await saveSetting(
      { propertyId: PROPERTY, userId: SAM, trigger: "tank_freeze_warning", channel: "email" },
      NOW,
      db,
    );

    const email = recorder("email-1");
    const push = recorder("push-1");
    await notifierFor(email, push).send(message());

    expect(email.sent).toHaveLength(1);
    expect(push.sent).toEqual([]);
  });
});
