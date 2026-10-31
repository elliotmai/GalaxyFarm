import type { CrudError, Divider, GeoPoint, Ulid, Zone } from "@galaxy-farm/core";

/**
 * Temporary fencing, as the map edits it (spec §5.1, §8).
 *
 * A fence is not a record of its own — it lives in its zone's `dividers` list
 * (see the note on `Divider` in core for why) — so every create, edit, toggle
 * and delete is the same write: the zone, with a new list. These are the pure
 * halves of those writes, kept apart from the screen so the list arithmetic is
 * pinned by a test rather than by dragging fences around a map.
 */

/** The most fences one zone may carry — the schema's own limit. */
export const MOST_FENCES = 8;

/** The fence form, as typed. */
export interface FenceDraft {
  readonly name: string;
  readonly line: readonly GeoPoint[];
  readonly up: boolean;
  readonly waterSourceIds: readonly Ulid[];
  readonly closes: string;
  readonly notes: string;
}

export const BLANK_FENCE: FenceDraft = {
  name: "",
  line: [],
  up: true,
  waterSourceIds: [],
  closes: "",
  notes: "",
};

export function draftFromFence(fence: Divider): FenceDraft {
  return {
    name: fence.name,
    line: fence.line,
    up: fence.up,
    waterSourceIds: fence.waterSourceIds,
    closes: fence.closes ?? "",
    notes: fence.notes ?? "",
  };
}

/**
 * The fence a draft describes.
 *
 * Blank text is left off rather than stored as "", because "shut out of" an
 * empty string is what `describeZoneExtent` would then say at the gate.
 */
export function fenceFromDraft(id: string, draft: FenceDraft): Divider {
  const closes = draft.closes.trim();
  const notes = draft.notes.trim();
  return {
    id,
    name: draft.name.trim(),
    line: draft.line,
    up: draft.up,
    waterSourceIds: draft.waterSourceIds,
    ...(closes === "" ? {} : { closes }),
    ...(notes === "" ? {} : { notes }),
  };
}

/** The zone's fences with this one added, or put in place of the one it edits. */
export function withFence(zone: Pick<Zone, "dividers">, fence: Divider): Divider[] {
  const fences = zone.dividers ?? [];
  return fences.some((existing) => existing.id === fence.id)
    ? fences.map((existing) => (existing.id === fence.id ? fence : existing))
    : [...fences, fence];
}

/** The zone's fences without this one. */
export function withoutFence(zone: Pick<Zone, "dividers">, fenceId: string): Divider[] {
  return (zone.dividers ?? []).filter((fence) => fence.id !== fenceId);
}

/** The zone's fences with this one put up, or taken down. */
export function withFenceToggled(zone: Pick<Zone, "dividers">, fenceId: string): Divider[] {
  return (zone.dividers ?? []).map((fence) =>
    fence.id === fenceId ? { ...fence, up: !fence.up } : fence,
  );
}

/**
 * The schema's complaints about one fence, keyed by its field.
 *
 * The write is the whole zone, so an issue arrives as
 * `["dividers", 2, "name"]`; only those about the fence being saved belong on
 * its form, and only by their last part.
 */
export function fenceErrors(error: CrudError, index: number): Record<string, string> {
  if (error.kind !== "validation") return { name: "Could not save. Try again." };
  const found: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.path[0] !== "dividers" || issue.path[1] !== index) continue;
    const field = String(issue.path[2] ?? "name");
    found[field] ??= issue.message;
  }
  return Object.keys(found).length === 0 ? { name: "Could not save. Try again." } : found;
}
