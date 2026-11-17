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
import type { FeedType } from "@galaxy-farm/module-feed";

import { guideIncludes } from "@/lib/care-guide-selection";
import { groupChoresForBoard } from "@/lib/chores";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { guideEmergencyContacts, guideVets, guideZonesFrom } from "@/lib/guide-composition";

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

export interface BoardSitter {
  readonly contacts: readonly BoardContact[];
  readonly notes: readonly BoardNote[];
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

interface WallFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallFields(instant: Date, timeZone: string): WallFields {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
  };
}

/**
 * The instant whose *local* fields read what a clock in `timeZone` reads at
 * `instant`. Only ever fed to the kernel's local-time arithmetic; never sent
 * anywhere or stored.
 */
export function wallClock(instant: Date, timeZone: string): Date {
  const f = wallFields(instant, timeZone);
  return new Date(
    f.year,
    f.month - 1,
    f.day,
    f.hour,
    f.minute,
    f.second,
    instant.getMilliseconds(),
  );
}

/**
 * Noon on `day` (`YYYY-MM-DD`) in `timeZone`, as a real instant.
 *
 * What a kiosk sends as the day being ticked — noon in its own timezone — so
 * the tick reaches `tickChore` exactly as the kiosk's would. Noon is never
 * near a daylight-saving change, so one correction step is exact.
 */
export function zonedNoon(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, date, 12, 0, 0);
  const f = wallFields(new Date(guess), timeZone);
  const offset = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - guess;
  return new Date(guess - offset);
}

/** Every `Date` inside a record, moved onto the farm's wall clock. */
export function onWallClock<T>(value: T, timeZone: string): T {
  if (value instanceof Date) return wallClock(value, timeZone) as T;
  if (Array.isArray(value)) return value.map((item) => onWallClock(item, timeZone)) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, onWallClock(item, timeZone)]),
    ) as T;
  }
  return value;
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
}

/**
 * The housesitter guide, as the kiosk's Housesitter Mode composes it
 * (`housesitter-guide.tsx`): its "Who to ring" tab, and its notes — the
 * do-not-handle list and the pens' effective safety levels leading, then the
 * intro and the hand-written sections.
 */
export function boardSitter(sources: SitterSources, now: Date): BoardSitter {
  const { guide } = sources;
  if (guide === undefined) return { contacts: [], notes: [] };

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

  return {
    contacts: [...contacts.values()].map((person) => ({
      name: person.name,
      role: [person.roles.join(" · "), person.company].filter(Boolean).join(" — "),
      phone: person.phone,
    })),
    notes,
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
