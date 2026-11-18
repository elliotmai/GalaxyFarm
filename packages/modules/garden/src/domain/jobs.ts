import type { Ulid } from "@galaxy-farm/core";

import type { GrowingFacts } from "./growing.js";
import type { Planting } from "./planting.js";
import { harvestWindow, latestSowing, transplantDue } from "./schedule.js";
import type { FrostDates, PlannedPlanting } from "./season-plan.js";

/**
 * What the garden needs doing soon (spec §5.5).
 *
 * The plan says what is wanted and the schedule says when; this turns both,
 * and what has actually happened, into the short list somebody works from:
 * start the peppers, put the tomatoes out to harden, plant them out, pick the
 * beans, sow the next row of lettuce. Derived, never stored — ticking one off
 * changes the planting it came from, and the list follows.
 */

export type GardenJobKind =
  "start_indoors" | "sow" | "transplant" | "harden_off" | "plant_out" | "pick" | "sow_again";

export interface GardenJob {
  /** Stable across recomputation: the kind and the record it came from. */
  readonly id: string;
  readonly kind: GardenJobKind;
  readonly varietyId: Ulid;
  /** When it can start. */
  readonly due: Date;
  /** When it stops making sense — the end of a window. */
  readonly until?: Date | undefined;
  readonly plannedId?: Ulid | undefined;
  readonly plantingId?: Ulid | undefined;
  /** Past its window, or past its day for a one-day job. */
  readonly overdue: boolean;
}

const DAY = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

const PLAN_KIND: Readonly<Record<PlannedPlanting["method"], GardenJobKind>> = {
  indoor_start: "start_indoors",
  direct_sow: "sow",
  transplant: "transplant",
};

export function gardenJobs(input: {
  readonly planned: readonly PlannedPlanting[];
  readonly plantings: readonly Planting[];
  readonly factsFor: (varietyId: Ulid) => GrowingFacts | undefined;
  readonly frost?: FrostDates | undefined;
  readonly now: Date;
  /** How far ahead to look. A fortnight is what a gardener plans a weekend from. */
  readonly days?: number;
}): GardenJob[] {
  const { now } = input;
  const horizon = addDays(now, input.days ?? 14);
  const jobs: GardenJob[] = [];

  // The plan: windows open now or opening soon, and any left to lapse.
  for (const entry of input.planned) {
    if (entry.planStatus !== "open" || entry.windowFrom > horizon) continue;
    jobs.push({
      id: `${PLAN_KIND[entry.method]}:${entry.id}`,
      kind: PLAN_KIND[entry.method],
      varietyId: entry.varietyId,
      due: entry.windowFrom,
      until: entry.windowTo,
      plannedId: entry.id,
      overdue: entry.windowTo < now,
    });
  }

  for (const planting of input.plantings) {
    const facts = input.factsFor(planting.varietyId);

    // A tray indoors: out to harden a week before it is due in the ground.
    if (planting.status === "started") {
      const due = transplantDue(planting.indoorStartedOn, facts);
      if (due !== undefined && due.hardenFrom <= horizon) {
        jobs.push({
          id: `harden_off:${planting.id}`,
          kind: "harden_off",
          varietyId: planting.varietyId,
          due: due.hardenFrom,
          until: due.plantOut,
          plantingId: planting.id,
          overdue: due.plantOut < now,
        });
      }
    }

    // Hardened for a week: into the ground.
    if (planting.status === "hardening") {
      const from =
        planting.hardenedOffOn === undefined
          ? transplantDue(planting.indoorStartedOn, facts)?.plantOut
          : addDays(planting.hardenedOffOn, 7);
      if (from === undefined || from <= horizon) {
        const due = from ?? now;
        jobs.push({
          id: `plant_out:${planting.id}`,
          kind: "plant_out",
          varietyId: planting.varietyId,
          due,
          plantingId: planting.id,
          overdue: addDays(due, 7) < now,
        });
      }
    }

    if (planting.status === "growing" || planting.status === "harvesting") {
      const window = harvestWindow(planting.plantedOn, facts);
      if (window !== undefined && window.from <= horizon && window.to >= now) {
        jobs.push({
          id: `pick:${planting.id}`,
          kind: "pick",
          varietyId: planting.varietyId,
          due: window.from,
          until: window.to,
          plantingId: planting.id,
          overdue: false,
        });
      }
    }
  }

  // Succession: the next sowing of a crop sown for a steady supply, once the
  // last one is that many days old — until it would no longer finish.
  const lastSown = new Map<Ulid, Planting>();
  for (const planting of input.plantings) {
    if (planting.method !== "direct_sow" || planting.plantedOn === undefined) continue;
    if (planting.status === "failed") continue;
    const held = lastSown.get(planting.varietyId);
    if (held === undefined || (held.plantedOn as Date) < planting.plantedOn) {
      lastSown.set(planting.varietyId, planting);
    }
  }
  for (const planting of lastSown.values()) {
    const facts = input.factsFor(planting.varietyId);
    if (facts?.successionDays === undefined) continue;
    const due = addDays(planting.plantedOn as Date, facts.successionDays);
    const latest = input.frost === undefined ? undefined : latestSowing(facts, input.frost);
    if (due > horizon || (latest !== undefined && due > latest)) continue;
    jobs.push({
      id: `sow_again:${planting.id}`,
      kind: "sow_again",
      varietyId: planting.varietyId,
      due,
      until: latest,
      plantingId: planting.id,
      overdue: latest !== undefined && latest < now,
    });
  }

  return jobs
    .filter((job) => !(job.overdue && job.until !== undefined && addDays(job.until, 14) < now))
    .sort((left, right) => left.due.getTime() - right.due.getTime());
}

export const GARDEN_JOB_LABELS: Readonly<Record<GardenJobKind, string>> = {
  start_indoors: "Start indoors",
  sow: "Sow",
  transplant: "Plant out",
  harden_off: "Harden off",
  plant_out: "Plant out",
  pick: "Pick",
  sow_again: "Sow more",
};
