import {
  choreDaySheet,
  dayKey,
  safetyLabel,
  type Animal,
  type ChoreEntry,
  type ChoreTemplate,
  type Contact,
  type FeedingPlan,
  type Property,
  type Task,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  composeGuide,
  doNotHandleList,
  type CareGuide,
  type GuideSection,
} from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { petBriefings, petsOnFarm } from "@galaxy-farm/module-pets";

import { guideIncludes } from "@/lib/care-guide-selection";
import { groupChoresForBoard, isEggCollectionChore } from "@/lib/chores";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import {
  guideChores,
  guideEmergencyContacts,
  guideFeedingPlans,
  guideVets,
  guideZonesFrom,
} from "@/lib/guide-composition";
import { currentMedicinesFor, feedingLinesFor } from "@/lib/pet-care";
import { onWallClock, wallClock, zonedNoon } from "@/lib/farm-time";

export { onWallClock, wallClock, zonedNoon };

/**
 * The board API's answer, worked out from the farm's records (spec §4.3
 * "Connected apps").
 *
 * Pure, and deliberately a thin layer: every rule here is somebody else's.
 * The day sheet is `choreDaySheet` with the same feeding derivation the kiosk's
 * `useTodayChores` makes, the slots are `groupChoresForBoard`'s sections, and
 * the guide is `composeGuide` with the composition root's own joins. What this
 * file adds is the one thing the kiosk gets for free — being in the farm's
 * timezone — and the mapping onto the wire contract.
 *
 * **Why the timezone needs work here.** The kernel's day arithmetic is local
 * time on purpose (`date-range.ts`): a chore is due on the day the person in
 * the barn is having. On a kiosk, local *is* the farm. On a Netlify function
 * it is UTC, which puts every evening chore on tomorrow's list. So the records
 * are moved onto the farm's wall clock first — every `Date` becomes the
 * instant whose local fields read what a clock in the farm's timezone reads —
 * and the unchanged pure functions run on that. Ids, slots and the day all
 * come out as the kiosk computes them.
 */

export const DEFAULT_TIMEZONE = "America/Chicago";

export type BoardSlot = "owed" | "morning" | "midday" | "evening" | "night";

export interface BoardChore {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  readonly slot: BoardSlot;
  readonly done: boolean;
  /**
   * The egg round. Ticking it off should open Egg Quick-Entry, at
   * `/kiosk/eggs?from=hive` inside Hive — the same rule this site applies on
   * every screen a chore is ticked on (`isEggCollectionChore`).
   */
  readonly eggs: boolean;
}

export interface BoardProperty {
  readonly name: string;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly timezone: string;
}

export interface BoardContact {
  readonly name: string;
  readonly role: string;
  readonly phone: string;
}

export interface BoardNote {
  readonly safety: boolean;
  readonly text: string;
}

export interface BoardCareItem {
  readonly name: string;
  /** One plain-text line, its facts joined with " · ". */
  readonly detail: string;
  /** The level the kiosk badges this row with, when it badges it. */
  readonly safety: number | null;
  readonly safetyLabel: string | null;
}

export interface BoardCareSection {
  readonly title: string;
  readonly items: readonly BoardCareItem[];
}

export interface BoardSitter {
  readonly contacts: readonly BoardContact[];
  /** The original flat list, kept for callers written against v1's first cut. */
  readonly notes: readonly BoardNote[];
  readonly intro: string | null;
  readonly doNotHandle: readonly string[];
  /** "The animals" tab's sections, then the "Notes" tab's written sections. */
  readonly care: readonly BoardCareSection[];
}

export interface BoardResponse {
  readonly property: BoardProperty;
  readonly date: string;
  readonly chores: readonly BoardChore[];
  readonly sitter: BoardSitter;
}

/* ------------------------------------------------------------------ time */

export function isTimeZone(value: string | null | undefined): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The property's own zone when it holds a real one, else the farm's default. */
export function resolveTimeZone(value: string | null | undefined): string {
  return isTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

/* ---------------------------------------------------------------- chores */

export interface ChoreSources {
  readonly propertyId: Ulid;
  readonly tasks: readonly Task[];
  readonly templates: readonly ChoreTemplate[];
  readonly plans: readonly FeedingPlan[];
  readonly zones: readonly Zone[];
  readonly feeds: readonly FeedType[];
}

export interface TodaySheet {
  /** Today in the farm's timezone, `YYYY-MM-DD`. */
  readonly date: string;
  /** On the farm's wall clock — for slotting, never for sending. */
  readonly entries: readonly ChoreEntry[];
  /** The tasks, on the same wall clock, for resolving a stale id. */
  readonly tasks: readonly Task[];
}

/**
 * Today's sheet, exactly as the kiosk's Today's Chores board derives it
 * (`use-today-chores.ts`): feeding trips from the plans, merged by
 * `choreDaySheet` with the stored tasks and the templates' occurrences.
 */
export function todaySheet(sources: ChoreSources, now: Date, timeZone: string): TodaySheet {
  const today = wallClock(now, timeZone);
  const tasks = onWallClock(sources.tasks, timeZone);
  const templates = onWallClock(sources.templates, timeZone);
  const plans = onWallClock(sources.plans, timeZone);

  const derived = feedingChoresFor(
    plans,
    feedingChoreText({
      zones: sources.zones,
      feeds: sources.feeds,
      propertyId: sources.propertyId,
    }),
    today,
    today,
  );

  return {
    date: dayKey(today),
    entries: choreDaySheet({ tasks, templates, derived }, today, today),
    tasks,
  };
}

const SLOT_OF_SECTION: Readonly<Record<string, BoardSlot>> = {
  "Owed from earlier": "owed",
  Morning: "morning",
  Midday: "midday",
  Evening: "evening",
  "Night & any time": "night",
};

/** The kiosk board's sections, in its order, as the contract's slots. */
export function boardChores(entries: readonly ChoreEntry[]): BoardChore[] {
  return groupChoresForBoard(entries).flatMap((section) =>
    section.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      detail: entry.detail ?? null,
      slot: SLOT_OF_SECTION[section.label] ?? "night",
      done: entry.completedAt !== undefined,
      eggs: isEggCollectionChore(entry),
    })),
  );
}

