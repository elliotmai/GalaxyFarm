import { gardenEntryFor } from "./families.js";
import { GARDEN_KINDS } from "./kinds.js";

/**
 * How a crop is grown, filled in for the gardener (spec §5.5).
 *
 * Picking "Tomato" from the plant search used to fill the name, the scientific
 * name and the family, and leave every field somebody actually plants by
 * blank. This is the rest of the packet: how long until there is something to
 * pick, how far apart, cool or warm season, how much sun, whether it is sown
 * where it grows or started inside and set out, whether it comes back next
 * year, and how deep the seed goes.
 *
 * Two sources, the same order as the family:
 *
 * 1. **The built-in table** below, for every crop the family table knows.
 *    Typical figures for a kitchen garden in the US, offline, every time —
 *    a variety's packet will differ, which is why the variety keeps its own
 *    days and spacing and the crop's are only what a new variety starts with.
 * 2. **Growstuff** (`growstuff.org`, open data), looked up by the web app for
 *    a plant the table has never heard of. Crowd figures, often partial:
 *    whatever it has is filled in and the rest is left for the gardener.
 *
 * Every field is optional and every one stays editable. A fact filled in here
 * is a starting point, not a rule.
 */

export const SEASONS = ["cool", "warm"] as const;
export type Season = (typeof SEASONS)[number];

