import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  SPECIES,
  unitSchema,
  type Species,
  type BaseRecord,
  type Money,
  type Unit,
} from "@galaxy-farm/core";

import { measureToPounds } from "./grain-measures.js";

/**
 * What gets fed, as a catalogue entry (spec §5.3).
 *
 * Cross-species by design: the same round bale feeds cattle and the same
 * scratch feeds chickens, and §4.1 puts feed in one module rather than one per
 * animal type so the run-out projection is written once.
 */

/**
 * What kind of feed it is, and so who eats it.
 *
 * The category is what makes the app know a feed: kibble is for dogs and cats,
 * crickets are for the gecko, layer pellets are for the hens, and a mineral
 * tub is for cattle and horses. A plan only offers the feeds whose category
 * suits its species, so a ration for the dogs never lists hay. Each one also
 * says whether it is a feed, a supplement or a treat, because a supplement is
 * a different line in a sitter's instructions ("dust the crickets") and a
 * different question when the bag runs out.
 *
 * `supplement` suits everybody: vitamins and joint powders exist for every
 * species, and a cross-species catch-all is better than a supplement nobody
 * can put on a plan.
 */
export const FEED_CATEGORIES = [
  "hay",
  "haylage",
  "grain",
  "pellets",
  "creep",
  "mineral",
  "lick",
  "layer_feed",
  "starter_feed",
  "scratch",
  "grit",
  "oyster_shell",
  "dry_food",
  "wet_food",
  "raw_food",
  "live_insects",
  "frozen_prey",
  "calcium_dust",
  "treat",
  "supplement",
] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export const FEED_ROLES = ["feed", "supplement", "treat"] as const;
export type FeedRole = (typeof FEED_ROLES)[number];

const LARGE: readonly Species[] = ["cattle", "horse"];
const POULTRY: readonly Species[] = ["chicken", "quail"];
const DOGS_AND_CATS: readonly Species[] = ["dog", "cat"];

export const FEED_CATEGORY_INFO: Readonly<
  Record<
    FeedCategory,
    { readonly label: string; readonly role: FeedRole; readonly species: readonly Species[] }
  >
> = {
  hay: { label: "Hay", role: "feed", species: LARGE },
  haylage: { label: "Haylage or silage", role: "feed", species: LARGE },
  grain: { label: "Grain", role: "feed", species: LARGE },
  pellets: { label: "Pellets or complete feed", role: "feed", species: LARGE },
  creep: { label: "Creep feed", role: "feed", species: ["cattle"] },
  mineral: { label: "Mineral", role: "supplement", species: LARGE },
  lick: { label: "Protein tub or lick", role: "supplement", species: LARGE },
  layer_feed: { label: "Layer feed", role: "feed", species: POULTRY },
  starter_feed: { label: "Starter or grower", role: "feed", species: POULTRY },
  scratch: { label: "Scratch", role: "treat", species: POULTRY },
  grit: { label: "Grit", role: "supplement", species: POULTRY },
  oyster_shell: { label: "Oyster shell", role: "supplement", species: POULTRY },
  dry_food: { label: "Dry food (kibble)", role: "feed", species: DOGS_AND_CATS },
  wet_food: { label: "Wet food", role: "feed", species: DOGS_AND_CATS },
  raw_food: { label: "Raw food", role: "feed", species: DOGS_AND_CATS },
  live_insects: { label: "Live insects", role: "feed", species: ["reptile"] },
  frozen_prey: { label: "Frozen prey", role: "feed", species: ["reptile"] },
  calcium_dust: { label: "Calcium or vitamin dust", role: "supplement", species: ["reptile"] },
  treat: { label: "Treats", role: "treat", species: [...DOGS_AND_CATS, "horse", ...POULTRY] },
  supplement: { label: "Supplement", role: "supplement", species: SPECIES },
};

/** Does a feed of this category suit that species? */
export function suits(category: FeedCategory, species: Species): boolean {
  return FEED_CATEGORY_INFO[category]?.species.includes(species) ?? false;
}

/** The categories a species eats, in catalogue order. */
export function categoriesFor(species: Species): FeedCategory[] {
  return FEED_CATEGORIES.filter((category) => suits(category, species));
}

/**
 * The category picker's options: "Live insects — reptiles", "Hay — cattle and
 * horses". Saying who eats it is what lets somebody pick the right one for a
 * feed they have never filed before, and the plan editor offers by it.
 */
export function categoryOptions(
  speciesWord: (species: Species) => string,
): { readonly value: FeedCategory; readonly label: string }[] {
  return FEED_CATEGORIES.map((category) => {
    const info = FEED_CATEGORY_INFO[category];
    const who =
      info.species.length === SPECIES.length
        ? "any animal"
        : info.species
            .map(speciesWord)
            .reduce(
              (text, word, index, all) =>
                index === 0
                  ? word
                  : index === all.length - 1
                    ? `${text} and ${word}`
                    : `${text}, ${word}`,
              "",
            );
    return { value: category, label: `${info.label} — ${who}` };
  });
}

