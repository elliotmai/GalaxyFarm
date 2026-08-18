import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  moneySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The fleet, and when things are due (spec §5.6).
 *
 * Maintenance is triggered three ways — hours, miles, or months — and §5.6
 * allows "any combination". A rule with two triggers is due when the *first*
 * one comes up, which is the only reading that keeps oil in an engine that
 * sits all winter and then runs eighty hours in a fortnight.
 */

export const EQUIPMENT_CATEGORIES = ["vehicle", "trailer", "implement", "tool"] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_STATUSES = ["in_service", "down", "sold", "retired"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export interface Equipment extends BaseRecord {
  readonly name: string;
  readonly category: EquipmentCategory;
  readonly make?: string | undefined;
  readonly model?: string | undefined;
  readonly year?: number | undefined;
  readonly vin?: string | undefined;
  readonly status: EquipmentStatus;
  readonly purchasedOn?: Date | undefined;
  readonly purchasePrice?: Money | undefined;
  readonly photoKeys: readonly string[];
  readonly notes?: string | undefined;
}

export const equipmentSchema = baseRecordSchema.extend({
  name: z.string().min(1, "Name the machine").max(120),
  category: z.enum(EQUIPMENT_CATEGORIES),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vin: z.string().max(40).optional(),
  status: z.enum(EQUIPMENT_STATUSES),
  purchasedOn: z.coerce.date().optional(),
  purchasePrice: moneySchema.optional(),
  photoKeys: z.array(z.string()),
  notes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<Equipment>;

export const METER_KINDS = ["hours", "miles"] as const;
export type MeterKind = (typeof METER_KINDS)[number];

export interface MeterReading extends BaseRecord {
  readonly equipmentId: Ulid;
  readonly kind: MeterKind;
  readonly value: number;
  readonly readOn: Date;
  readonly notes?: string | undefined;
}

export const meterReadingSchema = baseRecordSchema.extend({
  equipmentId: ulidSchema,
  kind: z.enum(METER_KINDS),
  value: z.number().min(0),
  readOn: z.coerce.date(),
  notes: z.string().max(1000).optional(),
}) as unknown as z.ZodType<MeterReading>;

export interface MaintenanceRule extends BaseRecord {
  readonly equipmentId: Ulid;
  readonly task: string;
  readonly everyHours?: number | undefined;
  readonly everyMiles?: number | undefined;
  readonly everyMonths?: number | undefined;
  readonly parts?: string | undefined;
  readonly active: boolean;
}

export const maintenanceRuleSchema = baseRecordSchema
  .extend({
    equipmentId: ulidSchema,
    task: z.string().min(1, "Say what the job is").max(160),
    everyHours: z.number().positive().optional(),
    everyMiles: z.number().positive().optional(),
    everyMonths: z.number().positive().optional(),
    parts: z.string().max(1000).optional(),
    active: z.boolean(),
  })
  .refine(
    (rule) =>
      rule.everyHours !== undefined ||
      rule.everyMiles !== undefined ||
      rule.everyMonths !== undefined,
    // A rule with no trigger never comes due, which is the same as not existing
    // except that it looks like coverage on a screen.
    { message: "A maintenance rule needs at least one trigger", path: ["everyMonths"] },
  ) as unknown as z.ZodType<MaintenanceRule>;

export interface MaintenanceLog extends BaseRecord {
  readonly equipmentId: Ulid;
  readonly ruleId?: Ulid | undefined;
  readonly task: string;
  readonly performedOn: Date;
  readonly cost?: Money | undefined;
  readonly parts?: string | undefined;
  /** Meter at the time, so the next interval measures from the right place. */
  readonly hours?: number | undefined;
  readonly miles?: number | undefined;
  readonly notes?: string | undefined;
}

export const maintenanceLogSchema = baseRecordSchema.extend({
  equipmentId: ulidSchema,
  ruleId: ulidSchema.optional(),
  task: z.string().min(1).max(160),
  performedOn: z.coerce.date(),
  cost: moneySchema.optional(),
  parts: z.string().max(1000).optional(),
  hours: z.number().min(0).optional(),
  miles: z.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<MaintenanceLog>;

export interface FuelLog extends BaseRecord {
  readonly equipmentId: Ulid;
  readonly gallons: number;
  readonly cost: Money;
  readonly filledOn: Date;
  readonly hours?: number | undefined;
  readonly miles?: number | undefined;
  readonly notes?: string | undefined;
}

export const fuelLogSchema = baseRecordSchema.extend({
  equipmentId: ulidSchema,
  gallons: z.number().positive(),
  cost: moneySchema,
  filledOn: z.coerce.date(),
  hours: z.number().min(0).optional(),
  miles: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
}) as unknown as z.ZodType<FuelLog>;

/**
 * The latest reading of one meter, with the day it was taken.
 *
 * The date matters as much as the number to anything that has to put a
 * meter-triggered rule on a calendar: "due at 250 hours" has no date of its
 * own, and the reading that carried it past 250 is the only honest one to use.
 */
export function latestReading(
  readings: readonly MeterReading[],
  equipmentId: Ulid,
  kind: MeterKind,
): MeterReading | undefined {
  return readings
    .filter((reading) => reading.equipmentId === equipmentId && reading.kind === kind)
    .sort((left, right) => right.readOn.getTime() - left.readOn.getTime())[0];
}

/** The latest reading of one meter. */
export function currentMeter(
  readings: readonly MeterReading[],
  equipmentId: Ulid,
  kind: MeterKind,
): number | undefined {
  return latestReading(readings, equipmentId, kind)?.value;
}

/** The most recent service logged against a rule. */
export function lastService(
  logs: readonly MaintenanceLog[],
  ruleId: Ulid,
): MaintenanceLog | undefined {
  return logs
    .filter((log) => log.ruleId === ruleId)
    .sort((left, right) => right.performedOn.getTime() - left.performedOn.getTime())[0];
}

/**
 * The date a months-triggered rule next comes due.
 *
 * Its own function because the calendar wants the date without the rest of the
 * verdict: `maintenanceDue` reports whichever trigger comes up first, and for
 * a rule with both hours and months that can be the one with no date on it at
 * all — leaving the month it is due in unreachable from the outside.
 */
export function maintenanceDueOn(
  rule: Pick<MaintenanceRule, "everyMonths" | "createdAt">,
  lastPerformedOn: Date | undefined,
): Date | undefined {
  if (rule.everyMonths === undefined) return undefined;
  // From the last service, or from when it was first recorded as due.
  return addDays(lastPerformedOn ?? rule.createdAt, Math.round(rule.everyMonths * 30.4375));
}

export interface MaintenanceDue {
  readonly rule: MaintenanceRule;
  /** Whichever trigger comes up first. */
  readonly reason: "hours" | "miles" | "months";
  readonly dueAt?: Date | undefined;
  readonly dueAtHours?: number | undefined;
  readonly dueAtMiles?: number | undefined;
  readonly overdue: boolean;
}

/**
 * What is due, and why.
 *
 * A rule with two triggers is due at whichever comes first, and the returned
 * `reason` says which — "overdue" with no explanation is a notification people
 * dismiss.
 */
export function maintenanceDue(
  rules: readonly MaintenanceRule[],
  logs: readonly MaintenanceLog[],
  readings: readonly MeterReading[],
  now: Date,
): MaintenanceDue[] {
  const due: MaintenanceDue[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;

    const last = lastService(logs, rule.id);

    const hours = currentMeter(readings, rule.equipmentId, "hours");
    const miles = currentMeter(readings, rule.equipmentId, "miles");

    const candidates: MaintenanceDue[] = [];

    if (rule.everyHours !== undefined && hours !== undefined) {
      const target = (last?.hours ?? 0) + rule.everyHours;
      candidates.push({ rule, reason: "hours", dueAtHours: target, overdue: hours >= target });
    }
    if (rule.everyMiles !== undefined && miles !== undefined) {
      const target = (last?.miles ?? 0) + rule.everyMiles;
      candidates.push({ rule, reason: "miles", dueAtMiles: target, overdue: miles >= target });
    }
    const target = maintenanceDueOn(rule, last?.performedOn);
    if (target !== undefined) {
      candidates.push({ rule, reason: "months", dueAt: target, overdue: now >= target });
    }

    // Overdue on any trigger wins; otherwise report the first configured one so
    // a screen can say what it is waiting on.
    const first = candidates.find((candidate) => candidate.overdue) ?? candidates[0];
    if (first !== undefined) due.push(first);
  }

  return due;
}

/** Fuel and maintenance together — §6's "equipment cost of ownership". */
export function costOfOwnership(
  equipmentId: Ulid,
  maintenance: readonly MaintenanceLog[],
  fuel: readonly FuelLog[],
): Money {
  const cents =
    maintenance
      .filter((log) => log.equipmentId === equipmentId)
      .reduce((total, log) => total + (log.cost?.cents ?? 0), 0) +
    fuel
      .filter((log) => log.equipmentId === equipmentId)
      .reduce((total, log) => total + log.cost.cents, 0);

  return { cents };
}

/**
 * Miles per gallon between two fills.
 *
 * Undefined without two readings — a single fill says how much fuel went in
 * and nothing about how far it went.
 */
export function fuelEfficiency(fuel: readonly FuelLog[], equipmentId: Ulid): number | undefined {
  const withMiles = fuel
    .filter((log) => log.equipmentId === equipmentId && log.miles !== undefined)
    .sort((left, right) => (left.miles as number) - (right.miles as number));

  const first = withMiles[0];
  const last = withMiles[withMiles.length - 1];
  if (first === undefined || last === undefined || first === last) return undefined;

  // The first fill's gallons filled a tank burned before the first reading, so
  // it is excluded — this is the standard tank-to-tank method.
  const gallons = withMiles.slice(1).reduce((total, log) => total + log.gallons, 0);
  if (gallons <= 0) return undefined;

  return ((last.miles as number) - (first.miles as number)) / gallons;
}
