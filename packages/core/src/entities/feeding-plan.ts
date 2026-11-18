import { z } from "zod";

import { quantitySchema, type Quantity } from "../value-objects/quantity.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { SPECIES, type Species } from "./animal.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * What a group of animals is fed, where, and in what (spec §5.1, decision 49).
 *
 * A plan owns its animals. It used to be aimed at one animal, a pen, or the
 * whole place, with the animals sharing it bolted on as `alsoFeeds`, and a
 * plan aimed at a pen fed whoever happened to be standing in it. That read
 * backwards to everybody who used it — nobody thinks "this pen has a ration";
 * they think "the heifers get this" — and it let one plan feed a dog and a cow
 * out of the same scoop.
 *
 * So: a plan names one species and the animals of that species it feeds. For
 * poultry, which are counted rather than named, it names flocks. Amounts are
 * either for each animal or for all of them between them. It says where they
 * are fed, and each line says what the feed goes in — hay in a ring and grain
 * in a bunk are one plan with two receptacles, not two plans.
 */

/**
 * How often a line is fed.
 *
 * Stored as a named frequency rather than a number of feedings per day,
 * because "twice daily" is what somebody says at the bunk and `2` is what the
 * projection needs. `feedingsPerDay` converts; nothing else has to know.
 */
export const FEEDING_FREQUENCIES = [
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "every_other_day",
  "twice_weekly",
  "weekly",
] as const;
export type FeedingFrequency = (typeof FEEDING_FREQUENCIES)[number];