/** A feed's role — feed, supplement or treat — from its category. */
export function roleOf(feed: Pick<FeedType, "category">): FeedRole {
  return FEED_CATEGORY_INFO[feed.category]?.role ?? "feed";
}

/**
 * The units feed is bought and fed in.
 *
 * A subset of the kernel's `UNITS` rather than a second vocabulary — §5.3
 * writes `bulk_lb` and `bulk_ton` where the kernel says `lb` and `ton`, and
 * two names for one unit is how a conversion ends up applied twice.
 */
export const FEED_UNITS = [
  "round_bale",
  "square_bale",
  "bag",
  "bucket",
  "scoop",
  "block",
  "lb",
  "ton",
  "oz",
  "cup",
  "can",
  "each",
] as const;
export type FeedUnit = (typeof FEED_UNITS)[number];

export interface FeedType extends BaseRecord {
  readonly name: string;
  readonly category: FeedCategory;
  readonly unit: FeedUnit;
  /**
   * Pounds in one unit, where the unit is not already a weight.
   *
   * A round bale is anywhere from 800 to 1,400 lb depending on who baled it,
   * so this is the number that makes "three bales" and "40 lb a head a day"
   * comparable at all.
   */
  readonly estWeightLbPerUnit?: number | undefined;
  readonly currentUnitCost?: Money | undefined;
  /** How long the supplier takes, which is what the reorder alert leads by. */
  readonly reorderLeadDays: number;
  /** On-hand at or below this raises a low-stock notification. */
  readonly reorderThreshold?: number | undefined;
  readonly active: boolean;
  readonly notes?: string | undefined;
}

export const feedTypeSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A feed needs a name").max(120),
  category: z.enum(FEED_CATEGORIES),
  unit: unitSchema.refine(
    (unit): unit is FeedUnit => (FEED_UNITS as readonly Unit[]).includes(unit),
    "That is not a unit feed is bought in",
  ),
  estWeightLbPerUnit: z.number().positive().max(3000).optional(),
  currentUnitCost: moneySchema.optional(),
  reorderLeadDays: z.number().int().min(0).max(180),
  reorderThreshold: z.number().min(0).optional(),
  active: z.boolean(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<FeedType>;

/**
 * Pounds in a quantity of this feed, where that can be worked out.
 *
 * The feed's own figure wins wherever it has one — a round bale is anywhere
 * from 800 to 1,400 lb and only the person who bought it knows which. Failing
 * that, the barn's own vessels have known weights: a bag is 50 lb, a bucket
 * half that, a scoop an eighteenth. Anything else comes back undefined rather
 * than guessed, because a made-up weight per unit propagates into a run-out
 * date somebody drives to town on.
 */
export function poundsOf(
  feedType: Pick<FeedType, "unit" | "estWeightLbPerUnit">,
  amount: number,
): number | undefined {
  if (feedType.unit === "lb") return amount;
  if (feedType.unit === "ton") return amount * 2000;
  if (feedType.estWeightLbPerUnit !== undefined) return amount * feedType.estWeightLbPerUnit;
  return measureToPounds(amount, feedType.unit);
}

/**
 * Pounds in an amount of this feed, given in some *other* unit.
 *
 * A ration is written in what it is fed in and stock is counted in what it is
 * bought in, and those are routinely different: cubes come in bags and go out
 * in scoops. Everything downstream — the run-out date, the cost split — is in
 * the unit the feed is counted in, so the two have to be reconciled somewhere,
 * and pounds is the only thing they have in common.
 *
 * The feed's own weight per unit applies to the unit it is catalogued in and
 * nowhere else. A 1,200 lb round bale says nothing about what a scoop of it
 * weighs, and borrowing the figure would report a scoop as most of a ton.
 */
export function poundsIn(
  feedType: Pick<FeedType, "unit" | "estWeightLbPerUnit">,
  amount: number,
  unit: Unit,
): number | undefined {
  if (unit === feedType.unit) return poundsOf(feedType, amount);
  return measureToPounds(amount, unit);
}

/**
 * An amount of this feed, restated in the unit the feed is counted in.
 *
 * Undefined when there is no honest answer — a feed catalogued in a unit
 * nobody has given a weight for, fed in a different one. Undefined rather than
 * the raw number, because passing scoops off as bags is an eighteen-fold error
 * in the direction that empties a barn without warning, and it is the sort of
 * error every screen downstream would render without comment.
 */
export function inFeedUnit(
  feedType: Pick<FeedType, "unit" | "estWeightLbPerUnit">,
  amount: number,
  unit: Unit,
): number | undefined {
  if (unit === feedType.unit) return amount;

  const pounds = poundsIn(feedType, amount, unit);
  const perUnit = poundsOf(feedType, 1);
  if (pounds === undefined || perUnit === undefined || perUnit === 0) return undefined;

  return pounds / perUnit;
}
