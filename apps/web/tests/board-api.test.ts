import { describe, expect, it } from "vitest";

import type {
  Animal,
  ChoreTemplate,
  Contact,
  FeedingPlan,
  Task,
  Ulid,
  Zone,
  ZoneAssignment,
} from "@galaxy-farm/core";
import type { CareGuide, GuideSection } from "@galaxy-farm/module-housesitting";
import type { FeedType } from "@galaxy-farm/module-feed";

import {
  boardChores,
  boardProperty,
  boardSitter,
  onWallClock,
  plainText,
  resolveBoardChore,
  resolveTimeZone,
  tickKeys,
  todaySheet,
  wallClock,
  zonedNoon,
  type ChoreSources,
} from "../lib/board-api.js";

/**
 * The board API's mapping (spec §4.3 "Connected apps").
 *
 * The rules are the kiosk's and are tested where they live; what is held here
 * is that the API runs them in the *farm's* day rather than the server's, and
 * maps them onto the wire contract the Fridge Board is written against.
 *
 * Every fixture sits late on a Texas evening, which is already tomorrow in
 * UTC — the case that would put the whole evening round on the wrong day.
 */

const TZ = "America/Chicago";
const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const NORTH = "01ARZ3NDEKTSV4RRFFQ69G5FZ1" as Ulid;
const HAY = "01ARZ3NDEKTSV4RRFFQ69G5FF1" as Ulid;
const MORNING_TEMPLATE = "01ARZ3NDEKTSV4RRFFQ69G5FT1" as Ulid;
const EVENING_TEMPLATE = "01ARZ3NDEKTSV4RRFFQ69G5FT2" as Ulid;
const OWNER = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

/** 22:30 on Monday 16 November in Texas; 04:30 on the 17th in UTC. */
const NOW = new Date("2026-11-17T04:30:00Z");
const MADE = new Date("2026-11-01T12:00:00Z");

const base = (id: string) => ({
  id: id as Ulid,
  propertyId: PROPERTY,
  createdAt: MADE,
  updatedAt: MADE,
});

const template = (id: Ulid, fields: Partial<ChoreTemplate>): ChoreTemplate =>
  ({
    ...base(id),
    title: "A chore",
    recurrence: "daily",
    recurrenceDays: [],
    active: true,
    ...fields,
  }) as ChoreTemplate;

const task = (id: string, fields: Partial<Task>): Task =>
  ({ ...base(id), title: "A task", dueAt: NOW, ...fields }) as Task;

const zone = (id: Ulid, fields: Partial<Zone> = {}): Zone =>
  ({
    ...base(id),
    name: "North Trap",
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 1,
    active: true,
    ...fields,
  }) as Zone;

const feed: FeedType = { ...base(HAY), name: "Coastal hay" } as FeedType;

const BULL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;

const morningFeed: FeedingPlan = {
  ...base("01ARZ3NDEKTSV4RRFFQ69G5FQ1"),
  name: "North ration",
  species: "cattle",
  animalIds: [BULL],
  flockIds: [],
  portion: "total",
  placeZoneId: NORTH,
  active: true,
  lines: [
    {
      feedTypeId: HAY,
      amount: { amount: 40, unit: "lb" },
      frequency: "once_daily",
      timeOfDay: "morning",
    },
  ],
} as unknown as FeedingPlan;

const sources = (fields: Partial<ChoreSources> = {}): ChoreSources => ({
  propertyId: PROPERTY,
  tasks: [],
  templates: [],
  plans: [],
  zones: [zone(NORTH)],
  feeds: [feed],
  ...fields,
});