const OCCURRENCE = /^occurrence:([0-9A-HJKMNP-TV-Z]{26}):(\d{4}-\d{2}-\d{2})$/;

/**
 * The entry on today's sheet an API id names, or undefined.
 *
 * Normally the id is one this sheet produced. Two ids go stale by design,
 * though: ticking a template's occurrence or a feeding trip writes a stored
 * row, and from then on the sheet lists it under the row's id. A caller that
 * ticked and then un-ticks with the id it already had still means that chore,
 * so the old id is followed to the row that replaced it — the same key
 * `choreDaySheet` itself dedupes by.
 */
export function resolveBoardChore(sheet: TodaySheet, id: string): ChoreEntry | undefined {
  const direct = sheet.entries.find((entry) => entry.id === id);
  if (direct !== undefined) return direct;

  const occurrence = OCCURRENCE.exec(id);
  const replacement = sheet.tasks.find((task) =>
    occurrence === null
      ? task.sourceKey === id
      : task.templateId === occurrence[1] && dayKey(task.dueAt) === occurrence[2],
  );
  if (replacement === undefined) return undefined;
  return sheet.entries.find((entry) => entry.taskId === replacement.id);
}

/** What `tickChore` is handed for an entry — the same three keys the kiosk board sends. */
export function tickKeys(entry: ChoreEntry): {
  readonly taskId?: Ulid;
  readonly templateId?: Ulid;
  readonly sourceKey?: string;
} {
  if (entry.taskId !== undefined) return { taskId: entry.taskId };
  if (entry.templateId !== undefined) return { templateId: entry.templateId };
  return { sourceKey: entry.id };
}

/* ---------------------------------------------------------------- sitter */

/**
 * Markdown to plain text, for a screen that renders text.
 *
 * Deliberately small: headings, emphasis, inline code, links and images,
 * quotes and list markers. What a hand-written guide section actually uses.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^```[^\n]*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^([ \t]*)[*+-][ \t]+/gm, "$1- ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SitterSources {
  readonly guide: CareGuide | undefined;
  /** The guide's own sections, in order. */
  readonly sections: readonly GuideSection[];
  readonly zones: readonly Zone[];
  readonly assignments: readonly ZoneAssignment[];
  readonly animals: readonly Animal[];
  readonly contacts: readonly Contact[];
  readonly templates: readonly ChoreTemplate[];
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  /** Health records — only the pets' are read, for what they are on now. */
  readonly health: readonly HealthRecord[];
}

const EMPTY_SITTER: BoardSitter = {
  contacts: [],
  notes: [],
  intro: null,
  doNotHandle: [],
  care: [],
};

/** Facts as one line: blanks dropped, each fact's own newlines folded in. */
export function oneLine(parts: readonly (string | undefined)[]): string {
  return parts
    .flatMap((part) => (part === undefined ? [] : plainText(part).split("\n")))
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" · ");
}

const item = (
  name: string,
  parts: readonly (string | undefined)[],
  safety?: { readonly level: number; readonly label: string },
): BoardCareItem => ({
  name,
  detail: oneLine(parts),
  safety: safety?.level ?? null,
  safetyLabel: safety?.label ?? null,
});

/**
 * The housesitter guide, as the kiosk's Housesitter Mode composes it
 * (`housesitter-guide.tsx`), section for section and gated on the same
 * `includes`: "Who to ring", the do-not-handle callout, "The animals" (pens,
 * pets, rations, routine) and "Notes" (intro, written sections).
 *
 * `notes` is the first cut's flat list and is kept exactly as it was.
 */
