import { z } from "zod";

import { addDays, baseRecordSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * Oestrus synchronisation protocols (spec §5.2).
 *
 * A protocol is a template of day offsets — "CIDR in on day 0, GnRH day 0,
 * CIDR out and PG on day 7, breed on day 10" — and applying one to a cow
 * projects each step onto the calendar. The steps are relative because that is
 * how the protocol is written on the sheet, and because a protocol started a
 * day late shifts wholesale rather than needing retyping.
 *
 * Miss a step in a sync protocol and the whole round is wasted, along with the
 * straws. That is why these project onto the calendar with notifications
 * rather than living in somebody's head for ten days.
 */

export const PROTOCOL_ACTIONS = [
  "cidr_in",
  "cidr_out",
  "gnrh",
  "prostaglandin",
  "heat_watch",
  "breed",
  "preg_check",
  "other",
] as const;
export type ProtocolAction = (typeof PROTOCOL_ACTIONS)[number];

export interface ProtocolStep {
  /** Days from day 0, which is the day the protocol starts. */
  readonly dayOffset: number;
  readonly action: ProtocolAction;
  readonly label: string;
  /** Hours into the day, for the timed-AI steps where it genuinely matters. */
  readonly hourOffset?: number | undefined;
  readonly product?: string | undefined;
  readonly notes?: string | undefined;
}

export interface SyncProtocol extends BaseRecord {
  readonly name: string;
  readonly detail?: string | undefined;
  readonly steps: readonly ProtocolStep[];
  readonly active: boolean;
}

export const protocolStepSchema = z.object({
  dayOffset: z.number().int().min(0).max(120),
  action: z.enum(PROTOCOL_ACTIONS),
  label: z.string().min(1, "A step needs a label").max(120),
  hourOffset: z.number().min(0).max(23).optional(),
  product: z.string().max(160).optional(),
  notes: z.string().max(1000).optional(),
});

export const syncProtocolSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A protocol needs a name").max(120),
  detail: z.string().max(5000).optional(),
  steps: z.array(protocolStepSchema).min(1, "A protocol needs at least one step"),
  active: z.boolean(),
}) as unknown as z.ZodType<SyncProtocol>;

export interface ProjectedStep {
  readonly step: ProtocolStep;
  readonly at: Date;
  readonly animalId: Ulid;
  readonly protocolId: Ulid;
}

/**
 * Lay a protocol over a real start date for one cow.
 *
 * Ordered by time so the day sheet reads top to bottom, and ties broken by the
 * order the steps were written: two things at 8am on day 7 happen in the order
 * the protocol says, not in whatever order the sort felt like.
 */
export function projectProtocol(
  protocol: Pick<SyncProtocol, "id" | "steps">,
  animalId: Ulid,
  startedOn: Date,
): ProjectedStep[] {
  return protocol.steps
    .map((step, index) => {
      const day = addDays(startedOn, step.dayOffset);
      const at =
        step.hourOffset === undefined ? day : new Date(day.getTime() + step.hourOffset * 3_600_000);
      return { step, at, animalId, protocolId: protocol.id, index };
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime() || left.index - right.index)
    .map(({ step, at, animalId: id, protocolId }) => ({ step, at, animalId: id, protocolId }));
}

/** Steps falling on a given day — what the chore list asks for each morning. */
export function stepsOn(steps: readonly ProjectedStep[], day: Date): ProjectedStep[] {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = addDays(from, 1);
  return steps.filter((step) => step.at >= from && step.at < to);
}

/**
 * The step that breeds her, which is the one the whole protocol exists for.
 *
 * Used to pre-fill the breeding record's date so a timed-AI protocol does not
 * need the date typed a second time.
 */
export function breedingStep(steps: readonly ProjectedStep[]): ProjectedStep | undefined {
  return steps.find((step) => step.step.action === "breed");
}

/**
 * The 7-day CO-Synch + CIDR protocol §5.2 names as its example.
 *
 * Shipped as a starting point rather than left for somebody to type at six in
 * the morning. Editable like any other record — it is a seed, not a constant.
 */
export const CO_SYNCH_CIDR_7_DAY: readonly ProtocolStep[] = [
  { dayOffset: 0, action: "cidr_in", label: "CIDR in + GnRH", product: "GnRH" },
  { dayOffset: 7, action: "cidr_out", label: "CIDR out + prostaglandin", product: "PG" },
  { dayOffset: 7, action: "prostaglandin", label: "Prostaglandin" },
  { dayOffset: 9, action: "heat_watch", label: "Watch for standing heat" },
  { dayOffset: 10, action: "breed", label: "Timed AI + GnRH", hourOffset: 8, product: "GnRH" },
];
