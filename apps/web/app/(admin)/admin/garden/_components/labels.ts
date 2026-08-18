import {
  BED_TYPES,
  GARDEN_CARE_ACTIONS,
  PLANTING_METHODS,
  PLANTING_STATUSES,
  PRESERVATION_METHODS,
  type BedType,
  type GardenCareAction,
  type HarvestLog,
  type PlantingMethod,
  type PlantingStatus,
  type PreservationLog,
  type PreservationMethod,
  type SeedInventory,
} from "@galaxy-farm/module-garden";

/**
 * How the garden's enums read out loud.
 *
 * One table rather than a ternary at each call site, because the three garden
 * screens all name the same things and a method spelled "Indoor start" on one
 * screen and "Start indoors" on another reads as two different operations.
 * `direct_sow` is a database value; nobody says it.
 */

export const BED_TYPE_LABEL: Readonly<Record<BedType, string>> = {
  raised_bed: "Raised bed",
  row: "Row",
  container: "Container",
  in_ground: "In ground",
};

export const BED_TYPE_OPTIONS = BED_TYPES.map((type) => ({
  value: type,
  label: BED_TYPE_LABEL[type],
}));

export const METHOD_LABEL: Readonly<Record<PlantingMethod, string>> = {
  direct_sow: "Direct sow",
  transplant: "Transplant",
  indoor_start: "Indoor start",
};

export const METHOD_OPTIONS = PLANTING_METHODS.map((method) => ({
  value: method,
  label: METHOD_LABEL[method],
}));

export const STATUS_LABEL: Readonly<Record<PlantingStatus, string>> = {
  planned: "Planned",
  started: "Started indoors",
  growing: "Growing",
  harvesting: "Harvesting",
  finished: "Finished",
  failed: "Failed",
};

export const STATUS_OPTIONS = PLANTING_STATUSES.map((status) => ({
  value: status,
  label: STATUS_LABEL[status],
}));

export const CARE_ACTION_LABEL: Readonly<Record<GardenCareAction, string>> = {
  fertilize: "Fertilised",
  water: "Watered",
  weed: "Weeded",
  pest_treatment: "Pest treatment",
  amend: "Amended the soil",
};

export const CARE_ACTION_OPTIONS = GARDEN_CARE_ACTIONS.map((action) => ({
  value: action,
  label: CARE_ACTION_LABEL[action],
}));

export const PRESERVATION_LABEL: Readonly<Record<PreservationMethod, string>> = {
  canned: "Canned",
  frozen: "Frozen",
  dried: "Dried",
  fermented: "Fermented",
};

export const PRESERVATION_OPTIONS = PRESERVATION_METHODS.map((method) => ({
  value: method,
  label: PRESERVATION_LABEL[method],
}));

/** Seed comes in packets and in weights, and the two do not add up. */
export const SEED_UNITS: readonly SeedInventory["unit"][] = ["packet", "gram", "ounce", "seed"];

export const SEED_UNIT_OPTIONS = SEED_UNITS.map((unit) => ({ value: unit, label: unit }));

export const HARVEST_UNITS: readonly HarvestLog["unit"][] = ["lb", "oz", "each", "bunch", "quart"];

export const HARVEST_UNIT_OPTIONS = HARVEST_UNITS.map((unit) => ({ value: unit, label: unit }));

export const PANTRY_UNITS: readonly PreservationLog["unit"][] = [
  "jar",
  "quart",
  "pint",
  "bag",
  "lb",
];

export const PANTRY_UNIT_OPTIONS = PANTRY_UNITS.map((unit) => ({ value: unit, label: unit }));

/** "6 jars", "1 packet" — the unit pluralised only when it is a countable one. */
export function quantityLabel(quantity: number, unit: string): string {
  const rounded = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
  const countable = ["packet", "seed", "jar", "quart", "pint", "bag", "bunch"].includes(unit);
  return `${rounded} ${countable && quantity !== 1 ? `${unit}s` : unit}`;
}

export function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** What a `<input type="date">` wants, in UTC so the day does not shift west. */
export function dateInputValue(value: Date | undefined): string {
  return value === undefined ? "" : value.toISOString().slice(0, 10);
}

/**
 * A date out of a date input, stored at midday.
 *
 * Midday UTC rather than midnight, for the reason the flock screen gives: a
 * date-only value stored at midnight is the previous day in every timezone
 * west of Greenwich, which is all of them here.
 */
export function dateFromInput(value: string): Date | undefined {
  return value === "" ? undefined : new Date(`${value}T12:00:00Z`);
}
