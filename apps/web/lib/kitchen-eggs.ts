import { z } from "zod";

import type { OutboxEntry } from "@galaxy-farm/core";

/**
 * Eggs to the kitchen (spec §4.3 "Connected apps") — what is sent, to where.
 *
 * KitchenHub keeps the household's Eggs in step with this farm: a collection
 * adds its total, eggs given away or sold come off, kept eggs and deleted
 * records count for nothing. It is told each changed record **as it now is**,
 * with its `updatedAt` as a version, never a delta — so a send that arrives
 * twice, late, or out of order cannot count an egg twice, and an edit or a
 * tombstone corrects the stock by the difference. KitchenHub does that
 * arithmetic (its `functions/src/farm/farmEggs.js`); this side only has to say
 * what each record is.
 *
 * Pure: the store (`kitchen-egg-store.ts`) does the reading and the sending.
 */

/** The two sync entities that move the kitchen's stock. */
export const EGG_ENTITIES = ["eggLogs", "eggDispositions"] as const;
export type EggEntity = (typeof EGG_ENTITIES)[number];

/** How many records go in one request; KitchenHub refuses more than 200. */
export const KITCHEN_BATCH_SIZE = 100;

/**
 * Where the eggs go, from the environment.
 *
 * All three or nothing. The token is a KitchenHub Connected apps token, so it
 * names one household; `KITCHENHUB_PROPERTY_ID` says which farm property
 * feeds it. That pairing is the whole mapping — nothing is matched by email or
 * guessed from who is signed in — and a property that is not named here sends
 * nothing.
 */
const configSchema = z.object({
  KITCHENHUB_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "KITCHENHUB_URL must be https"),
  KITCHENHUB_TOKEN: z.string().min(32),
  KITCHENHUB_PROPERTY_ID: z.string().min(1),
});

export interface KitchenEggConfig {
  readonly endpoint: string;
  readonly token: string;
  readonly propertyId: string;
}

export function kitchenEggConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KitchenEggConfig | undefined {
  const parsed = configSchema.safeParse({
    KITCHENHUB_URL: env["KITCHENHUB_URL"]?.trim() || undefined,
    KITCHENHUB_TOKEN: env["KITCHENHUB_TOKEN"]?.trim() || undefined,
    KITCHENHUB_PROPERTY_ID: env["KITCHENHUB_PROPERTY_ID"]?.trim() || undefined,
  });
  if (!parsed.success) return undefined;
  return {
    endpoint: `${parsed.data.KITCHENHUB_URL.replace(/\/+$/, "")}/api/farm/eggs`,
    token: parsed.data.KITCHENHUB_TOKEN,
    propertyId: parsed.data.KITCHENHUB_PROPERTY_ID,
  };
}

/** Did any of these writes touch an egg log or disposition? */
export function touchesEggs(entries: readonly OutboxEntry[]): boolean {
  return entries.some((entry) => (EGG_ENTITIES as readonly string[]).includes(entry.patch.entity));
}

/** A waiting record, as the store reads it. */
export interface PendingEggRecord {
  readonly entity: EggEntity;
  readonly id: string;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /** `collectedOn` or `disposedOn`. */
  readonly on: Date;
  /** `total` or `quantity`. */
  readonly quantity: number;
  /** Only for a disposition. */
  readonly kind: string | null;
}

/** What KitchenHub's endpoint takes for one record. */
export interface KitchenEggRecord {
  readonly id: string;
  readonly type: "log" | "disposition";
  readonly version: string;
  readonly date: string;
  readonly quantity: number;
  readonly kind?: "kept" | "given" | "sold";
  readonly deleted: boolean;
}

/**
 * The calendar day a stored date falls on at the farm.
 *
 * `collectedOn` is a date stored at midday, so a UTC day would do here — but
 * it is read in the property's zone so a record typed with a real time of day
 * still lands on the day the farm saw it.
 */
export function farmDay(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

const DISPOSITION_KINDS = new Set(["kept", "given", "sold"]);

/**
 * One waiting record as KitchenHub's endpoint takes it.
 *
 * A quantity that is not a whole number of eggs, or a disposition kind this
 * build does not know, is sent as deleted: it can contribute nothing until it
 * is corrected, and the correction is a newer version that will be sent.
 */
export function toKitchenRecord(record: PendingEggRecord, timeZone: string): KitchenEggRecord {
  const usable = Number.isInteger(record.quantity) && record.quantity >= 0;
  const base = {
    id: record.id,
    version: record.updatedAt.toISOString(),
    date: farmDay(record.on, timeZone),
    quantity: usable ? record.quantity : 0,
  };
  if (record.entity === "eggLogs") {
    return { ...base, type: "log", deleted: record.deletedAt !== null || !usable };
  }
  const known = record.kind !== null && DISPOSITION_KINDS.has(record.kind);
  return {
    ...base,
    type: "disposition",
    kind: known ? (record.kind as "kept" | "given" | "sold") : "kept",
    deleted: record.deletedAt !== null || !usable || !known,
  };
}

/**
 * KitchenHub's answer. Validated like any other boundary (§4.5 clause 2):
 * only ids it says it has dealt with are marked sent. Not an entity schema —
 * it is another app's reply — so it stays private to this module.
 */
const kitchenEggResponseSchema = z.object({
  ok: z.literal(true),
  item: z.object({ id: z.string(), quantity: z.number() }).nullable(),
  applied: z.array(z.string()),
  unchanged: z.array(z.string()),
  ignored: z.array(z.object({ id: z.string().nullable(), reason: z.string() })),
  rejected: z.array(z.object({ id: z.string().nullable(), reason: z.string() })),
});
export type KitchenEggResponse = z.infer<typeof kitchenEggResponseSchema>;

/** KitchenHub's answer, checked; throws on anything that is not it. */
export function parseKitchenEggResponse(value: unknown): KitchenEggResponse {
  return kitchenEggResponseSchema.parse(value);
}

/**
 * The ids KitchenHub has settled, one way or another.
 *
 * Applied and unchanged are the ordinary answers. Ignored (older than the
 * kitchen's ledger) and rejected (a record it cannot read) are settled too:
 * sending the same version again would get the same answer, so retrying it on
 * every push would only be noise. A newer version is a new send regardless.
 */
export function settledIds(response: KitchenEggResponse): Set<string> {
  return new Set([
    ...response.applied,
    ...response.unchanged,
    ...response.ignored.flatMap((entry) => (entry.id === null ? [] : [entry.id])),
    ...response.rejected.flatMap((entry) => (entry.id === null ? [] : [entry.id])),
  ]);
}
