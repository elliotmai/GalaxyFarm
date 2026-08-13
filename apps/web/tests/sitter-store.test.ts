import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Animal, ChoreTemplate, Contact, Task, Ulid } from "@galaxy-farm/core";
import { repositoryFor, type Database } from "@galaxy-farm/infra-db";
import type { CareGuide, GuideSection } from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";

import {
  guideForSitter,
  guideIncludes,
  sitterView,
  tickChore,
  visibleToSitter,
} from "../lib/sitter-store.js";

/**
 * What a housesitter's browser is given, and what it is not (spec §4.3, §5.10).
 *
 * Against real Postgres, because the property that matters is a property of
 * the reads themselves: `care.read` is not `records.read`, and the difference
 * has to be visible in what comes back from the database rather than in a
 * filter somebody could delete from a component while tidying.
 *
 * The tick is here for a different reason. It goes through the push path so
 * the row carries per-field write times, and the assertion below is that the
 * chore an owner's device pulls afterwards is the same chore the sitter
 * finished — not one that quietly un-ticks itself on the next merge.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const SITTER = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

let client: PGlite;
let db: Database;

const base = (recordId: Ulid, propertyId: Ulid = PROPERTY) => ({
  id: recordId,
  propertyId,
  createdAt: NOW,
  updatedAt: NOW,
});

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
  await client.exec(
    "truncate table care_guides, guide_sections, zones, animals, zone_assignments, contacts, chore_templates, tasks, feeding_plans, feed_types, health_records, sync_field_meta, sync_audit",
  );
});

const saveGuide = (overrides: Partial<CareGuide> = {}) =>
  repositoryFor<CareGuide>(db, "careGuides").save({
    ...base(id(1)),
    title: "While we are away",
    includes: ["pens", "emergency_contacts"],
    active: true,
    ...overrides,
  } as CareGuide);

const saveContact = (recordId: Ulid, overrides: Partial<Contact>) =>
  repositoryFor<Contact>(db, "contacts").save({
    ...base(recordId),
    name: "Somebody",
    tags: [],
    phones: [],
    emails: [],
    ...overrides,
  } as Contact);

const saveAnimal = (recordId: Ulid, overrides: Partial<Animal>) =>
  repositoryFor<Animal>(db, "animals").save({
    ...base(recordId),
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...overrides,
  } as Animal);

const saveHealth = (recordId: Ulid, animalId: Ulid) =>
  repositoryFor<HealthRecord>(db, "healthRecords").save({
    ...base(recordId),
    animalId,
    type: "vaccination",
    date: NOW,
    product: "Rabies",
  } as HealthRecord);

const TEMPLATE = id(50);

const saveTemplate = (overrides: Partial<ChoreTemplate> = {}) =>
  repositoryFor<ChoreTemplate>(db, "choreTemplates").save({
    ...base(TEMPLATE),
    title: "Feed the chickens",
    recurrence: "daily",
    recurrenceDays: [],
    active: true,
    ...overrides,
  } as ChoreTemplate);

describe("what reaches a sitter's browser", () => {
  it("serves the live guide and its sections, in order", async () => {
    await saveGuide();
    const sections = repositoryFor<GuideSection>(db, "guideSections");
    await sections.save({
      ...base(id(10)),
      careGuideId: id(1),
      title: "Second",
      bodyMarkdown: "b",
      order: 20,
    } as GuideSection);
    await sections.save({
      ...base(id(11)),
      careGuideId: id(1),
      title: "First",
      bodyMarkdown: "a",
      order: 10,
    } as GuideSection);

    const view = await sitterView(PROPERTY, db);

    expect(view.guide?.title).toBe("While we are away");
    expect(view.sections.map((section) => section.title)).toEqual(["First", "Second"]);
  });

  it("never serves a retired guide", async () => {
    // Switching one off is how somebody takes it out of use, and a sitter
    // still reading it would be following instructions nobody stands behind.
    await saveGuide({ active: false });

    const view = await sitterView(PROPERTY, db);

    expect(view.guide).toBeUndefined();
    expect(view.sections).toEqual([]);
  });

  it("leaves another guide's sections out", async () => {
    await saveGuide();
    await repositoryFor<GuideSection>(db, "guideSections").save({
      ...base(id(10)),
      careGuideId: id(99),
      title: "Someone else's",
      bodyMarkdown: "x",
      order: 0,
    } as GuideSection);

    expect((await sitterView(PROPERTY, db)).sections).toEqual([]);
  });

  it("hands over the emergency numbers and the vet, and nothing else in the CRM", async () => {
    await saveContact(id(20), { name: "Dr. Reyes", tags: ["vet"] });
    await saveContact(id(21), { name: "Next door", tags: ["emergency", "friend_family"] });
    await saveContact(id(22), { name: "The buyer", tags: ["buyer"], notes: "Slow payer" });

    const view = await sitterView(PROPERTY, db);

    expect(view.contacts.map((contact) => contact.name).sort()).toEqual(["Dr. Reyes", "Next door"]);
  });

  it("hands over the pets' treatments and not the herd's", async () => {
    await saveAnimal(id(30), { species: "dog", name: "Rusty" });
    await saveAnimal(id(31), { species: "cattle", name: "Dolly" });
    await saveHealth(id(40), id(30));
    await saveHealth(id(41), id(31));

    const view = await sitterView(PROPERTY, db);

    expect(view.petHealth.map((record) => record.animalId)).toEqual([id(30)]);
  });

  it("asks for no treatments at all when there are no pets", async () => {
    await saveAnimal(id(31), { species: "cattle", name: "Dolly" });
    await saveHealth(id(41), id(31));

    expect((await sitterView(PROPERTY, db)).petHealth).toEqual([]);
  });

  it("is scoped to the property, like everything else", async () => {
    await saveGuide({ id: id(2), propertyId: OTHER_PROPERTY, title: "Next door's guide" });
    await saveContact(id(20), { name: "Their vet", tags: ["vet"] });
    await repositoryFor<Contact>(db, "contacts").save({
      ...base(id(23), OTHER_PROPERTY),
      name: "Their neighbour",
      tags: ["emergency"],
      phones: [],
      emails: [],
    } as Contact);

    const view = await sitterView(PROPERTY, db);

    expect(view.guide).toBeUndefined();
    expect(view.contacts.map((contact) => contact.name)).toEqual(["Their vet"]);
  });
});

describe("guideForSitter", () => {
  const guide = (n: number, active: boolean, createdAt: Date) =>
    ({ id: id(n), active, createdAt }) as CareGuide;

  it("takes the oldest live one, so a second guide does not move somebody mid-visit", () => {
    const chosen = guideForSitter([
      guide(2, true, new Date("2026-06-10T00:00:00Z")),
      guide(1, true, new Date("2026-01-01T00:00:00Z")),
    ]);

    expect(chosen?.id).toBe(id(1));
  });

  it("skips a retired one even when it is the only one", () => {
    expect(guideForSitter([guide(1, false, NOW)])).toBeUndefined();
  });
});

describe("guideIncludes", () => {
  it("is false for a farm that has not written a guide", () => {
    // An honest "nothing here yet" beats a document assembled by default that
    // nobody has read.
    expect(guideIncludes(undefined, "pens")).toBe(false);
  });

  it("follows what the owner published", () => {
    const guide = { includes: ["pens"] } as unknown as CareGuide;

    expect(guideIncludes(guide, "pens")).toBe(true);
    expect(guideIncludes(guide, "chores")).toBe(false);
  });
});

describe("visibleToSitter", () => {
  it("passes the emergency subset and the vet, and refuses the rest", () => {
    expect(visibleToSitter({ tags: ["emergency"] })).toBe(true);
    expect(visibleToSitter({ tags: ["vet"] })).toBe(true);
    expect(visibleToSitter({ tags: ["buyer", "hauler"] })).toBe(false);
    expect(visibleToSitter({ tags: [] })).toBe(false);
  });
});

describe("ticking a chore", () => {
  it("writes the row already complete, rather than an empty one it then updates", async () => {
    await saveTemplate();
    const result = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );

    expect(result.ok).toBe(true);
    const saved = await repositoryFor<Task>(db, "tasks").list({ propertyId: PROPERTY });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.completedAt).toEqual(NOW);
    expect(saved[0]?.completedBy).toBe(SITTER);
    expect(saved[0]?.title).toBe("Feed the chickens");
  });

  it("records per-field write times, so the owner's next edit merges by timestamp", async () => {
    // A row written around the push path has no field metadata, and the next
    // device to touch that task would win or lose the merge by accident.
    await saveTemplate();
    await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );

    const meta = await client.query<{ count: number }>(
      "select count(*)::int as count from sync_field_meta",
    );
    expect(meta.rows[0]?.count).toBeGreaterThan(0);
  });

  it("un-ticks by naming the fields, not by leaving them out", async () => {
    // A key that is merely absent is not a change: dropping them would leave
    // the chore reading as done on every other device on the farm.
    await saveTemplate();
    const first = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );
    if (!first.ok) throw new Error("setup failed");

    const later = new Date(NOW.getTime() + 60_000);
    const undone = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        taskId: first.taskId,
        date: NOW,
        at: later,
        done: false,
      },
      db,
    );

    expect(undone.ok).toBe(true);
    const [task] = await repositoryFor<Task>(db, "tasks").list({ propertyId: PROPERTY });
    expect(task?.completedAt).toBeUndefined();
    expect(task?.completedBy).toBeUndefined();
  });

  it("refuses a chore belonging to another property", async () => {
    await repositoryFor<Task>(db, "tasks").save({
      ...base(id(60), OTHER_PROPERTY),
      title: "Not yours",
      dueAt: NOW,
    } as Task);

    const result = await tickChore(
      { propertyId: PROPERTY, actorId: SITTER, taskId: id(60), date: NOW, at: NOW, done: true },
      db,
    );

    expect(result).toEqual({ ok: false, reason: "That chore is not on this property." });
  });

  it("refuses an occurrence whose template has gone", async () => {
    const result = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );

    expect(result).toEqual({ ok: false, reason: "That chore is not on this property." });
  });

  it("refuses a template belonging to another property", async () => {
    await saveTemplate({ propertyId: OTHER_PROPERTY });

    const result = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );

    expect(result).toEqual({ ok: false, reason: "That chore is not on this property." });
  });

  it("refuses a day the rule never produced", async () => {
    // Without this the day is whatever the request said it was, and a chore
    // could be written onto a date nothing ever put it on.
    await saveTemplate({ recurrence: "weekly", recurrenceDays: [0] });

    const monday = new Date("2026-06-15T12:00:00Z");
    const result = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: monday,
        at: NOW,
        done: true,
      },
      db,
    );

    expect(result).toEqual({ ok: false, reason: "That chore is not on that day's list." });
  });

  it("says so rather than writing a row when asked to un-tick an occurrence", async () => {
    await saveTemplate();
    const result = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: false,
      },
      db,
    );

    expect(result.ok).toBe(false);
    expect(await repositoryFor<Task>(db, "tasks").list({ propertyId: PROPERTY })).toEqual([]);
  });

  it("is a no-op when the chore is already in the state asked for", async () => {
    await saveTemplate();
    const first = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        templateId: TEMPLATE,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );
    if (!first.ok) throw new Error("setup failed");

    const again = await tickChore(
      {
        propertyId: PROPERTY,
        actorId: SITTER,
        taskId: first.taskId,
        date: NOW,
        at: NOW,
        done: true,
      },
      db,
    );

    expect(again).toEqual({ ok: true, taskId: first.taskId });
  });
});