export const TIMES_OF_DAY = ["morning", "midday", "evening", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/**
 * Whether an amount is what each animal gets, or what they all get together.
 *
 * Both are common, and confusing them is expensive in either direction. Forty
 * pounds of hay "each" on a pen of four read as a total empties the barn in a
 * quarter of the time; two cats' one bowl read as "each" puts the run-out date
 * weeks after the bag is empty.
 */
export const PORTIONS = ["each", "total"] as const;
export type Portion = (typeof PORTIONS)[number];

/* ------------------------------------------------------------- receptacles */

/**
 * What the feed goes in.
 *
 * It is on the plan because a housesitter needs it — "a scoop in the black
 * pan" is a job somebody can do; "a scoop" is a question — and because which
 * receptacles exist depends entirely on the animal. Each one names the species
 * it belongs to, so a gecko's plan never offers a hay ring and a cow's never
 * offers tongs.
 */
export const RECEPTACLES = [
  "bowl",
  "slow_feeder",
  "dish",
  "tongs",
  "pan",
  "bucket",
  "bunk",
  "trough",
  "tub",
  "hay_ring",
  "hay_rack",
  "hay_net",
  "creep_feeder",
  "hanging_feeder",
  "ground",
  "by_hand",
] as const;
export type Receptacle = (typeof RECEPTACLES)[number];

const DOGS_AND_CATS: readonly Species[] = ["dog", "cat"];
const POULTRY: readonly Species[] = ["chicken", "quail"];

export const RECEPTACLE_INFO: Readonly<
  Record<Receptacle, { readonly label: string; readonly species: readonly Species[] }>
> = {
  bowl: { label: "Bowl", species: DOGS_AND_CATS },
  slow_feeder: { label: "Slow-feeder bowl", species: DOGS_AND_CATS },
  dish: { label: "Feeding dish", species: ["cat", "reptile"] },
  tongs: { label: "Feeding tongs", species: ["reptile"] },
  pan: { label: "Feed pan", species: ["cattle", "horse"] },
  bucket: { label: "Bucket", species: ["cattle", "horse"] },
  bunk: { label: "Bunk", species: ["cattle"] },
  trough: { label: "Trough", species: ["cattle", "horse", ...POULTRY] },
  tub: { label: "Tub or lick", species: ["cattle", "horse"] },
  hay_ring: { label: "Hay ring", species: ["cattle", "horse"] },
  hay_rack: { label: "Hay rack", species: ["cattle", "horse"] },
  hay_net: { label: "Hay net", species: ["horse"] },
  creep_feeder: { label: "Creep feeder", species: ["cattle"] },
  hanging_feeder: { label: "Hanging feeder", species: POULTRY },
  ground: { label: "On the ground", species: ["cattle", ...POULTRY] },
  by_hand: { label: "By hand", species: SPECIES },
};

/** The receptacles that make sense for a species, in catalogue order. */
export function receptaclesFor(species: Species): Receptacle[] {
  return RECEPTACLES.filter((receptacle) => RECEPTACLE_INFO[receptacle].species.includes(species));
}

/**
 * Places a pet is usually fed, offered as suggestions.
 *
 * A pet has no zone (§5.8) — the kitchen is not a pen — so a pet's plan says
 * where in words, and these are the words most households would use. Livestock
 * are fed in a zone, chosen from the property's own.
 */
export const PET_FEEDING_PLACES: Readonly<Partial<Record<Species, readonly string[]>>> = {
  dog: ["Kitchen", "Laundry room", "Back porch", "Garage", "Kennel"],
  cat: ["Kitchen", "Laundry room", "Back porch", "Garage", "Barn"],
  reptile: ["Enclosure", "Feeding tub"],
};

/* ------------------------------------------------------------------ entity */

export interface FeedingPlanLine {
  readonly feedTypeId: Ulid;
  readonly amount: Quantity;
  readonly frequency: FeedingFrequency;
  readonly timeOfDay: TimeOfDay;
  readonly receptacle?: Receptacle | undefined;
  readonly notes?: string | undefined;
}

export interface FeedingPlan extends BaseRecord {
  readonly name: string;
  /** One kind of animal per plan: a dog's and a cow's food never share a line. */
  readonly species: Species;
  /** The animals this plan feeds, all of `species`. */
  readonly animalIds: readonly Ulid[];
  /** Flocks it feeds — poultry only, counted by headcount rather than named. */
  readonly flockIds: readonly Ulid[];
  /** Is each line what one animal gets, or what they all get together? */
  readonly portion: Portion;
  /** Where they are fed, as a zone — a pen, a stall, the coop. Livestock. */
  readonly placeZoneId?: Ulid | undefined;
  /** Where they are fed, in words — "Kitchen", "the tank". Pets, or a detail. */
  readonly placeLabel?: string | undefined;
  readonly lines: readonly FeedingPlanLine[];
  /** Turned off out of season without losing the plan. */
  readonly active: boolean;
  readonly specialNotes?: string | undefined;
}

export const planLineSchema = z.object({
  feedTypeId: ulidSchema,
  amount: quantitySchema.refine((amount) => amount.amount > 0, {
    message: "How much?",
  }),
  frequency: z.enum(FEEDING_FREQUENCIES),
  timeOfDay: z.enum(TIMES_OF_DAY),
  receptacle: z.enum(RECEPTACLES).optional(),
  notes: z.string().max(500).optional(),
});

export const feedingPlanSchema = baseRecordSchema
  .extend({
    name: z.string().min(1, "A feeding plan needs a name").max(120),
    species: z.enum(SPECIES),
    animalIds: z.array(ulidSchema).default([]),
    flockIds: z.array(ulidSchema).default([]),
    portion: z.enum(PORTIONS).default("each"),
    placeZoneId: ulidSchema.optional(),
    placeLabel: z.string().max(80).optional(),
    lines: z.array(planLineSchema).min(1, "A feeding plan needs at least one feed"),
    active: z.boolean(),
    specialNotes: z.string().max(5000).optional(),
  })
  .refine((plan) => plan.animalIds.length + plan.flockIds.length > 0, {
    message: "Choose who this plan feeds",
    path: ["animalIds"],
  })
  .refine((plan) => plan.flockIds.length === 0 || POULTRY.includes(plan.species), {
    // Only poultry come in flocks; a flock on a horse plan is a wrong tap.
    message: "Only chickens and quail are fed as flocks",
    path: ["flockIds"],
  })
  .refine(
    (plan) =>
      new Set(plan.animalIds).size === plan.animalIds.length &&
      new Set(plan.flockIds).size === plan.flockIds.length,
    {
      // A duplicate would count a head twice, which is the one arithmetic a
      // shared amount exists to get right.
      message: "The same animal is named twice",
      path: ["animalIds"],
    },
  )
  .refine(
    (plan) =>
      plan.lines.every(
        (line) =>
          line.receptacle === undefined ||
          RECEPTACLE_INFO[line.receptacle].species.includes(plan.species),
      ),
    {
      message: "That is not something this animal is fed from",
      path: ["lines"],
    },
  ) as unknown as z.ZodType<FeedingPlan>;

/* ----------------------------------------------------------------- reading */

/**
 * The plan's animals and flocks, read defensively.
 *
 * Records reach these functions off a device's store, and a device that has
 * not pulled since the shape changed still holds the old record for a moment.
 * An old record has no `animalIds`, and a spread over `undefined` would take
 * the screen down; it reads as feeding nobody until the next pull replaces it.
 */
export function animalsOf(plan: Pick<FeedingPlan, "animalIds">): readonly Ulid[] {
  return plan.animalIds ?? [];
}

export function flocksOf(plan: Pick<FeedingPlan, "flockIds">): readonly Ulid[] {
  return plan.flockIds ?? [];
}

/** Does this plan feed that animal? */
export function feedsAnimal(plan: Pick<FeedingPlan, "animalIds">, animalId: Ulid): boolean {
  return animalsOf(plan).includes(animalId);
}

/** Is each amount split between everybody on the plan? */
export function isTotal(plan: Pick<FeedingPlan, "portion">): boolean {
  return plan.portion === "total";
}

/** Feedings per day, averaged — `every_other_day` is 0.5, weekly is 1/7. */
export function feedingsPerDay(frequency: FeedingFrequency): number {
  switch (frequency) {
    case "once_daily":
      return 1;
    case "twice_daily":
      return 2;
    case "three_times_daily":
      return 3;
    case "every_other_day":
      return 0.5;
    case "twice_weekly":
      return 2 / 7;
    case "weekly":
      return 1 / 7;
  }
}

/**
 * How many head a plan is feeding right now.
 *
 * Only the members still here count: a steer sold last week is still named on
 * the plan until somebody tidies it, and must not keep drawing feed. `onFarm`
 * is the set of animals on the place; `flockHeads` is each flock's current
 * headcount.
 */
export function headsOf(
  plan: Pick<FeedingPlan, "animalIds" | "flockIds">,
  onFarm: ReadonlySet<Ulid>,
  flockHeads: ReadonlyMap<Ulid, number> = new Map(),
): number {
  const animals = animalsOf(plan).filter((id) => onFarm.has(id)).length;
  const birds = flocksOf(plan).reduce((sum, id) => sum + (flockHeads.get(id) ?? 0), 0);
  return animals + birds;
}

/**
 * What one plan uses in a day, per feed type (spec §5.3: Σ quantity × frequency).
 *
 * An "each" amount multiplies by the head count; a "total" amount does not —
 * but a plan with nobody left to feed uses nothing either way. Returned per
 * feed type rather than as one total because the units differ: twelve pounds
 * of grain and half a round bale have no meaningful sum.
 */
export function dailyDemandOf(
  plan: Pick<FeedingPlan, "lines" | "active" | "portion">,
  heads: number,
): Map<Ulid, Quantity> {
  const demand = new Map<Ulid, Quantity>();
  if (!plan.active || heads <= 0) return demand;
  const multiplier = isTotal(plan) ? 1 : heads;

  for (const line of plan.lines) {
    const perDay = line.amount.amount * feedingsPerDay(line.frequency) * multiplier;
    const existing = demand.get(line.feedTypeId);

    if (existing === undefined) {
      demand.set(line.feedTypeId, { amount: perDay, unit: line.amount.unit });
      continue;
    }

    // Two lines of the same feed at different times — the classic morning and
    // evening grain split. Same unit or the plan is nonsense, so say so rather
    // than silently keeping one.
    if (existing.unit !== line.amount.unit) {
      throw new Error(
        `Feeding plan mixes units for one feed type: ${existing.unit} and ${line.amount.unit}`,
      );
    }
    demand.set(line.feedTypeId, { amount: existing.amount + perDay, unit: existing.unit });
  }

  return demand;
}

/** The active plans that feed one animal. An animal may be on several. */
export function plansForAnimal(plans: readonly FeedingPlan[], animalId: Ulid): FeedingPlan[] {
  return plans.filter((plan) => plan.active && feedsAnimal(plan, animalId));
}

/** The active plans that feed one flock. */
export function plansForFlock(plans: readonly FeedingPlan[], flockId: Ulid): FeedingPlan[] {
  return plans.filter((plan) => plan.active && flocksOf(plan).includes(flockId));
}

/**
 * The members of `animalIds` whose species is not the plan's.
 *
 * Zod cannot see other records, so the one-species rule is checked here by
 * whoever has the animals to hand — the editor, before it saves.
 */
export function wrongSpecies(
  plan: Pick<FeedingPlan, "species" | "animalIds">,
  animals: readonly { readonly id: Ulid; readonly species: Species }[],
): Ulid[] {
  const speciesById = new Map(animals.map((animal) => [animal.id, animal.species]));
  return animalsOf(plan).filter((id) => {
    const species = speciesById.get(id);
    return species !== undefined && species !== plan.species;
  });
}
