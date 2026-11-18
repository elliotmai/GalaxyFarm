import { projectedId, type CalendarEntry, type Ulid } from "@galaxy-farm/core";

import type { GrowingFacts } from "./growing.js";
import type { Planting } from "./planting.js";
import { harvestWindow, transplantDue } from "./schedule.js";
import type { PlannedPlanting } from "./season-plan.js";

/**
 * What the garden puts on the unified calendar (spec §6, §5.5).
 *
 * Planting windows, and only the ones in the plan. §5.5 is explicit that
 * alerts fire "only for what's *in the plan*, not the whole seed catalog", and
 * the same restraint applies here for the same reason: a calendar carrying
 * every crop's window every week is a calendar nobody opens in March.
 *
 * A window is a fortnight or a month, not a day, so these rows carry an
 * `endAt` — which is what makes a window that opened in February still show on
 * March's calendar, `projectEvents` having been careful about exactly that.
 */

const PLANNED_PLANTINGS = "plannedPlantings";
const PLANTINGS = "plantings";

export interface GardenCalendarInput {
  readonly planned?: readonly PlannedPlanting[];
  /** Variety names, keyed by id; the row falls back to the method without them. */
  readonly varietyNames?: ReadonlyMap<Ulid, string>;
  /**
   * Plantings, for the dates that follow from what has actually happened: a
   * tray started indoors is due out on a date, and something in the ground
   * has a harvest window. Real dates, not the catalogue's — the same
   * restraint as the plan.
   */
  readonly plantings?: readonly Planting[];
  /** A variety's growing facts (its own days, else its crop's). */
  readonly factsFor?: (varietyId: Ulid) => GrowingFacts | undefined;
}

const METHOD_LABELS: Readonly<Record<string, string>> = {
  direct_sow: "Direct sow",
  transplant: "Transplant",
  indoor_start: "Start indoors",
};

/**
 * Every garden row, unordered — `projectEvents` sorts and windows them.
 *
 * Realised and abandoned plans drop out. A window for something already in the
 * ground is not work, and one abandoned in April is not work either; both
 * would still be sitting on the calendar in June asking to be done.
 */
export function gardenCalendarEntries(input: GardenCalendarInput): CalendarEntry[] {
  return [...plannedEntries(input), ...plantingEntries(input)];
}

/**
 * What the plantings themselves put on the calendar: a seedling's harden-off
 * week and transplant day, and the harvest window of anything in the ground.
 */
function plantingEntries(input: GardenCalendarInput): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const planting of input.plantings ?? []) {
    const facts = input.factsFor?.(planting.varietyId);
    const name = input.varietyNames?.get(planting.varietyId) ?? "seedlings";

    if (planting.status === "started" || planting.status === "hardening") {
      const due = transplantDue(planting.indoorStartedOn, facts);
      if (due !== undefined) {
        if (planting.status === "started") {
          entries.push({
            id: `${projectedId("planting_window", PLANTINGS, planting.id)}:harden`,
            kind: "planting_window",
            module: "garden",
            title: `Harden off ${name}`,
            at: due.hardenFrom,
            endAt: due.plantOut,
            allDay: true,
            source: { entity: PLANTINGS, id: planting.id },
          });
        }
        entries.push({
          id: `${projectedId("planting_window", PLANTINGS, planting.id)}:out`,
          kind: "planting_window",
          module: "garden",
          title: `Transplant ${name}`,
          at: due.plantOut,
          allDay: true,
          source: { entity: PLANTINGS, id: planting.id },
        });
      }
    }

    if (planting.status === "growing" || planting.status === "harvesting") {
      const window = harvestWindow(planting.plantedOn, facts);
      if (window !== undefined) {
        entries.push({
          id: projectedId("harvest_window", PLANTINGS, planting.id),
          kind: "harvest_window",
          module: "garden",
          title: `Pick ${name}`,
          at: window.from,
          endAt: window.to,
          allDay: true,
          source: { entity: PLANTINGS, id: planting.id },
        });
      }
    }
  }
  return entries;
}

function plannedEntries(input: GardenCalendarInput): CalendarEntry[] {
  return (input.planned ?? [])
    .filter((planned) => planned.planStatus === "open")
    .map((planned) => {
      const variety = input.varietyNames?.get(planned.varietyId);
      const method = METHOD_LABELS[planned.method] ?? planned.method;

      return {
        id: projectedId("planting_window", PLANNED_PLANTINGS, planned.id),
        kind: "planting_window" as const,
        module: "garden" as const,
        title: variety === undefined ? `${method} — planting window` : `${method} ${variety}`,
        detail: planned.notes,
        at: planned.windowFrom,
        endAt: planned.windowTo,
        allDay: true,
        source: { entity: PLANNED_PLANTINGS, id: planned.id },
      };
    });
}
