import { z } from "zod";

import { addDays } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * Chores (spec §5.1, §6). Templates generate dated instances; instances get
 * checked off, from the kiosk with a gloved hand more often than not.
 */

export const RECURRENCES = ["once", "daily", "weekly", "monthly", "seasonal"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export interface ChoreTemplate extends BaseRecord {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly recurrence: Recurrence;
  /** For weekly: 0 = Sunday. For monthly: day of month. */
  readonly recurrenceDays: readonly number[];
  readonly zoneId?: Ulid | undefined;
  readonly animalId?: Ulid | undefined;
  readonly active: boolean;
}

export interface Task extends BaseRecord {
  readonly templateId?: Ulid | undefined;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly dueAt: Date;
  readonly completedAt?: Date | undefined;
  readonly completedBy?: Ulid | undefined;
  readonly assignedTo?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly animalId?: Ulid | undefined;
}

export const choreTemplateSchema = baseRecordSchema.extend({
  title: z.string().min(1, "A chore needs a title").max(120),
  detail: z.string().max(2000).optional(),
  recurrence: z.enum(RECURRENCES),
  recurrenceDays: z.array(z.number().int().min(0).max(31)),
  zoneId: ulidSchema.optional(),
  animalId: ulidSchema.optional(),
  active: z.boolean(),
}) as unknown as z.ZodType<ChoreTemplate>;

export const taskSchema = baseRecordSchema.extend({
  templateId: ulidSchema.optional(),
  title: z.string().min(1).max(120),
  detail: z.string().max(2000).optional(),
  dueAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  completedBy: ulidSchema.optional(),
  assignedTo: ulidSchema.optional(),
  zoneId: ulidSchema.optional(),
  animalId: ulidSchema.optional(),
}) as unknown as z.ZodType<Task>;

export function isComplete(task: Pick<Task, "completedAt">): boolean {
  return task.completedAt !== undefined;
}

export function isOverdue(task: Pick<Task, "dueAt" | "completedAt">, now: Date): boolean {
  return task.completedAt === undefined && task.dueAt < now;
}

export function complete(task: Task, at: Date, by: Ulid): Task {
  return { ...task, completedAt: at, completedBy: by, updatedAt: at };
}

/** Un-check a chore. Fingers slip, especially on a kiosk with gloves on. */
export function reopen(task: Task, at: Date): Task {
  const next = { ...task, updatedAt: at };
  delete (next as { completedAt?: Date }).completedAt;
  delete (next as { completedBy?: Ulid }).completedBy;
  return next;
}

/**
 * Does a template produce an instance on this date?
 *
 * Generation is pure and date-driven rather than a background job writing rows
 * ahead of time, so changing a template does not leave stale future instances
 * lying around.
 */
export function occursOn(
  template: Pick<ChoreTemplate, "recurrence" | "recurrenceDays" | "active">,
  date: Date,
): boolean {
  if (!template.active) return false;

  switch (template.recurrence) {
    case "once":
      return false;
    case "daily":
      return true;
    case "weekly":
      return template.recurrenceDays.includes(date.getDay());
    case "monthly":
      return template.recurrenceDays.includes(date.getDate());
    case "seasonal":
      return false;
  }
}

/** Dates in `[from, from + days)` on which a template fires. */
export function occurrencesInWindow(
  template: Pick<ChoreTemplate, "recurrence" | "recurrenceDays" | "active">,
  from: Date,
  days: number,
): Date[] {
  const dates: Date[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(from, offset);
    if (occursOn(template, date)) dates.push(date);
  }
  return dates;
}
