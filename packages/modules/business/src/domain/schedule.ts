import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * The show barn's daily rhythm as data (spec §5.7, added v0.6).
 *
 * A programme-wide template of time-slotted activities, overridable per calf,
 * generating a daily checklist per calf that merges into the ordinary chore
 * system. §4.4's Program Day Sheet renders it as a calf × activity grid.
 *
 * The reason it is a template plus overrides rather than a schedule per calf:
 * "this calf rinses three times" is an exception worth stating once, and
 * twelve copies of the same schedule is twelve places to change when hair
 * season starts.
 */

export const PROGRAM_ACTIVITIES = [
  "morning_chores",
  "rinse",
  "blow_dry",
  "exercise",
  "training",
  "evening_chores",
  "feeding",
  "custom",
] as const;
export type ProgramActivity = (typeof PROGRAM_ACTIVITIES)[number];

export interface ScheduleSlot {
  readonly activity: ProgramActivity;
  /** Minutes from midnight, so ordering does not depend on string parsing. */
  readonly atMinutes: number;
  readonly label?: string | undefined;
  readonly durationMinutes?: number | undefined;
}

export interface ProgramSchedule extends BaseRecord {
  readonly name: string;
  /** Absent on the programme-wide default; set on a per-calf override. */
  readonly enrollmentId?: Ulid | undefined;
  readonly slots: readonly ScheduleSlot[];
  readonly active: boolean;
}

export const scheduleSlotSchema = z.object({
  activity: z.enum(PROGRAM_ACTIVITIES),
  atMinutes: z.number().int().min(0).max(1439),
  label: z.string().max(120).optional(),
  durationMinutes: z.number().int().positive().max(480).optional(),
});

export const programScheduleSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A schedule needs a name").max(120),
  enrollmentId: ulidSchema.optional(),
  slots: z.array(scheduleSlotSchema),
  active: z.boolean(),
}) as unknown as z.ZodType<ProgramSchedule>;

/**
 * Extra slots a package implies (§5.7: "packages can imply schedule
 * additions").
 *
 * Hair growing is the one that matters: it adds a second rinse and the blow-out
 * that follows it, and forgetting to add them by hand is how a calf's coat gets
 * lost in July.
 */
export const PACKAGE_SLOTS: Readonly<Record<string, readonly ScheduleSlot[]>> = {
  hair_growing: [
    { activity: "rinse", atMinutes: 16 * 60, label: "Afternoon rinse" },
    { activity: "blow_dry", atMinutes: 16 * 60 + 30, label: "Blow out" },
  ],
  halter_breaking: [{ activity: "training", atMinutes: 10 * 60, label: "Halter work" }],
};

/**
 * One calf's day, resolved.
 *
 * Template, then package additions, then the calf's own override — most
 * specific last, the same precedence as feeding plans. A per-calf schedule
 * replaces the template outright rather than merging into it, because "this
 * one is on a different routine" means a different routine.
 */
export function daySheetFor(
  template: Pick<ProgramSchedule, "slots">,
  packages: readonly string[],
  override?: Pick<ProgramSchedule, "slots"> | undefined,
): ScheduleSlot[] {
  const base = override?.slots ?? [
    ...template.slots,
    ...packages.flatMap((name) => PACKAGE_SLOTS[name] ?? []),
  ];

  return [...base].sort(
    (left, right) =>
      left.atMinutes - right.atMinutes || left.activity.localeCompare(right.activity),
  );
}

/** "07:30", for a grid heading. */
export function formatSlotTime(atMinutes: number): string {
  const hours = Math.floor(atMinutes / 60);
  const minutes = atMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface DaySheetRow {
  readonly enrollmentId: Ulid;
  readonly slots: readonly ScheduleSlot[];
}

/**
 * The whole barn's day, as §4.4's calf × activity grid.
 *
 * Every calf gets a row even if its day is empty, because a missing row reads
 * as "that calf is not in the programme" rather than "nothing scheduled".
 */
export function daySheet(
  template: Pick<ProgramSchedule, "slots">,
  enrollments: ReadonlyArray<{
    readonly id: Ulid;
    readonly packages: readonly string[];
    readonly override?: Pick<ProgramSchedule, "slots"> | undefined;
  }>,
): DaySheetRow[] {
  return enrollments.map((enrollment) => ({
    enrollmentId: enrollment.id,
    slots: daySheetFor(template, enrollment.packages, enrollment.override),
  }));
}
