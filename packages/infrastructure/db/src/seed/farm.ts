import { encodeUlid, type Ulid } from "@galaxy-farm/core";

/**
 * The farm as it actually is (docs/property-layout.md).
 *
 * Nine zones, four tanks, none of them heated, and one bred cow. Written down
 * as data rather than typed in through forms because it is the answer to
 * "does any of this work", and because the freeze alerts and the calving watch
 * both need real records before they mean anything.
 *
 * Ids are derived from a fixed timestamp and a counter rather than generated,
 * so seeding twice produces the same ids and re-running is an upsert rather
 * than a second farm.
 */

const SEED_EPOCH = Date.UTC(2026, 0, 1);

/** Deterministic ULIDs: same seed, same ids, every time. */
export function seedId(index: number): Ulid {
  let counter = index;
  return encodeUlid(SEED_EPOCH, () => {
    counter += 1;
    // A fixed, index-derived sequence. Not random, and not meant to be — the
    // point is that `pnpm db:seed` twice is idempotent.
    return ((counter * 2654435761) % 4294967296) / 4294967296;
  });
}

export interface SeedWaterSource {
  readonly key: string;
  readonly name: string;
  readonly type: "auto_refill" | "static_tank" | "pond" | "creek";
  readonly hasHeater: boolean;
  readonly cover: "none" | "off" | "on";
  readonly active: boolean;
  readonly notes?: string;
}

export interface SeedZone {
  readonly key: string;
  readonly name: string;
  readonly type: "pen" | "pasture" | "coop" | "barn" | "stall" | "garden_area" | "working_facility";
  readonly indoor: boolean;
  readonly baselineSafetyLevel: 1 | 2 | 3 | 4 | 5;
  readonly waterSourceKeys: readonly string[];
  readonly resting: boolean;
  readonly customInstructions?: string;
}

/**
 * Four tanks, none heated, and covers on three of them.
 *
 * §6 treats a heaterless tank as the vulnerable one and names it in the freeze
 * alert. Here that is every tank on the place, which is worth knowing before
 * the first hard freeze — and that lands in the same window as calving.
 *
 * Heaters are not coming: they are not used here and none is wanted. What
 * happens ahead of a freeze is that the covers go on. **The three auto-refill
 * tanks have covers; the West Pen's static tank does not** — so that one can
 * only be broken open, and saying so is what keeps it off the list of covers
 * to fit. All three are seeded `off`, since they are not on anything in August.
 */
export const SEED_WATER_SOURCES: readonly SeedWaterSource[] = [
  {
    key: "tank-pasture",
    name: "Pasture tank",
    type: "auto_refill",
    hasHeater: false,
    cover: "off",
    active: true,
    notes: "Shared with the hay field.",
  },
  {
    key: "tank-pens-12",
    name: "Pen 1 / 2nd Pen tank",
    type: "auto_refill",
    hasHeater: false,
    cover: "off",
    active: true,
    notes: "Also serves Randy's pasture.",
  },
  {
    key: "tank-pens-ab",
    name: "Pen A / Pen B tank",
    type: "auto_refill",
    hasHeater: false,
    cover: "off",
    active: true,
  },
  {
    key: "tank-west",
    name: "West Pen tank",
    type: "static_tank",
    hasHeater: false,
    // The one without a cover. Nothing to fit, so nothing to ask for.
    cover: "none",
    // Seasonal: false while it is stowed, so it raises no freeze chore.
    active: false,
    notes: "Static tank, put out only when the West Pen is in use. No cover for this one.",
  },
];

/**
 * Nine zones, not the six the sketch first suggested.
 *
 * The tub holds cattle during drop-offs and staging, the hay area turned out
 * to be a field cattle can graze, and the neighbour's pasture is in regular
 * use. Baseline safety levels are a first guess and expected to be corrected —
 * they are the one field here nobody has confirmed.
 */
export const SEED_ZONES: readonly SeedZone[] = [
  {
    key: "pasture",
    name: "Pasture",
    type: "pasture",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pasture"],
    resting: false,
    customInstructions: "Cross-fence on the sketch is dashed — unconfirmed whether it exists.",
  },
  {
    key: "hay-field",
    name: "Hay Field",
    type: "pasture",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pasture"],
    resting: false,
    customInstructions: "Hay is stored in a section of it; cattle can graze the rest.",
  },
  {
    key: "west-pen",
    name: "West Pen",
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-west"],
    resting: false,
    customInstructions: "Not plumbed. Water only when the static tank is put out.",
  },
  {
    key: "pen-1",
    name: "Pen 1",
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pens-12"],
    resting: false,
  },
  {
    key: "pen-2",
    name: "2nd Pen",
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pens-12"],
    resting: false,
  },
  {
    key: "pen-a",
    name: "Pen A",
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pens-ab"],
    resting: false,
  },
  {
    key: "pen-b",
    name: "Pen B",
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pens-ab"],
    resting: false,
  },
  {
    key: "tub",
    name: "Tub / chute",
    type: "working_facility",
    indoor: false,
    // Handling facility: the place itself is the hazard, whatever is in it.
    baselineSafetyLevel: 3,
    waterSourceKeys: [],
    resting: false,
    customInstructions: "Holds cattle during drop-offs, pickups, and staging. Nothing lives here.",
  },
  {
    key: "randys",
    name: "Randy's pasture",
    type: "pasture",
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceKeys: ["tank-pens-12"],
    resting: false,
    customInstructions: "The neighbour's land, used on and off. Not ours — no boundary drawn.",
  },
];

/**
 * Andromeda, bred 14 February 2026 by AI to ZNT Montego Bay.
 *
 * At the spec's flat 283-day gestation (§12, decision 2) that projects to
 * 24 November 2026, with the window opening on the 10th.
 */
export const SEED_ANIMALS = [
  {
    key: "andromeda",
    species: "cattle" as const,
    name: "Andromeda",
    sex: "female" as const,
    dobIsEstimate: true,
    status: "active" as const,
    ownership: "own" as const,
    safetyLevel: 2 as const,
    notes: 'Called "Andy". Bred 14 Feb 2026 by AI to ZNT Montego Bay.',
    zoneKey: "pasture",
    // "primary" is the slot every animal has. The second and third exist for
    // client calves, which hold an inside and an outside assignment at once
    // (§5.1) — this cow is neither.
    slot: "primary" as const,
  },
];

export const SEED_PROPERTY = {
  name: "Flying Double M",
  address: "1220 County Road 4651, Rhome TX 76078",
  timezone: "America/Chicago",
  // Wise County reads 8a on the 2023 USDA map, against Fort Worth's 8a/8b.
  // Recorded as 8a and flagged for confirmation rather than inherited.
  growingZone: "8a",
} as const;