export function boardSitter(sources: SitterSources, now: Date): BoardSitter {
  const { guide } = sources;
  if (guide === undefined) return EMPTY_SITTER;

  const emergency = guideIncludes(guide, "emergency_contacts")
    ? guideEmergencyContacts(sources.contacts)
    : [];
  const vets = guideIncludes(guide, "vet") ? guideVets(sources.contacts) : [];

  // One row per person. The kiosk lists somebody tagged both under each
  // heading; a list without headings would show them twice for no reason.
  const contacts = new Map<
    string,
    { name: string; roles: string[]; company?: string; phone: string }
  >();
  for (const [role, people] of [
    ["Emergency", emergency],
    ["Vet", vets],
  ] as const) {
    for (const person of people) {
      const existing = contacts.get(person.id);
      if (existing !== undefined) {
        existing.roles.push(role);
        continue;
      }
      contacts.set(person.id, {
        name: person.name,
        roles: [role],
        ...(person.company === undefined ? {} : { company: person.company }),
        phone: person.phone ?? "",
      });
    }
  }

  const composed = composeGuide(
    guide,
    guideIncludes(guide, "pens")
      ? guideZonesFrom(sources.zones, sources.assignments, sources.animals, now)
      : [],
    sources.sections,
    now,
  );

  const notes: BoardNote[] = [
    ...doNotHandleList(composed).map((line) => ({
      safety: true,
      text: `Do not handle alone: ${line}`,
    })),
    ...composed.pens
      .filter((pen) => pen.effectiveLevel >= 3)
      .map((pen) => ({
        safety: true,
        text: `${pen.zoneName}: level ${pen.effectiveLevel}, ${safetyLabel(pen.effectiveLevel)}`,
      })),
    ...(composed.intro === undefined || composed.intro.trim() === ""
      ? []
      : [{ safety: false, text: plainText(composed.intro) }]),
    ...composed.custom.map((section) => ({
      safety: false,
      text: `${section.title}: ${plainText(section.bodyMarkdown)}`,
    })),
  ];

  // "The animals" tab, in the kiosk's order: pens and pets, then the
  // rations, then the standing routine.
  const pens = composed.pens.map((pen) =>
    item(
      pen.zoneName,
      [
        pen.animals.length === 0
          ? "Empty at the moment"
          : pen.animals
              .map((animal) =>
                animal.safetyNotes === undefined
                  ? animal.name
                  : `${animal.name} — ${animal.safetyNotes}`,
              )
              .join(", "),
        ...pen.instructions.map(
          (instruction) =>
            `${instruction.text} (${instruction.source === "zone" ? "this pen" : instruction.sourceName})`,
        ),
      ],
      { level: pen.effectiveLevel, label: pen.effectiveLabel },
    ),
  );

  const pets = guideIncludes(guide, "pets")
    ? petBriefings(
        petsOnFarm(sources.animals).map((pet) => ({
          pet,
          feeding: feedingLinesFor(pet.id, sources.plans, sources.feeds, sources.animals).map(
            (text) => ({ text }),
          ),
          medicines: currentMedicinesFor(pet.id, sources.health, now),
        })),
      ).map((pet) =>
        item(
          pet.name,
          [
            pet.species,
            pet.safetyNotes,
            pet.instructions,
            ...(pet.feeding.length === 0
              ? ["No ration written down — ask before feeding."]
              : pet.feeding),
            pet.medicines.length === 0 ? undefined : `On now: ${pet.medicines.join("; ")}`,
          ],
          { level: pet.safetyLevel, label: pet.safetyLabel },
        ),
      )
    : [];

  const feeding = guideIncludes(guide, "cattle_feeding")
    ? guideFeedingPlans(
        sources.plans,
        sources.feeds,
        sources.animals,
        sources.zones,
        sources.assignments,
        now,
      ).map((plan) => item(`${plan.who} · ${plan.name}`, [plan.portion, ...plan.lines, plan.notes]))
    : [];

  const routine = guideIncludes(guide, "chores")
    ? guideChores(sources.templates, sources.zones).map((chore) =>
        item(chore.title, [chore.when, chore.zoneName, chore.detail]),
      )
    : [];

  const care: BoardCareSection[] = [
    { title: "In the pens", items: pens },
    { title: "Pets", items: pets },
    { title: "The rations", items: feeding },
    { title: "The routine", items: routine },
    // The "Notes" tab's hand-written sections, after the intro it leads with.
    ...composed.custom.map((section) => ({
      title: section.title,
      items: [item("", [section.bodyMarkdown])],
    })),
  ].filter((section) => section.items.length > 0);

  const intro =
    composed.intro === undefined || composed.intro.trim() === "" ? null : plainText(composed.intro);

  return {
    contacts: [...contacts.values()].map((person) => ({
      name: person.name,
      role: [person.roles.join(" · "), person.company].filter(Boolean).join(" — "),
      phone: person.phone,
    })),
    notes,
    intro,
    doNotHandle: doNotHandleList(composed),
    care,
  };
}

/* --------------------------------------------------------------- property */

export function boardProperty(
  property: Pick<Property, "name" | "timezone" | "latitude" | "longitude"> | undefined,
  fallbackName: string,
): BoardProperty {
  return {
    name: property?.name ?? fallbackName,
    lat: typeof property?.latitude === "number" ? property.latitude : null,
    lon: typeof property?.longitude === "number" ? property.longitude : null,
    timezone: resolveTimeZone(property?.timezone),
  };
}
