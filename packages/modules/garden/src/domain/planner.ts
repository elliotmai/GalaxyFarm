import type { Ulid } from "@galaxy-farm/core";

import { companionship } from "./companions.js";
import type { GrowingFacts } from "./growing.js";
import type { PlantingMethod } from "./planting.js";
import { DEFAULT_ROTATION_YEARS } from "./planting.js";
import { plantingSchedule, usualStart, type Milestone, type StartFrom } from "./schedule.js";
import type { FrostDates } from "./season-plan.js";

/**
 * The garden, planned from a wish list (spec §5.5).
 *
 * Somebody says what they want to grow — six tomatoes, a row of lettuce in
 * spring and again in fall, garlic for next year — and for which years. This
 * turns that into the season plan: for each plant, each year, *what* to do
 * (start indoors, sow, set out), *when* (from the farm's frost dates), and
 * *where* (a bed). Then the existing machinery takes over: the plan's windows
 * drive Up next, the calendar and the reminders, and a window planted becomes
 * a planting whose harvest is watched.
 *
 * Choosing the bed is the part a gardener does in their head and gets wrong:
 *
 * - **Rotation.** No family back in a bed it was in within the last three
 *   years — counting what is planned for earlier years of this same plan, so
 *   a three-year plan walks the nightshades round the beds.
 * - **Room.** A bed holds what fits at each crop's spacing, *at the same
 *   time*: lettuce harvested in June leaves room for the fall carrots.
 * - **Neighbours.** Not beside something it does not get on with.
 * - **Packing.** A bed already part-used is preferred to an empty one, so the
 *   plan does not spread six plants across six beds.
 *
 * Nothing is refused. A plant with nowhere to go is listed without a bed and
 * says why ("needs 12 sq ft more"), and one placed against the rotation says
 * so; the gardener decides.
 */

export interface PlannerWant {
  /** What the plan entry will name — a variety's id. */
  readonly varietyId: Ulid;
  readonly name: string;
  /** For rotation; undefined skips the check rather than inventing a family. */
  readonly family?: string | undefined;
  /** What companions are looked up by: the crop's name. */
  readonly cropName: string;
  readonly facts: GrowingFacts | undefined;
  /** How many plants. */
  readonly count: number;
  /** How it is started; the crop's usual way when not said. */
  readonly start?: StartFrom | undefined;
  /** Plant it again in late summer, where the crop allows. */
  readonly fall?: boolean | undefined;
}

export interface PlannerBed {
  readonly id: Ulid;
  readonly name: string;
  readonly lengthFt?: number | undefined;
  readonly widthFt?: number | undefined;
}

export type PlanSeason = "spring" | "fall";

export interface PlanRow {
  readonly varietyId: Ulid;
  readonly name: string;
  readonly year: number;
  readonly season: PlanSeason;
  /** What the plan entry records: how this one is started. */
  readonly method: PlantingMethod;
  /** The first thing to do, and its window — what the plan entry is dated by. */
  readonly step: Milestone;
  /** Every step, in order, for showing the whole year of it. */
  readonly steps: readonly Milestone[];
  /** When it is in the bed, from going in to the end of picking. */
  readonly inGround: { readonly from: Date; readonly to: Date };
  readonly count: number;
  /** Square feet at its spacing. */
  readonly area: number;
  readonly bedId?: Ulid | undefined;
  /** Why it is where it is, or why it is nowhere — in a gardener's words. */
  readonly notes: readonly string[];
}

export interface PlannerInput {
  readonly wants: readonly PlannerWant[];
  readonly beds: readonly PlannerBed[];
  /** What has actually grown where, for the rotation. */
  readonly history: ReadonlyArray<{ bedId: Ulid; family: string; plantedOn: Date }>;
  readonly frostFor: (year: number) => FrostDates | undefined;
  readonly years: readonly number[];
  readonly rotationYears?: number;
}

export interface PlannerResult {
  readonly rows: readonly PlanRow[];
  /** Plants that cannot be scheduled at all — no timing, or no frost dates. */
  readonly unscheduled: readonly { readonly name: string; readonly why: string }[];
}

const DAY = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + Math.round(days) * DAY);

/** When a crop says nothing about its spacing, a foot each is a fair guess. */
const DEFAULT_SPACING = 12;
/** And about how long it is in the ground: a season's worth. */
const DEFAULT_DAYS_IN_GROUND = 90;

