import type { GrowingFacts } from "./growing.js";
import type { FrostDates } from "./season-plan.js";

/**
 * When to do what, worked out from the frost dates (spec §5.5).
 *
 * The question a garden is planned by is not "how many days to maturity" but
 * "when do I start the peppers inside, when do they go out, and when will
 * there be something to pick". Every one of those is a fixed offset from the
 * last spring frost for that crop — peppers inside nine weeks before it, out
 * a fortnight after — so with the farm's frost dates and the crop's timing the
 * whole year falls out, and nobody has to type a window by hand again.
 *
 * Seeds and seedlings are different schedules, not different labels:
 *
 *   start indoors ──► harden off (a week) ──► transplant ──► harvest
 *   sow direct ───────────────────────────────────────────► harvest
 *   buy a seedling ───────────────────────► transplant ──► harvest
 *
 * And a second season: a hardy or half-hardy crop can go in again in late
 * summer, sown late enough to finish before the first fall frost. Garlic goes
 * in in the fall and is the year's first harvest.
 */

const DAY = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + Math.round(days) * DAY);

/** How a planting starts — from seed indoors, from seed in the ground, or a bought start. */
export type StartFrom = "indoor_start" | "direct_sow" | "transplant";

export type MilestoneKind =
  "start_indoors" | "harden_off" | "transplant" | "sow" | "harvest" | "fall_sow" | "fall_plant";

export interface Milestone {
  readonly kind: MilestoneKind;
  readonly from: Date;
  /** The end of the window; the same as `from` for a single day. */
  readonly to: Date;
}

export const MILESTONE_LABELS: Readonly<Record<MilestoneKind, string>> = {
  start_indoors: "Start indoors",
  harden_off: "Harden off",
  transplant: "Transplant",
  sow: "Sow outside",
  harvest: "Harvest",
  fall_sow: "Sow for fall",
  fall_plant: "Plant for next year",
};

/** A tender crop goes in late enough to dodge frost — and finishes before it. */
const TENDER_FALL_BUFFER = 14;
/** Shorter fall days slow everything down; a crop sown in August needs a fortnight more. */
const SHORT_DAY_FACTOR = 14;

/**
 * How a crop is usually started when nobody has said: started inside if it
 * has indoor weeks and is a transplant crop, else sown where it grows.
 */
export function usualStart(facts: GrowingFacts): StartFrom {
  if (facts.sowing === "transplant" && facts.startIndoorsWeeks !== undefined) return "indoor_start";
  if (facts.sowing === "transplant") return "transplant";
  return "direct_sow";
}

/**
 * The year's milestones for one crop, started one way.
 *
 * Returns nothing it cannot work out: a crop with no planting-out offset has
 * no spring dates, and one with no days to maturity has no harvest window.
 * Never invents a date to fill a gap.
 */
export function plantingSchedule(
  facts: GrowingFacts | undefined,
  frost: FrostDates | undefined,
  start: StartFrom = facts === undefined ? "direct_sow" : usualStart(facts),
): Milestone[] {
  if (facts === undefined || frost === undefined) return [];
  const milestones: Milestone[] = [];
  const last = frost.lastSpringFrost;

  if (facts.plantOutWeeks !== undefined) {
    const out = addDays(last, facts.plantOutWeeks * 7);

    if (start === "direct_sow") {
      // A fortnight's window to get it in; a succession crop keeps going
      // until it would no longer finish before the first fall frost.
      const latest = latestSowing(facts, frost);
      const until =
        facts.successionDays !== undefined && latest !== undefined && latest > out
          ? latest
          : addDays(out, 14);
      milestones.push({ kind: "sow", from: out, to: until });
    } else {
      // Weeks before the last frost, which is how every seed packet says it.
      if (start === "indoor_start" && facts.startIndoorsWeeks !== undefined) {
        const indoors = addDays(last, -facts.startIndoorsWeeks * 7);
        milestones.push({ kind: "start_indoors", from: indoors, to: addDays(indoors, 7) });
      }
      milestones.push({ kind: "harden_off", from: addDays(out, -7), to: addDays(out, -1) });
      milestones.push({ kind: "transplant", from: out, to: addDays(out, 7) });
    }

    if (facts.daysToMaturity !== undefined) {
      const ready = addDays(out, facts.daysToMaturity);
      milestones.push({
        kind: "harvest",
        from: ready,
        to: addDays(ready, (facts.harvestWeeks ?? 2) * 7),
      });
    }
  }

  // A second, fall planting for anything that takes some cold.
  const fallBy = latestSowing(facts, frost);
  if (
    fallBy !== undefined &&
    facts.lifecycle === "annual" &&
    facts.frostTolerance !== undefined &&
    facts.frostTolerance !== "tender" &&
    facts.season === "cool" &&
    // A fall sowing is seed in the ground in late summer; a crop that has to
    // be raised indoors first (celery, onions) is not sown for fall.
    facts.sowing !== "transplant"
  ) {
    milestones.push({ kind: "fall_sow", from: addDays(fallBy, -21), to: fallBy });
  }

  if (facts.fallPlantWeeks !== undefined) {
    const plant = addDays(frost.firstFallFrost, -facts.fallPlantWeeks * 7);
    milestones.push({ kind: "fall_plant", from: addDays(plant, -7), to: addDays(plant, 7) });
  }

  return milestones.sort((left, right) => left.from.getTime() - right.from.getTime());
}

