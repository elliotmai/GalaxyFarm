import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Eggs (spec §5.4).
 *
 * The kiosk entry for this is a row of +1 buttons at the coop (§4.4), so the
 * total is the required field and the colour and size breakdown is optional on
 * the same screen. A log that demanded a breakdown would be a log nobody fills
 * in, and §8's "logging must be fast" is the constraint that decides it.
 */

export const EGG_COLOURS = ["brown", "white", "blue", "green", "cream", "speckled"] as const;
export type EggColour = (typeof EGG_COLOURS)[number];

export const EGG_SIZES = ["peewee", "small", "medium", "large", "extra_large", "jumbo"] as const;
export type EggSize = (typeof EGG_SIZES)[number];

export interface EggBreakdown {
  readonly colour: EggColour;
  readonly size: EggSize;
  readonly count: number;
}

export interface EggLog extends BaseRecord {
  readonly flockId?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly collectedOn: Date;
  readonly total: number;
  readonly breakdown: readonly EggBreakdown[];
  readonly notes?: string | undefined;
}

export const eggBreakdownSchema = z.object({
  colour: z.enum(EGG_COLOURS),
  size: z.enum(EGG_SIZES),
  count: z.number().int().positive(),
});

export const eggLogSchema = baseRecordSchema
  .extend({
    flockId: ulidSchema.optional(),
    zoneId: ulidSchema.optional(),
    collectedOn: z.coerce.date(),
    total: z.number().int().min(0),
    breakdown: z.array(eggBreakdownSchema),
    notes: z.string().max(1000).optional(),
  })
  .refine(
    (log) =>
      log.breakdown.length === 0 ||
      log.breakdown.reduce((sum, row) => sum + row.count, 0) === log.total,
    // A breakdown that does not add up to the total means one of the two is
    // wrong, and the trends report would quietly use whichever it read first.
    { message: "The breakdown has to add up to the total", path: ["breakdown"] },
  ) as unknown as z.ZodType<EggLog>;

export const EGG_DISPOSITIONS = ["kept", "given", "sold"] as const;
export type EggDispositionKind = (typeof EGG_DISPOSITIONS)[number];

export interface EggDisposition extends BaseRecord {
  readonly disposedOn: Date;
  readonly quantity: number;
  readonly kind: EggDispositionKind;
  readonly contactId?: Ulid | undefined;
  readonly price?: Money | undefined;
  readonly notes?: string | undefined;
}

export const eggDispositionSchema = baseRecordSchema
  .extend({
    disposedOn: z.coerce.date(),
    quantity: z.number().int().positive(),
    kind: z.enum(EGG_DISPOSITIONS),
    contactId: ulidSchema.optional(),
    price: moneySchema.optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((entry) => entry.kind === "sold" || entry.price === undefined, {
    message: "Only a sale carries a price",
    path: ["price"],
  }) as unknown as z.ZodType<EggDisposition>;

/** Totals by day, week, or month — §6's egg production trends. */
export function eggTotalsByPeriod(
  logs: readonly EggLog[],
  period: "day" | "week" | "month",
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const log of logs) {
    const key = periodKey(log.collectedOn, period);
    totals.set(key, (totals.get(key) ?? 0) + log.total);
  }

  return new Map([...totals].sort(([left], [right]) => left.localeCompare(right)));
}

function periodKey(at: Date, period: "day" | "week" | "month"): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  if (period === "month") return `${year}-${month}`;
  if (period === "day") return `${year}-${month}-${String(at.getUTCDate()).padStart(2, "0")}`;

  // ISO week, so a week never spans two labels differently in two places.
  const date = new Date(Date.UTC(year, at.getUTCMonth(), at.getUTCDate()));
  const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Eggs per bird per day, which is the number that says how the flock is doing. */
export function layRate(
  logs: readonly EggLog[],
  headCount: number,
  window: { from: Date; to: Date },
): number | undefined {
  if (headCount <= 0) return undefined;
  const days = Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000));

  const collected = logs
    .filter((log) => log.collectedOn >= window.from && log.collectedOn <= window.to)
    .reduce((total, log) => total + log.total, 0);

  return collected / headCount / days;
}

/** Totals by colour and size, for the breakdown §6's report asks for. */
export function breakdownTotals(logs: readonly EggLog[]): {
  byColour: Map<EggColour, number>;
  bySize: Map<EggSize, number>;
} {
  const byColour = new Map<EggColour, number>();
  const bySize = new Map<EggSize, number>();

  for (const log of logs) {
    for (const row of log.breakdown) {
      byColour.set(row.colour, (byColour.get(row.colour) ?? 0) + row.count);
      bySize.set(row.size, (bySize.get(row.size) ?? 0) + row.count);
    }
  }

  return { byColour, bySize };
}