const METHOD_OF: Readonly<Record<StartFrom, PlantingMethod>> = {
  indoor_start: "indoor_start",
  direct_sow: "direct_sow",
  transplant: "transplant",
};

/** Square feet a number of plants takes at a spacing. */
export function plantArea(count: number, spacingInches: number | undefined): number {
  const spacing = spacingInches ?? DEFAULT_SPACING;
  return (count * spacing * spacing) / 144;
}

/**
 * A sensible number to start from: about eight square feet of it, between
 * one plant and two dozen — two tomatoes, four peppers, eighteen lettuces.
 */
export function suggestedCount(facts: GrowingFacts | undefined): number {
  const each = plantArea(1, facts?.spacingInches);
  return Math.max(1, Math.min(24, Math.round(8 / each)));
}

/** Can this crop go in again for fall? The same test the schedule makes. */
export function hasFallPlanting(
  facts: GrowingFacts | undefined,
  frost: FrostDates | undefined,
): boolean {
  return plantingSchedule(facts, frost).some((step) => step.kind === "fall_sow");
}

function bedArea(bed: PlannerBed): number | undefined {
  return bed.lengthFt === undefined || bed.widthFt === undefined
    ? undefined
    : bed.lengthFt * bed.widthFt;
}

interface Placed {
  readonly bedId: Ulid;
  readonly from: Date;
  readonly to: Date;
  readonly area: number;
  readonly cropName: string;
  readonly name: string;
}

function overlaps(a: { from: Date; to: Date }, b: { from: Date; to: Date }): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** The scheduled rows for one want in one year, before any bed is chosen. */
function rowsFor(
  want: PlannerWant,
  year: number,
  frost: FrostDates,
): Omit<PlanRow, "bedId" | "notes">[] {
  const facts = want.facts;
  const start = want.start ?? (facts === undefined ? "direct_sow" : usualStart(facts));
  const steps = plantingSchedule(facts, frost, start);
  const harvests = steps.filter((step) => step.kind === "harvest");
  const area = plantArea(want.count, facts?.spacingInches);
  const rows: Omit<PlanRow, "bedId" | "notes">[] = [];

  const first = steps.find(
    (step) =>
      step.kind ===
      (start === "indoor_start" ? "start_indoors" : start === "transplant" ? "transplant" : "sow"),
  );
  if (first !== undefined) {
    const out = steps.find((step) => step.kind === "transplant" || step.kind === "sow") ?? first;
    const harvest = harvests[0];
    const to = harvest?.to ?? addDays(out.from, facts?.daysToMaturity ?? DEFAULT_DAYS_IN_GROUND);
    rows.push({
      varietyId: want.varietyId,
      name: want.name,
      year,
      season: "spring",
      method: METHOD_OF[start],
      step: first,
      steps: steps.filter((step) => step.kind !== "fall_sow" && step.kind !== "fall_plant"),
      inGround: { from: out.from, to },
      count: want.count,
      area,
    });
  }

  const fallSow = steps.find((step) => step.kind === "fall_sow");
  if (fallSow !== undefined && want.fall === true) {
    const ready = addDays(fallSow.from, (facts?.daysToMaturity ?? 60) + 14);
    const harvest = {
      kind: "harvest" as const,
      from: ready,
      to: addDays(ready, (facts?.harvestWeeks ?? 2) * 7),
    };
    rows.push({
      varietyId: want.varietyId,
      name: want.name,
      year,
      season: "fall",
      method: "direct_sow",
      step: fallSow,
      steps: [fallSow, harvest],
      inGround: { from: fallSow.from, to: harvest.to },
      count: want.count,
      area,
    });
  }

  // Garlic and its kind: planted in the fall, in the ground over winter,
  // lifted the next summer.
  const fallPlant = steps.find((step) => step.kind === "fall_plant");
  if (fallPlant !== undefined) {
    const lifted = addDays(fallPlant.from, facts?.daysToMaturity ?? 240);
    const harvest = {
      kind: "harvest" as const,
      from: lifted,
      to: addDays(lifted, (facts?.harvestWeeks ?? 3) * 7),
    };
    rows.push({
      varietyId: want.varietyId,
      name: want.name,
      year,
      season: "fall",
      method: "direct_sow",
      step: fallPlant,
      steps: [fallPlant, harvest],
      inGround: { from: fallPlant.from, to: harvest.to },
      count: want.count,
      area,
    });
  }

  return rows;
}

