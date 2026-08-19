import { projectedId, type CalendarEntry, type Ulid } from "@galaxy-farm/core";

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

export interface GardenCalendarInput {
  readonly planned?: readonly PlannedPlanting[];
  /** Variety names, keyed by id; the row falls back to the method without them. */
  readonly varietyNames?: ReadonlyMap<Ulid, string>;
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
