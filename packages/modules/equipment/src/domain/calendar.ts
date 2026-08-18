import { projectedId, type CalendarEntry, type Ulid } from "@galaxy-farm/core";

import {
  lastService,
  latestReading,
  maintenanceDueOn,
  type Equipment,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "./equipment.js";

/**
 * What the fleet puts on the unified calendar (spec §6, §5.6).
 *
 * §6 asks for "maintenance due (hours/miles/date)", and only one of those
 * three is a date. A rule that comes due at 250 hours has no calendar position
 * until a meter says it has arrived — projecting it at "now" would give it a
 * position that moves every time the page is drawn, and putting it nowhere
 * would leave an overdue engine off the one screen that lists what is owed.
 *
 * So a meter rule earns a row the moment it is overdue, on the day of the
 * reading that carried it past its interval. That is a stored date, it does
 * not move, and it is the honest answer to "when did this come due" — while a
 * meter rule that is not yet due stays on the equipment screen, where a number
 * rather than a date is the right way to say how far off it is.
 */

const MAINTENANCE_RULES = "maintenanceRules";

export interface EquipmentCalendarInput {
  readonly equipment?: readonly Equipment[];
  readonly rules?: readonly MaintenanceRule[];
  readonly logs?: readonly MaintenanceLog[];
  readonly readings?: readonly MeterReading[];
}

/** Every equipment row, unordered — `projectEvents` sorts and windows them. */
export function equipmentCalendarEntries(input: EquipmentCalendarInput): CalendarEntry[] {
  const rules = input.rules ?? [];
  const logs = input.logs ?? [];
  const readings = input.readings ?? [];
  const names = new Map((input.equipment ?? []).map((machine) => [machine.id, machine.name]));
  // A machine that is sold or retired keeps its history and stops asking for
  // oil. Its rules are still on the record; they are simply not work any more.
  const retired = new Set(
    (input.equipment ?? [])
      .filter((machine) => machine.status === "sold" || machine.status === "retired")
      .map((machine) => machine.id),
  );

  return rules
    .filter((rule) => rule.active && !retired.has(rule.equipmentId))
    .flatMap((rule) => {
      const at = dueOn(rule, logs, readings);
      if (at === undefined) return [];

      return [
        {
          id: projectedId("maintenance_due", MAINTENANCE_RULES, rule.id),
          kind: "maintenance_due" as const,
          module: "equipment" as const,
          title: `${names.get(rule.equipmentId) ?? "Equipment"} — ${rule.task}`,
          detail: describeInterval(rule),
          at,
          allDay: true,
          source: { entity: MAINTENANCE_RULES, id: rule.id },
        },
      ];
    });
}

/**
 * The day this rule belongs on, or nothing.
 *
 * The months trigger wins when a rule has one, because it is the trigger that
 * genuinely names a day. Only a rule with no months interval at all falls back
 * to its meter, and then only once the meter has passed it.
 */
function dueOn(
  rule: MaintenanceRule,
  logs: readonly MaintenanceLog[],
  readings: readonly MeterReading[],
): Date | undefined {
  const last = lastService(logs, rule.id);

  const byDate = maintenanceDueOn(rule, last?.performedOn);
  if (byDate !== undefined) return byDate;

  return (
    meterOverdueOn(rule.equipmentId, "hours", rule.everyHours, last?.hours, readings) ??
    meterOverdueOn(rule.equipmentId, "miles", rule.everyMiles, last?.miles, readings)
  );
}

function meterOverdueOn(
  equipmentId: Ulid,
  kind: "hours" | "miles",
  interval: number | undefined,
  lastServicedAt: number | undefined,
  readings: readonly MeterReading[],
): Date | undefined {
  if (interval === undefined) return undefined;

  const reading = latestReading(readings, equipmentId, kind);
  if (reading === undefined) return undefined;

  const target = (lastServicedAt ?? 0) + interval;
  return reading.value >= target ? reading.readOn : undefined;
}

/** "Every 100 hours · every 6 months" — why this row is on this day. */
function describeInterval(rule: MaintenanceRule): string | undefined {
  const parts = [
    rule.everyHours === undefined ? undefined : `every ${rule.everyHours} hours`,
    rule.everyMiles === undefined ? undefined : `every ${rule.everyMiles} miles`,
    rule.everyMonths === undefined ? undefined : `every ${rule.everyMonths} months`,
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? undefined : parts.join(" · ");
}