export function planGarden(input: PlannerInput): PlannerResult {
  const rotationYears = input.rotationYears ?? DEFAULT_ROTATION_YEARS;
  const history = [...input.history];
  const placed: Placed[] = [];
  const rows: PlanRow[] = [];
  const unscheduled: { name: string; why: string }[] = [];
  const wantFamily = new Map(input.wants.map((want) => [want.varietyId, want]));

  for (const year of [...input.years].sort((left, right) => left - right)) {
    const frost = input.frostFor(year);
    if (frost === undefined) {
      if (!unscheduled.some((entry) => entry.why.startsWith("No frost dates"))) {
        unscheduled.push({
          name: "Everything",
          why: "No frost dates yet — set the growing zone in Settings → Farm.",
        });
      }
      continue;
    }

    const drafts = input.wants.flatMap((want) => {
      const found = rowsFor(want, year, frost);
      if (found.length === 0 && !unscheduled.some((entry) => entry.name === want.name)) {
        unscheduled.push({
          name: want.name,
          why: "Nothing is known about when it goes in — add its timing under Plants.",
        });
      }
      return found;
    });

    // Biggest first, spring before fall: the tomatoes find a bed before the
    // radishes fill the gaps.
    drafts.sort(
      (left, right) =>
        (left.season === right.season ? 0 : left.season === "spring" ? -1 : 1) ||
        right.area - left.area ||
        left.name.localeCompare(right.name),
    );

    for (const draft of drafts) {
      const want = wantFamily.get(draft.varietyId);
      const family = want?.family;
      const cropName = want?.cropName ?? draft.name;
      const window = draft.inGround;

      let best: { bed: PlannerBed; score: number; notes: string[]; fits: boolean } | undefined;

      for (const bed of input.beds) {
        const notes: string[] = [];
        let score = 0;

        const sharing = placed.filter((entry) => entry.bedId === bed.id && overlaps(entry, window));
        const used = sharing.reduce((sum, entry) => sum + entry.area, 0);
        const area = bedArea(bed);
        const fits = area === undefined || used + draft.area <= area + 1e-9;
        if (fits) score += 100;
        if (area !== undefined && used > 0 && fits) score += 10 * Math.min(1, used / area);

        if (family !== undefined) {
          const since = history
            .filter((entry) => entry.bedId === bed.id && entry.family === family)
            .map((entry) => (window.from.getTime() - entry.plantedOn.getTime()) / (365.25 * DAY))
            .filter((years) => years >= -0.01 && years < rotationYears);
          // The same family in the same bed *this* season is a neighbour, not
          // a rotation break: four tomatoes and two peppers share a bed.
          const sameSeason = since.some((years) => years < 0.5);
          const broke = since.some((years) => years >= 0.5);
          if (broke) {
            score -= 60;
            notes.push(`${family} were in ${bed.name} within ${rotationYears} years`);
          } else if (sameSeason) {
            score += 5;
          }
        }

        for (const neighbour of sharing) {
          const pairing = companionship(cropName, neighbour.cropName);
          if (pairing?.kind === "bad") {
            score -= 40;
            notes.push(`Next to ${neighbour.name} in ${bed.name}: ${pairing.why.toLowerCase()}`);
          } else if (pairing?.kind === "good") {
            score += 8;
          }
        }

        if (best === undefined || score > best.score) best = { bed, score, notes, fits };
      }

      if (best === undefined || !best.fits) {
        const short =
          best === undefined
            ? undefined
            : (() => {
                const area = bedArea(best.bed) ?? 0;
                const used = placed
                  .filter((entry) => entry.bedId === best!.bed.id && overlaps(entry, window))
                  .reduce((sum, entry) => sum + entry.area, 0);
                return Math.ceil(draft.area - Math.max(0, area - used));
              })();
        rows.push({
          ...draft,
          notes: [
            input.beds.length === 0
              ? "No beds yet — add one under Beds"
              : `No bed has room then — needs ${short ?? Math.ceil(draft.area)} sq ft more`,
          ],
        });
        continue;
      }

      placed.push({
        bedId: best.bed.id,
        from: window.from,
        to: window.to,
        area: draft.area,
        cropName,
        name: draft.name,
      });
      if (family !== undefined) {
        history.push({ bedId: best.bed.id, family, plantedOn: window.from });
      }
      rows.push({ ...draft, bedId: best.bed.id, notes: best.notes });
    }
  }

  rows.sort(
    (left, right) =>
      left.year - right.year ||
      left.step.from.getTime() - right.step.from.getTime() ||
      left.name.localeCompare(right.name),
  );
  return { rows, unscheduled };
}
