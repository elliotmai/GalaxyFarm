import { isStuck, type OutboxEntry, type QueuedPhoto } from "@galaxy-farm/core";

/**
 * What is waiting on this device, in words a person reads (spec §4.2).
 *
 * The sync panel lists the outbox — "Weight record · new · 3 min ago" — so
 * somebody standing in a pasture with no signal can see that the treatment
 * they just logged is safe on the phone and will go when it can, and somebody
 * whose change keeps bouncing can see which one and why. Pure, so the wording
 * is pinned by a test.
 */

export interface WaitingItem {
  readonly id: string;
  /** "Weight record", "Photo". */
  readonly what: string;
  /** A name or title out of the change itself, when it carries one. */
  readonly name: string | undefined;
  /** "new", "edited", "deleted", "photo". */
  readonly how: string;
  readonly queuedAt: Date;
  /** Refused by the server often enough to be set aside. */
  readonly stuck: boolean;
  /** The server's last word on it, when it refused. */
  readonly reason: string | undefined;
}

const HOW: Readonly<Record<OutboxEntry["operation"], string>> = {
  create: "new",
  update: "edited",
  delete: "deleted",
};

/** Store names that do not singularise by dropping an "s". */
const WORDS: Readonly<Record<string, string>> = {
  animals: "Animal",
  tasks: "Chore",
  choreTemplates: "Chore template",
  zoneAssignments: "Move",
  attachments: "Photo record",
  feedingPlans: "Ration",
  supplyItems: "Supply",
  equipment: "Equipment",
  contacts: "Contact",
};

/** "weightRecords" → "Weight record". */
export function entityLabel(entity: string): string {
  const known = WORDS[entity];
  if (known !== undefined) return known;
  const words = entity
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/ies$/, "y")
    .replace(/s$/, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The first readable name a change carries — a title, a name, a tag. */
function nameIn(entry: OutboxEntry): string | undefined {
  for (const field of ["name", "title", "tagNumber"]) {
    const change = entry.patch.changes.find((candidate) => candidate.field === field);
    if (typeof change?.value === "string" && change.value.trim() !== "") return change.value.trim();
  }
  return undefined;
}

export function waitingItems(
  entries: readonly OutboxEntry[],
  photos: readonly QueuedPhoto[],
): WaitingItem[] {
  const changes = entries.map((entry): WaitingItem => ({
    id: entry.id,
    what: entityLabel(entry.patch.entity),
    name: nameIn(entry),
    how: HOW[entry.operation],
    queuedAt: new Date(entry.queuedAt),
    stuck: isStuck(entry),
    reason: entry.lastError,
  }));
  const pictures = photos.map((photo): WaitingItem => ({
    id: photo.id,
    what: "Photo",
    name: undefined,
    how: "photo",
    queuedAt: new Date(photo.queuedAt),
    stuck: isStuck(photo),
    reason: photo.lastError,
  }));
  // Set-aside items first — the only ones with something for a person to do —
  // then oldest first, the order they will go in.
  return [...changes, ...pictures].sort(
    (left, right) =>
      Number(right.stuck) - Number(left.stuck) ||
      left.queuedAt.getTime() - right.queuedAt.getTime(),
  );
}

/** "just now", "3 min ago", "2 hr ago", "yesterday", "Mon 26 Oct". */
export function ago(at: Date, now: Date): string {
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  if (hours < 48) return "yesterday";
  return at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