/**
 * The last day a crop can go in and still finish before the first fall frost.
 *
 * Days to maturity, plus a fortnight for the shortening days, back from the
 * frost — and a fortnight more for a tender crop, which has to be finished
 * rather than merely alive when it comes. Undefined without days to maturity.
 */
export function latestSowing(facts: GrowingFacts, frost: FrostDates): Date | undefined {
  if (facts.daysToMaturity === undefined) return undefined;
  const buffer = SHORT_DAY_FACTOR + (facts.frostTolerance === "tender" ? TENDER_FALL_BUFFER : 0);
  return addDays(frost.firstFallFrost, -(facts.daysToMaturity + buffer));
}

/** The milestone a plan entry's window is for: the first thing done outside or in. */
export function plantingWindow(
  facts: GrowingFacts | undefined,
  frost: FrostDates | undefined,
  start: StartFrom,
): Milestone | undefined {
  const schedule = plantingSchedule(facts, frost, start);
  const kind: MilestoneKind =
    start === "indoor_start" ? "start_indoors" : start === "transplant" ? "transplant" : "sow";
  return (
    schedule.find((milestone) => milestone.kind === kind) ??
    schedule.find((milestone) => milestone.kind === "fall_plant")
  );
}

/**
 * When a planting will have something to pick, from when it went in.
 *
 * A window rather than a date: beans come for a month, a cabbage for a week.
 */
export function harvestWindow(
  plantedOn: Date | undefined,
  facts: GrowingFacts | undefined,
): { readonly from: Date; readonly to: Date } | undefined {
  if (plantedOn === undefined || facts?.daysToMaturity === undefined) return undefined;
  const from = addDays(plantedOn, facts.daysToMaturity);
  return { from, to: addDays(from, (facts.harvestWeeks ?? 2) * 7) };
}

/** When a seedling started indoors is ready to harden off and go out. */
export function transplantDue(
  indoorStartedOn: Date | undefined,
  facts: GrowingFacts | undefined,
): { readonly hardenFrom: Date; readonly plantOut: Date } | undefined {
  if (indoorStartedOn === undefined || facts?.startIndoorsWeeks === undefined) return undefined;
  const plantOut = addDays(indoorStartedOn, facts.startIndoorsWeeks * 7);
  return { hardenFrom: addDays(plantOut, -7), plantOut };
}

/* -------------------------------------------------------------- space */

/**
 * How many plants fit in a bed at a crop's spacing.
 *
 * Square spacing — the plant gets a spacing-by-spacing square — which is what
 * a raised bed or a square-foot layout uses and slightly undercounts a row,
 * the safe side to be wrong on. Undefined without the bed's size or the
 * crop's spacing.
 */
export function plantsThatFit(
  bed: { readonly lengthFt?: number | undefined; readonly widthFt?: number | undefined },
  spacingInches: number | undefined,
): number | undefined {
  if (bed.lengthFt === undefined || bed.widthFt === undefined || spacingInches === undefined) {
    return undefined;
  }
  const along = Math.max(1, Math.floor((bed.lengthFt * 12) / spacingInches));
  const across = Math.max(1, Math.floor((bed.widthFt * 12) / spacingInches));
  return along * across;
}

/** Square feet a number of plants takes at a spacing. */
export function areaNeeded(count: number, spacingInches: number): number {
  return (count * spacingInches * spacingInches) / 144;
}

/**
 * How full a bed is with what is planned or growing in it, 0–1 and beyond.
 *
 * Each planting's share is its count over what would fit of that crop alone,
 * so a bed half tomatoes and half lettuce reads as full. Plantings without a
 * count or a spacing are left out rather than guessed.
 */
export function bedFill(
  bed: { readonly lengthFt?: number | undefined; readonly widthFt?: number | undefined },
  plantings: readonly {
    readonly quantity?: number | undefined;
    readonly spacingInches?: number | undefined;
  }[],
): number | undefined {
  if (bed.lengthFt === undefined || bed.widthFt === undefined) return undefined;
  let fill = 0;
  let counted = false;
  for (const planting of plantings) {
    const fits = plantsThatFit(bed, planting.spacingInches);
    if (fits === undefined || planting.quantity === undefined) continue;
    fill += planting.quantity / fits;
    counted = true;
  }
  return counted ? fill : undefined;
}
