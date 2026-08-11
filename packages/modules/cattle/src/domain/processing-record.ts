import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  sumMoney,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The packer (spec §5.2).
 *
 * Dressing percentage is the number this record exists for: hanging weight
 * over live weight, which is how you find out whether an animal that looked
 * good actually was. Everything else here is the money and the freezer.
 */

export const CUT_DISPOSITIONS = ["kept", "sold"] as const;
export type CutDisposition = (typeof CUT_DISPOSITIONS)[number];

export interface CutLine {
  readonly cut: string;
  readonly pounds: number;
  readonly disposition: CutDisposition;
  readonly pricePerLb?: Money | undefined;
  /** Contact — who bought it. */
  readonly buyerId?: Ulid | undefined;
  readonly notes?: string | undefined;
}

export interface ProcessingRecord extends BaseRecord {
  readonly animalId: Ulid;
  /** Contact — the processor. */
  readonly processorId?: Ulid | undefined;
  readonly deliveredOn: Date;
  readonly collectedOn?: Date | undefined;
  readonly liveScaleWeightLb?: number | undefined;
  /** Hot carcass weight. */
  readonly hangingWeightLb?: number | undefined;
  readonly processingCost?: Money | undefined;
  readonly paymentReceived?: Money | undefined;
  readonly cutLines: readonly CutLine[];
  readonly notes?: string | undefined;
}

export const cutLineSchema = z.object({
  cut: z.string().min(1, "Name the cut").max(120),
  pounds: z.number().positive("A cut weighs more than nothing"),
  disposition: z.enum(CUT_DISPOSITIONS),
  pricePerLb: moneySchema.optional(),
  buyerId: ulidSchema.optional(),
  notes: z.string().max(1000).optional(),
});

export const processingRecordSchema = baseRecordSchema
  .extend({
    animalId: ulidSchema,
    processorId: ulidSchema.optional(),
    deliveredOn: z.coerce.date(),
    collectedOn: z.coerce.date().optional(),
    liveScaleWeightLb: z.number().positive().max(4000).optional(),
    hangingWeightLb: z.number().positive().max(3000).optional(),
    processingCost: moneySchema.optional(),
    paymentReceived: moneySchema.optional(),
    cutLines: z.array(cutLineSchema),
    notes: z.string().max(5000).optional(),
  })
  .refine(
    (record) =>
      record.liveScaleWeightLb === undefined ||
      record.hangingWeightLb === undefined ||
      record.hangingWeightLb < record.liveScaleWeightLb,
    // A carcass weighing more than the animal did is a transposed pair of
    // numbers, and it would produce a dressing percentage over 100.
    { message: "Hanging weight cannot exceed live weight", path: ["hangingWeightLb"] },
  )
  .refine(
    (record) => record.collectedOn === undefined || record.collectedOn >= record.deliveredOn,
    {
      message: "Collected before it was delivered",
      path: ["collectedOn"],
    },
  ) as unknown as z.ZodType<ProcessingRecord>;

/**
 * Hanging weight as a percentage of live weight.
 *
 * Sixty to sixty-four percent is the ordinary range for a finished beef animal.
 * Undefined unless both weights are recorded — a guess here is worse than a
 * blank, because the number gets compared between animals.
 */
export function dressingPercentage(
  record: Pick<ProcessingRecord, "liveScaleWeightLb" | "hangingWeightLb">,
): number | undefined {
  if (record.liveScaleWeightLb === undefined || record.hangingWeightLb === undefined) {
    return undefined;
  }
  if (record.liveScaleWeightLb <= 0) return undefined;
  return (record.hangingWeightLb / record.liveScaleWeightLb) * 100;
}

/** Pounds that went in the freezer rather than out the door. */
export function poundsKept(record: Pick<ProcessingRecord, "cutLines">): number {
  return record.cutLines
    .filter((line) => line.disposition === "kept")
    .reduce((total, line) => total + line.pounds, 0);
}

export function poundsSold(record: Pick<ProcessingRecord, "cutLines">): number {
  return record.cutLines
    .filter((line) => line.disposition === "sold")
    .reduce((total, line) => total + line.pounds, 0);
}

/** What one line brought in. Kept cuts bring in nothing — they are not revenue. */
export function cutLineTotal(line: CutLine): Money {
  if (line.disposition !== "sold" || line.pricePerLb === undefined) return { cents: 0 };
  return { cents: Math.round(line.pricePerLb.cents * line.pounds) };
}

export function cutRevenue(record: Pick<ProcessingRecord, "cutLines">): Money {
  return sumMoney(record.cutLines.map(cutLineTotal));
}

/**
 * Recovered pounds against hanging weight.
 *
 * Always under 100: bone and trim are lost between the rail and the box. A
 * figure over it means a cut was entered twice.
 */
export function cuttingYield(
  record: Pick<ProcessingRecord, "cutLines" | "hangingWeightLb">,
): number | undefined {
  if (record.hangingWeightLb === undefined || record.hangingWeightLb <= 0) return undefined;
  return ((poundsKept(record) + poundsSold(record)) / record.hangingWeightLb) * 100;
}