describe("the farm's wall clock", () => {
  it("reads an instant as a clock in the farm's timezone reads it", () => {
    const wall = wallClock(NOW, TZ);
    expect([wall.getFullYear(), wall.getMonth() + 1, wall.getDate()]).toEqual([2026, 11, 16]);
    expect([wall.getHours(), wall.getMinutes()]).toEqual([22, 30]);
  });

  it("puts noon on a day back as the real instant, either side of daylight saving", () => {
    expect(zonedNoon("2026-11-16", TZ).toISOString()).toBe("2026-11-16T18:00:00.000Z");
    expect(zonedNoon("2026-06-15", TZ).toISOString()).toBe("2026-06-15T17:00:00.000Z");
    expect(zonedNoon("2026-06-15", "UTC").toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("moves every date inside a record and leaves everything else alone", () => {
    const moved = onWallClock({ at: NOW, list: [NOW], name: "x", n: 1, none: undefined }, TZ);
    expect(moved.at.getDate()).toBe(16);
    expect(moved.list[0]?.getHours()).toBe(22);
    expect(moved).toMatchObject({ name: "x", n: 1, none: undefined });
  });

  it("falls back to the farm's default zone for a missing or nonsense one", () => {
    expect(resolveTimeZone("America/Denver")).toBe("America/Denver");
    expect(resolveTimeZone(undefined)).toBe("America/Chicago");
    expect(resolveTimeZone("")).toBe("America/Chicago");
    expect(resolveTimeZone("Not/AZone")).toBe("America/Chicago");
  });
});

describe("today's chores", () => {
  it("is the farm's day, not the server's", () => {
    expect(todaySheet(sources(), NOW, TZ).date).toBe("2026-11-16");
    expect(todaySheet(sources(), NOW, "UTC").date).toBe("2026-11-17");
  });

  it("slots template occurrences, feeding trips, owed and finished chores as the kiosk board does", () => {
    const sheet = todaySheet(
      sources({
        templates: [
          template(MORNING_TEMPLATE, { title: "Check water", timeOfDay: "morning" }),
          template(EVENING_TEMPLATE, { title: "Shut the coop", timeOfDay: "evening" }),
        ],
        plans: [morningFeed],
        tasks: [
          // Due Sunday morning in Texas and never done: owed.
          task("01ARZ3NDEKTSV4RRFFQ69G5FK1", {
            title: "Fix the gate",
            detail: "North side",
            dueAt: new Date("2026-11-15T17:00:00Z"),
          }),
          // 20:00 on Monday in Texas — Tuesday in UTC — and done.
          task("01ARZ3NDEKTSV4RRFFQ69G5FK2", {
            title: "Bring in the hose",
            dueAt: new Date("2026-11-17T02:00:00Z"),
            completedAt: new Date("2026-11-17T01:30:00Z"),
            completedBy: OWNER,
          }),
          // Done last week: belongs to its own day, not this one.
          task("01ARZ3NDEKTSV4RRFFQ69G5FK3", {
            title: "Old news",
            dueAt: new Date("2026-11-09T17:00:00Z"),
            completedAt: new Date("2026-11-09T16:00:00Z"),
          }),
        ],
      }),
      NOW,
      TZ,
    );

    expect(boardChores(sheet.entries)).toEqual([
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FK1",
        title: "Fix the gate",
        detail: "North side",
        slot: "owed",
        done: false,
      },
      {
        id: `occurrence:${MORNING_TEMPLATE}:2026-11-16`,
        title: "Check water",
        detail: null,
        slot: "morning",
        done: false,
      },
      {
        id: `feeding:zone:${NORTH}:morning:2026-11-16`,
        title: "Morning feed · North Trap",
        detail: "40 lb Coastal hay",
        slot: "morning",
        done: false,
      },
      {
        id: `occurrence:${EVENING_TEMPLATE}:2026-11-16`,
        title: "Shut the coop",
        detail: null,
        slot: "evening",
        done: false,
      },
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FK2",
        title: "Bring in the hose",
        detail: null,
        slot: "evening",
        done: true,
      },
    ]);
  });

  it("files an untimed chore under night, as the board's last section", () => {
    const sheet = todaySheet(
      sources({ templates: [template(MORNING_TEMPLATE, { title: "Any time" })] }),
      NOW,
      TZ,
    );
    expect(boardChores(sheet.entries).map((chore) => chore.slot)).toEqual(["night"]);
  });
});

describe("resolving a chore id", () => {
  const ticked = task("01ARZ3NDEKTSV4RRFFQ69G5FK9", {
    title: "Check water",
    templateId: MORNING_TEMPLATE,
    dueAt: new Date("2026-11-16T17:00:59Z"),
    completedAt: new Date("2026-11-16T15:00:00Z"),
  });
  const fedRow = task("01ARZ3NDEKTSV4RRFFQ69G5FK8", {
    title: "Morning feed · North Trap",
    sourceKey: `feeding:zone:${NORTH}:morning:2026-11-16`,
    dueAt: new Date("2026-11-16T17:00:59Z"),
    completedAt: new Date("2026-11-16T15:00:00Z"),
  });

  const sheet = todaySheet(
    sources({
      templates: [template(MORNING_TEMPLATE, { title: "Check water", timeOfDay: "morning" })],
      plans: [morningFeed],
      tasks: [ticked, fedRow],
    }),
    NOW,
    TZ,
  );

  it("finds what the sheet lists, and hands tickChore the key the kiosk would", () => {
    const entry = resolveBoardChore(sheet, ticked.id);
    expect(entry?.taskId).toBe(ticked.id);
    expect(tickKeys(entry!)).toEqual({ taskId: ticked.id });
  });

  it("follows a ticked occurrence's old id to the row that replaced it", () => {
    expect(resolveBoardChore(sheet, `occurrence:${MORNING_TEMPLATE}:2026-11-16`)?.taskId).toBe(
      ticked.id,
    );
    expect(resolveBoardChore(sheet, `feeding:zone:${NORTH}:morning:2026-11-16`)?.taskId).toBe(
      fedRow.id,
    );
  });

  it("knows nothing about an id the farm never produced, or another day's", () => {
    expect(resolveBoardChore(sheet, "nonsense")).toBeUndefined();
    expect(resolveBoardChore(sheet, `occurrence:${MORNING_TEMPLATE}:2026-11-15`)).toBeUndefined();
  });

  it("sends a projected occurrence by its template and a feeding trip by its own id", () => {
    const fresh = todaySheet(
      sources({
        templates: [template(MORNING_TEMPLATE, { timeOfDay: "morning" })],
        plans: [morningFeed],
      }),
      NOW,
      TZ,
    );
    const [first, second] = fresh.entries;
    const keys = [first, second].map((entry) => tickKeys(entry!));
    expect(keys).toContainEqual({ templateId: MORNING_TEMPLATE });
    expect(keys).toContainEqual({ sourceKey: `feeding:zone:${NORTH}:morning:2026-11-16` });
  });
});

describe("the housesitter guide", () => {
  const guide = {
    ...base("01ARZ3NDEKTSV4RRFFQ69G5FG1"),
    title: "While we are away",
    intro: "Thanks for **minding** the place.",
    includes: ["pens", "emergency_contacts", "vet"],
    active: true,
  } as CareGuide;

  const contact = (id: string, fields: Partial<Contact>): Contact =>
    ({ ...base(id), name: "Somebody", tags: [], phones: [], emails: [], ...fields }) as Contact;

  const animals = [
    {
      ...base(BULL),
      name: "Bruno",
      species: "cattle",
      sex: "male",
      status: "active",
      ownership: "own",
      safetyLevel: 5,
      safetyNotes: "Charges the gate",
      photoKeys: [],
    } as unknown as Animal,
  ];
  const assignments = [
    {
      ...base("01ARZ3NDEKTSV4RRFFQ69G5FS1"),
      animalId: BULL,
      zoneId: NORTH,
      periodFrom: MADE,
      slot: "primary",
    } as ZoneAssignment,
  ];
  const section = {
    ...base("01ARZ3NDEKTSV4RRFFQ69G5FH1"),
    careGuideId: guide.id,
    title: "Wifi",
    bodyMarkdown: "## Network\nThe password is on [the fridge](https://example.com).",
    order: 0,
  } as GuideSection;

  const sitter = (fields: Partial<Parameters<typeof boardSitter>[0]> = {}) =>
    boardSitter(
      {
        guide,
        sections: [section],
        zones: [zone(NORTH, { baselineSafetyLevel: 2 })],
        assignments,
        animals,
        contacts: [
          contact("01ARZ3NDEKTSV4RRFFQ69G5FC1", {
            name: "Elliot",
            tags: ["emergency"],
            phones: [{ label: "mobile", number: "555-0101" }],
          }),
          contact("01ARZ3NDEKTSV4RRFFQ69G5FC2", {
            name: "Dr Hale",
            company: "County Vets",
            tags: ["vet", "emergency"],
            phones: [{ label: "clinic", number: "555-0199" }],
          }),
          contact("01ARZ3NDEKTSV4RRFFQ69G5FC3", { name: "Farrier", tags: ["vet"] }),
          contact("01ARZ3NDEKTSV4RRFFQ69G5FC4", { name: "Hay buyer", tags: ["buyer"] }),
        ],
        templates: [],
        plans: [],
        feeds: [feed],
        health: [],
        ...fields,
      },
      NOW,
    );

  it("lists who to ring once each, with a number or an honest blank", () => {
    expect(sitter().contacts).toEqual([
      { name: "Elliot", role: "Emergency", phone: "555-0101" },
      { name: "Dr Hale", role: "Emergency · Vet — County Vets", phone: "555-0199" },
      { name: "Farrier", role: "Vet", phone: "" },
    ]);
  });

  it("leads the notes with safety, then the intro and the written sections, as plain text", () => {
    expect(sitter().notes).toEqual([
      { safety: true, text: "Do not handle alone: Bruno — Charges the gate" },
      { safety: true, text: "North Trap: level 5, Do not handle" },
      { safety: false, text: "Thanks for minding the place." },
      { safety: false, text: "Wifi: Network\nThe password is on the fridge." },
    ]);
  });

  it("shows only what the guide includes, and nothing without a guide", () => {
    const contactsOnly = boardSitter(
      {
        guide: { ...guide, intro: undefined, includes: ["vet"] },
        sections: [],
        zones: [zone(NORTH)],
        assignments,
        animals,
        contacts: [contact("01ARZ3NDEKTSV4RRFFQ69G5FC3", { name: "Farrier", tags: ["vet"] })],
        templates: [template(MORNING_TEMPLATE, { title: "Check water" })],
        plans: [morningFeed],
        feeds: [feed],
        health: [],
      },
      NOW,
    );
    expect(contactsOnly).toEqual({
      contacts: [{ name: "Farrier", role: "Vet", phone: "" }],
      notes: [],
      intro: null,
      doNotHandle: [],
      care: [],
    });
    expect(sitter({ guide: undefined })).toEqual({
      contacts: [],
      notes: [],
      intro: null,
      doNotHandle: [],
      care: [],
    });
  });
});

describe("the guide's care sections", () => {
  const DOG = "01ARZ3NDEKTSV4RRFFQ69G5FA2" as Ulid;
  const full = {
    ...base("01ARZ3NDEKTSV4RRFFQ69G5FG1"),
    title: "While we are away",
    intro: "Thanks for **minding** the place.",
    includes: ["pens", "pets", "cattle_feeding", "chores", "emergency_contacts", "vet"],
    active: true,
  } as CareGuide;
  const animal = (id: Ulid, fields: Record<string, unknown>) =>
    ({
      ...base(id),
      sex: "male",
      status: "active",
      ownership: "own",
      safetyLevel: 1,
      photoKeys: [],
      ...fields,
    }) as unknown as Animal;
  const animals = [
    animal(BULL, {
      name: "Bruno",
      species: "cattle",
      safetyLevel: 5,
      safetyNotes: "Charges the gate",
    }),
    animal(DOG, {
      name: "Rex",
      species: "dog",
      safetyLevel: 2,
      customInstructions: "Sleeps **inside**.",
    }),
  ];
  const dogFood = {
    ...base("01ARZ3NDEKTSV4RRFFQ69G5FQ2"),
    name: "Rex's bowl",
    species: "dog",
    animalIds: [DOG],
    flockIds: [],
    portion: "each",
    active: true,
    lines: [
      {
        feedTypeId: HAY,
        amount: { amount: 2, unit: "cup" },
        frequency: "once_daily",
        timeOfDay: "evening",
      },
    ],
  } as unknown as FeedingPlan;

  const result = boardSitter(
    {
      guide: full,
      sections: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5FH1"),
          careGuideId: full.id,
          title: "Wifi",
          bodyMarkdown: "## Network\nThe password is on [the fridge](https://example.com).",
          order: 0,
        } as GuideSection,
      ],
      zones: [
        zone(NORTH, { baselineSafetyLevel: 2, customInstructions: "Water trough by the gate" }),
      ],
      assignments: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5FS1"),
          animalId: BULL,
          zoneId: NORTH,
          periodFrom: MADE,
          slot: "primary",
        } as ZoneAssignment,
      ],
      animals,
      contacts: [],
      templates: [
        template(MORNING_TEMPLATE, { title: "Check water", timeOfDay: "evening", zoneId: NORTH }),
      ],
      plans: [morningFeed, dogFood],
      feeds: [feed],
      health: [],
    },
    NOW,
  );

  it("lays out the animals tab and the written sections in the kiosk's order", () => {
    expect(result.intro).toBe("Thanks for minding the place.");
    expect(result.doNotHandle).toEqual(["Bruno — Charges the gate"]);
    expect(result.care).toEqual([
      {
        title: "In the pens",
        items: [
          {
            name: "North Trap",
            detail: "Bruno — Charges the gate · Water trough by the gate (this pen)",
            safety: 5,
            safetyLabel: "Do not handle",
          },
        ],
      },
      {
        title: "Pets",
        items: [
          {
            name: "Rex",
            detail: "dog · Sleeps inside. · 2 cups of Coastal hay, once a day, evening",
            safety: 2,
            safetyLabel: "Safe with basic caution",
          },
        ],
      },
      {
        // The dog's bowl is under Pets, not here — the kiosk's own filter.
        title: "The rations",
        items: [
          {
            name: "Bruno · North ration",
            detail: "40 lb of Coastal hay, once a day, morning",
            safety: null,
            safetyLabel: null,
          },
        ],
      },
      {
        title: "The routine",
        items: [
          {
            name: "Check water",
            detail: "Every day · North Trap",
            safety: null,
            safetyLabel: null,
          },
        ],
      },
      {
        title: "Wifi",
        items: [
          {
            name: "",
            detail: "Network · The password is on the fridge.",
            safety: null,
            safetyLabel: null,
          },
        ],
      },
    ]);
  });

  it("keeps the first cut's notes exactly as they were", () => {
    expect(result.notes).toEqual([
      { safety: true, text: "Do not handle alone: Bruno — Charges the gate" },
      { safety: true, text: "North Trap: level 5, Do not handle" },
      { safety: false, text: "Thanks for minding the place." },
      { safety: false, text: "Wifi: Network\nThe password is on the fridge." },
    ]);
  });

  it("leaves out every section the guide does not include, and empty ones", () => {
    const pensOnly = boardSitter(
      {
        guide: { ...full, includes: ["pens"] },
        sections: [],
        zones: [zone(NORTH)],
        assignments: [],
        animals,
        contacts: [],
        templates: [template(MORNING_TEMPLATE, { title: "Check water" })],
        plans: [morningFeed, dogFood],
        feeds: [feed],
        health: [],
      },
      NOW,
    );
    // An empty pen with nothing written on it is not in the guide at all.
    expect(pensOnly.care).toEqual([]);
    expect(pensOnly.doNotHandle).toEqual([]);
  });
});

describe("plainText", () => {
  it("strips the markdown a guide section actually uses", () => {
    expect(
      plainText(
        "# Title\r\n\r\n\r\n> quoted\n* one\n+ two\n__bold__ and *soft* and `code` ![pic](x.png)",
      ),
    ).toBe("Title\n\nquoted\n- one\n- two\nbold and soft and code pic");
  });
});

describe("the property", () => {
  it("passes coordinates through and nulls what is unset", () => {
    expect(
      boardProperty(
        { name: "Home place", timezone: "America/Chicago", latitude: 33.05, longitude: -97.44 },
        "Fallback",
      ),
    ).toEqual({ name: "Home place", lat: 33.05, lon: -97.44, timezone: "America/Chicago" });
    expect(boardProperty(undefined, "Fallback")).toEqual({
      name: "Fallback",
      lat: null,
      lon: null,
      timezone: "America/Chicago",
    });
  });
});