export const LIFECYCLES = ["annual", "biennial", "perennial"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const SUN_NEEDS = ["full", "partial", "shade"] as const;
export type SunNeed = (typeof SUN_NEEDS)[number];

export const SOWING_METHODS = ["direct", "transplant", "either"] as const;
export type SowingMethod = (typeof SOWING_METHODS)[number];

/**
 * How much cold a plant takes — the question every planting date hangs on.
 *
 * `tender` dies at a frost and goes out after the last one (tomatoes, beans,
 * squash). `half_hardy` shrugs off a light frost and goes out a couple of
 * weeks before it (lettuce, carrots, beets). `hardy` takes a hard frost and
 * goes out a month or more early (peas, spinach, kale, onions). "Season" was
 * standing in for this and got it wrong both ways: a lettuce is cool-season
 * and still cannot take what a kale can.
 */
export const FROST_TOLERANCES = ["tender", "half_hardy", "hardy"] as const;
export type FrostTolerance = (typeof FROST_TOLERANCES)[number];

export const FROST_TOLERANCE_LABELS: Readonly<Record<FrostTolerance, string>> = {
  tender: "Tender — killed by frost",
  half_hardy: "Half-hardy — takes a light frost",
  hardy: "Hardy — takes a hard frost",
};

export const SEASON_LABELS: Readonly<Record<Season, string>> = {
  cool: "Cool season",
  warm: "Warm season",
};

export const LIFECYCLE_LABELS: Readonly<Record<Lifecycle, string>> = {
  annual: "Annual",
  biennial: "Biennial",
  perennial: "Perennial",
};

export const SUN_LABELS: Readonly<Record<SunNeed, string>> = {
  full: "Full sun",
  partial: "Part sun",
  shade: "Shade",
};

export const SOWING_LABELS: Readonly<Record<SowingMethod, string>> = {
  direct: "Sow direct",
  transplant: "Start inside, transplant",
  either: "Sow direct or transplant",
};

export interface GrowingFacts {
  /** From sowing for a direct-sown crop, from setting out for a transplant. */
  readonly daysToMaturity?: number | undefined;
  /** Between plants in the row. */
  readonly spacingInches?: number | undefined;
  /** Left out for perennials, which are not planted by season. */
  readonly season?: Season | undefined;
  readonly lifecycle?: Lifecycle | undefined;
  readonly sun?: SunNeed | undefined;
  readonly sowing?: SowingMethod | undefined;
  /** How deep the seed (or set, clove, crown) goes. */
  readonly depthInches?: number | undefined;
  readonly frostTolerance?: FrostTolerance | undefined;
  /** Days from sowing to seedlings showing — when to stop worrying. */
  readonly germinationDays?: number | undefined;
  /** Weeks before the last spring frost to sow indoors, for a transplant. */
  readonly startIndoorsWeeks?: number | undefined;
  /**
   * When it goes in outside, in weeks from the last spring frost: −4 is a
   * month before (peas), +2 a fortnight after (tomatoes). Transplanted or
   * sown, whichever this crop is.
   */
  readonly plantOutWeeks?: number | undefined;
  /**
   * Weeks before the first fall frost to plant, for a crop that goes in in
   * the fall to overwinter — garlic. Spring crops leave it out.
   */
  readonly fallPlantWeeks?: number | undefined;
  /** How long there is something to pick once it starts, in weeks. */
  readonly harvestWeeks?: number | undefined;
  /** Days between sowings for a steady supply — lettuce, radishes, beans. */
  readonly successionDays?: number | undefined;
}

/**
 * [frost tolerance, germination days, weeks indoors, plant out (weeks from
 * last frost), harvest weeks, succession days, fall plant weeks]
 *
 * Typical figures from US extension planting guides, rounded to what a
 * gardener plans by. A variety's packet will differ; every one is editable.
 */
type TimingRow = readonly [
  FrostTolerance,
  number | undefined,
  number | undefined,
  number | undefined,
  number | undefined,
  number | undefined,
  number | undefined,
];

const TIMING: Readonly<Record<string, TimingRow>> = {
  Tomato: ["tender", 7, 7, 2, 8, undefined, undefined],
  Pepper: ["tender", 10, 9, 2, 10, undefined, undefined],
  Potato: ["half_hardy", 14, undefined, -2, 3, undefined, undefined],
  Eggplant: ["tender", 10, 9, 2, 8, undefined, undefined],
  Tomatillo: ["tender", 8, 7, 2, 8, undefined, undefined],
  Cabbage: ["hardy", 6, 6, -4, 3, undefined, undefined],
  Kale: ["hardy", 6, 6, -4, 10, 21, undefined],
  Broccoli: ["hardy", 6, 6, -2, 4, undefined, undefined],
  Cauliflower: ["half_hardy", 6, 6, -2, 2, undefined, undefined],
  "Brussels sprouts": ["hardy", 6, 6, -2, 6, undefined, undefined],
  Kohlrabi: ["hardy", 5, undefined, -4, 3, 14, undefined],
  Turnip: ["hardy", 5, undefined, -3, 4, 14, undefined],
  Mustard: ["hardy", 5, undefined, -4, 4, 14, undefined],
  Radish: ["hardy", 4, undefined, -4, 2, 10, undefined],
  Arugula: ["hardy", 5, undefined, -4, 3, 14, undefined],
  Rutabaga: ["hardy", 6, undefined, -2, 4, undefined, undefined],
  Cucumber: ["tender", 7, 3, 2, 6, 21, undefined],
  Squash: ["tender", 7, 3, 2, 8, undefined, undefined],
  Melon: ["tender", 7, 4, 2, 4, undefined, undefined],
  Watermelon: ["tender", 8, 4, 2, 4, undefined, undefined],
  Gourd: ["tender", 8, undefined, 2, 4, undefined, undefined],
  Bean: ["tender", 8, undefined, 1, 4, 14, undefined],
  Pea: ["hardy", 10, undefined, -6, 4, undefined, undefined],
  "Southern pea": ["tender", 8, undefined, 3, 6, undefined, undefined],
  "Lima bean": ["tender", 10, undefined, 2, 6, undefined, undefined],
  "Fava bean": ["hardy", 10, undefined, -6, 4, undefined, undefined],
  Peanut: ["tender", 10, undefined, 3, 2, undefined, undefined],
  Soybean: ["tender", 7, undefined, 2, 3, undefined, undefined],
  Onion: ["hardy", 10, 10, -4, 4, undefined, undefined],
  Garlic: ["hardy", 14, undefined, undefined, 3, undefined, 4],
  Leek: ["hardy", 10, 10, -4, 8, undefined, undefined],
  Chives: ["hardy", 10, 8, -4, 12, undefined, undefined],
  Carrot: ["half_hardy", 14, undefined, -3, 4, 21, undefined],
  Parsnip: ["hardy", 18, undefined, -3, 6, undefined, undefined],
  Celery: ["half_hardy", 14, 10, 1, 6, undefined, undefined],
  Parsley: ["hardy", 21, 8, -3, 12, undefined, undefined],
  Dill: ["half_hardy", 14, undefined, 0, 4, 21, undefined],
  Cilantro: ["hardy", 10, undefined, -2, 3, 21, undefined],
  Fennel: ["half_hardy", 10, undefined, 0, 4, undefined, undefined],
  Lettuce: ["half_hardy", 7, 5, -3, 4, 14, undefined],
  Sunflower: ["tender", 10, undefined, 1, 3, 14, undefined],
  Artichoke: ["half_hardy", 14, 10, 1, 8, undefined, undefined],
  Endive: ["half_hardy", 7, 6, -2, 4, undefined, undefined],
  Zinnia: ["tender", 7, undefined, 1, 12, undefined, undefined],
  Marigold: ["tender", 7, 6, 1, 12, undefined, undefined],
  Beet: ["half_hardy", 7, undefined, -3, 4, 21, undefined],
  "Swiss chard": ["half_hardy", 7, undefined, -2, 12, undefined, undefined],
  Spinach: ["hardy", 10, undefined, -6, 3, 14, undefined],
  Amaranth: ["tender", 10, undefined, 2, 6, undefined, undefined],
  Quinoa: ["half_hardy", 7, undefined, -2, 2, undefined, undefined],
  Corn: ["tender", 7, undefined, 2, 2, 14, undefined],
  Sorghum: ["tender", 10, undefined, 3, 2, undefined, undefined],
  Wheat: ["hardy", 7, undefined, -6, 2, undefined, 6],
  Okra: ["tender", 10, undefined, 3, 10, undefined, undefined],
  Cotton: ["tender", 10, undefined, 3, 4, undefined, undefined],
  Basil: ["tender", 7, 6, 2, 10, 21, undefined],
  Mint: ["hardy", 14, 8, -2, 16, undefined, undefined],
  Oregano: ["hardy", 10, 8, 0, 16, undefined, undefined],
  Thyme: ["hardy", 14, 8, 0, 16, undefined, undefined],
  Rosemary: ["half_hardy", 21, 10, 1, 20, undefined, undefined],
  Sage: ["hardy", 14, 8, 0, 16, undefined, undefined],
  "Sweet potato": ["tender", undefined, 6, 3, 4, undefined, undefined],
  Strawberry: ["hardy", undefined, undefined, -4, 4, undefined, undefined],
  Blackberry: ["hardy", undefined, undefined, -4, 4, undefined, undefined],
  Blueberry: ["hardy", undefined, undefined, -4, 6, undefined, undefined],
  Asparagus: ["hardy", undefined, undefined, -4, 8, undefined, undefined],
  Rhubarb: ["hardy", undefined, undefined, -4, 8, undefined, undefined],
};

function timingFrom(row: TimingRow | undefined): GrowingFacts {
  if (row === undefined) return {};
  const [
    frostTolerance,
    germinationDays,
    startIndoorsWeeks,
    plantOutWeeks,
    harvestWeeks,
    successionDays,
    fallPlantWeeks,
  ] = row;
  const defined = <K extends keyof GrowingFacts>(key: K, value: GrowingFacts[K]) =>
    value === undefined ? {} : { [key]: value };
  return {
    frostTolerance,
    ...defined("germinationDays", germinationDays),
    ...defined("startIndoorsWeeks", startIndoorsWeeks),
    ...defined("plantOutWeeks", plantOutWeeks),
    ...defined("harvestWeeks", harvestWeeks),
    ...defined("successionDays", successionDays),
    ...defined("fallPlantWeeks", fallPlantWeeks),
  };
}

/** [days, spacing", season, lifecycle, sun, sowing, depth"] — read once into `GROWING`. */
type Row = readonly [
  number | undefined,
  number | undefined,
  Season | undefined,
  Lifecycle,
  SunNeed,
  SowingMethod,
  number | undefined,
];

/** Keyed by the family table's `name`, so an alias ("aubergine") finds its row. */
const ROWS: Readonly<Record<string, Row>> = {
  // Nightshades
  Tomato: [75, 24, "warm", "annual", "full", "transplant", 0.25],
  Pepper: [70, 18, "warm", "annual", "full", "transplant", 0.25],
  Potato: [90, 12, "cool", "annual", "full", "direct", 4],
  Eggplant: [75, 24, "warm", "annual", "full", "transplant", 0.25],
  Tomatillo: [75, 36, "warm", "annual", "full", "transplant", 0.25],
  // Brassicas
  Cabbage: [70, 18, "cool", "annual", "full", "transplant", 0.25],
  Kale: [55, 18, "cool", "annual", "full", "either", 0.5],
  Broccoli: [65, 18, "cool", "annual", "full", "transplant", 0.25],
  Cauliflower: [70, 18, "cool", "annual", "full", "transplant", 0.25],
  "Brussels sprouts": [100, 24, "cool", "annual", "full", "transplant", 0.25],
  Kohlrabi: [50, 6, "cool", "annual", "full", "direct", 0.25],
  Turnip: [50, 4, "cool", "annual", "full", "direct", 0.5],
  Mustard: [40, 6, "cool", "annual", "partial", "direct", 0.25],
  Radish: [25, 2, "cool", "annual", "full", "direct", 0.5],
  Arugula: [40, 6, "cool", "annual", "partial", "direct", 0.25],
  Rutabaga: [90, 8, "cool", "annual", "full", "direct", 0.5],
  // Cucurbits
  Cucumber: [55, 12, "warm", "annual", "full", "direct", 1],
  Squash: [60, 36, "warm", "annual", "full", "direct", 1],
  Melon: [85, 36, "warm", "annual", "full", "either", 1],
  Watermelon: [85, 48, "warm", "annual", "full", "direct", 1],
  Gourd: [100, 36, "warm", "annual", "full", "direct", 1],
  // Legumes
  Bean: [55, 4, "warm", "annual", "full", "direct", 1],
  Pea: [60, 2, "cool", "annual", "full", "direct", 1],
  "Southern pea": [70, 4, "warm", "annual", "full", "direct", 1],
  "Lima bean": [75, 6, "warm", "annual", "full", "direct", 1],
  "Fava bean": [85, 6, "cool", "annual", "full", "direct", 2],
  Peanut: [120, 8, "warm", "annual", "full", "direct", 1.5],
  Soybean: [85, 4, "warm", "annual", "full", "direct", 1],
  // Alliums
  Onion: [100, 4, "cool", "annual", "full", "transplant", 0.5],
  Garlic: [240, 6, "cool", "annual", "full", "direct", 2],
  Leek: [120, 6, "cool", "annual", "full", "transplant", 0.25],
  Chives: [80, 8, undefined, "perennial", "full", "either", 0.25],
  // Umbellifers
  Carrot: [70, 2, "cool", "annual", "full", "direct", 0.25],
  Parsnip: [110, 4, "cool", "annual", "full", "direct", 0.5],
  Celery: [120, 8, "cool", "annual", "full", "transplant", 0.125],
  Parsley: [75, 8, "cool", "biennial", "full", "either", 0.25],
  Dill: [50, 12, "cool", "annual", "full", "direct", 0.25],
  Cilantro: [45, 6, "cool", "annual", "full", "direct", 0.25],
  Fennel: [80, 12, "cool", "annual", "full", "direct", 0.25],
  // Daisies
  Lettuce: [50, 8, "cool", "annual", "partial", "either", 0.25],
  Sunflower: [80, 18, "warm", "annual", "full", "direct", 1],
  Artichoke: [150, 48, undefined, "perennial", "full", "transplant", 0.25],
  Endive: [85, 10, "cool", "annual", "partial", "either", 0.25],
  Zinnia: [70, 12, "warm", "annual", "full", "direct", 0.25],
  Marigold: [60, 10, "warm", "annual", "full", "either", 0.25],
  // Amaranths
  Beet: [55, 3, "cool", "annual", "full", "direct", 0.5],
  "Swiss chard": [55, 8, "cool", "annual", "full", "direct", 0.5],
  Spinach: [45, 4, "cool", "annual", "partial", "direct", 0.5],
  Amaranth: [60, 12, "warm", "annual", "full", "direct", 0.25],
  Quinoa: [100, 12, "cool", "annual", "full", "direct", 0.25],
  // Grasses
  Corn: [80, 10, "warm", "annual", "full", "direct", 1.5],
  Sorghum: [100, 6, "warm", "annual", "full", "direct", 1],
  Wheat: [120, 1, "cool", "annual", "full", "direct", 1],
  // Mallows
  Okra: [60, 12, "warm", "annual", "full", "direct", 0.75],
  Cotton: [150, 12, "warm", "annual", "full", "direct", 1],
  // Herbs
  Basil: [60, 12, "warm", "annual", "full", "either", 0.25],
  Mint: [90, 18, undefined, "perennial", "partial", "transplant", 0.25],
  Oregano: [90, 12, undefined, "perennial", "full", "transplant", 0.25],
  Thyme: [90, 12, undefined, "perennial", "full", "transplant", 0.125],
  Rosemary: [180, 24, undefined, "perennial", "full", "transplant", 0.25],
  Sage: [75, 24, undefined, "perennial", "full", "transplant", 0.25],
  // Everything else
  "Sweet potato": [100, 12, "warm", "annual", "full", "transplant", 4],
  // Perennial fruit and stalks: no days figure — the first picking is a year
  // or more out and depends on what was planted, not on a packet.
  Strawberry: [undefined, 12, undefined, "perennial", "full", "transplant", undefined],
  Blackberry: [undefined, 36, undefined, "perennial", "full", "transplant", undefined],
  Blueberry: [undefined, 48, undefined, "perennial", "full", "transplant", undefined],
  Asparagus: [undefined, 18, undefined, "perennial", "full", "transplant", 6],
  Rhubarb: [undefined, 36, undefined, "perennial", "full", "transplant", 2],
};

function factsFrom(row: Row): GrowingFacts {
  const [daysToMaturity, spacingInches, season, lifecycle, sun, sowing, depthInches] = row;
  return {
    ...(daysToMaturity === undefined ? {} : { daysToMaturity }),
    ...(spacingInches === undefined ? {} : { spacingInches }),
    ...(season === undefined ? {} : { season }),
    lifecycle,
    sun,
    sowing,
    ...(depthInches === undefined ? {} : { depthInches }),
  };
}

const CROP_GROWING: ReadonlyMap<string, GrowingFacts> = new Map(
  Object.entries(ROWS).map(([name, row]) => [
    name,
    { ...factsFrom(row), ...timingFrom(TIMING[name]) },
  ]),
);

/**
 * Every row by the table's name — crops, and each kind as its crop's facts
 * with its own figures on top. Exported for the test.
 */
export const GROWING: ReadonlyMap<string, GrowingFacts> = new Map([
  ...CROP_GROWING,
  ...GARDEN_KINDS.flatMap((kind): Array<[string, GrowingFacts]> => {
    const crop = CROP_GROWING.get(kind.crop);
    return crop === undefined ? [] : [[kind.name, { ...crop, ...(kind.growing ?? {}) }]];
  }),
]);

/**
 * The table's growing facts for a crop name ("Cherokee Purple tomato" finds
 * the tomato's), or undefined for a plant it does not know.
 */
export function growingFor(name: string | undefined): GrowingFacts | undefined {
  const crop = gardenEntryFor(name);
  return crop === undefined ? undefined : GROWING.get(crop.name);
}

const GROWING_KEYS = [
  "daysToMaturity",
  "spacingInches",
  "season",
  "lifecycle",
  "sun",
  "sowing",
  "depthInches",
  "frostTolerance",
  "germinationDays",
  "startIndoorsWeeks",
  "plantOutWeeks",
  "fallPlantWeeks",
  "harvestWeeks",
  "successionDays",
] as const satisfies ReadonlyArray<keyof GrowingFacts>;

export { GROWING_KEYS };

/**
 * True when there is nothing in it worth filling a form with. Reads only the
 * growing fields, so a whole crop record can be asked.
 */
export function isEmptyGrowing(facts: GrowingFacts | undefined): boolean {
  return facts === undefined || GROWING_KEYS.every((key) => facts[key] === undefined);
}

/**
 * How a crop record grows: what it carries, else the table's figures for its
 * name — the same fallback the family has, so a crop saved before these
 * fields existed still says how it grows, and still starts a new variety off.
 */
export function cropGrowing(
  crop: (GrowingFacts & { readonly name: string }) | undefined,
): GrowingFacts | undefined {
  if (crop === undefined) return undefined;
  const table = growingFor(crop.name);
  if (isEmptyGrowing(crop)) return table;
  // Field by field: what the crop says wins, and the table fills the rest.
  // A crop saved before the timing facts existed still gets them, rather than
  // a crop with its seven old facts and no idea when to sow.
  const own = Object.fromEntries(
    GROWING_KEYS.filter((key) => crop[key] !== undefined).map((key) => [key, crop[key]]),
  ) as GrowingFacts;
  return { ...(table ?? {}), ...own };
}

/**
 * "Warm season · 75 days · 24" apart · full sun" — the crop list's line.
 *
 * Sowing and depth are left to the form: the line is for telling crops apart
 * at a glance, and four facts is already a lot of line.
 */
export function growingLine(facts: GrowingFacts | undefined): string | undefined {
  if (facts === undefined) return undefined;
  const parts = [
    facts.season === undefined
      ? facts.lifecycle === "perennial"
        ? "Perennial"
        : undefined
      : SEASON_LABELS[facts.season],
    facts.daysToMaturity === undefined ? undefined : `${facts.daysToMaturity} days`,
    facts.spacingInches === undefined ? undefined : `${facts.spacingInches}" apart`,
    facts.sun === undefined ? undefined : SUN_LABELS[facts.sun].toLowerCase(),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}
