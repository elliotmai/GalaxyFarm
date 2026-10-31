import type { Ulid } from "@galaxy-farm/core";
import {
  cropFamily,
  inferFamily,
  normaliseFamily,
  type Crop,
  type GrowingFacts,
  type Lifecycle,
  type Season,
  type SowingMethod,
  type SunNeed,
  type PreservationLog,
  type Planting,
  type PreservationMethod,
  type Variety,
} from "@galaxy-farm/module-garden";

/**
 * The joins the garden screens all need (spec §5.5).
 *
 * The garden's domain is pure and takes what it needs as arguments — the
 * rotation guard wants a bed-and-family history, not a repository — so
 * something has to walk `Planting → Variety → Crop` and hand it over. Doing
 * that inline on three screens is three chances to drop the plantings whose
 * variety has been deleted, and to disagree about what a variety is called.
 *
 * Nothing here is a rule. The rules live in `@galaxy-farm/module-garden`; this
 * is the plumbing that feeds them.
 */

const indexes = new WeakMap<readonly { readonly id: Ulid }[], Map<Ulid, unknown>>();

/**
 * The rows by id, built once per list.
 *
 * Every garden screen names records by id on every row — a planting's bed, its
 * variety, the variety's crop — and a `find` per name per row is a scan of one
 * list per row of another. Fine at ten beds; at a few seasons of plantings and
 * harvests it is the render that makes a save feel slow. The lists come out of
 * `useRecords` as the same array until something in the table changes, so a
 * `WeakMap` on the array is a cache that invalidates itself and never leaks.
 */
export function byId<T extends { readonly id: Ulid }>(rows: readonly T[]): ReadonlyMap<Ulid, T> {
  let index = indexes.get(rows) as Map<Ulid, T> | undefined;
  if (index === undefined) {
    index = new Map(rows.map((row) => [row.id, row]));
    indexes.set(rows, index as Map<Ulid, unknown>);
  }
  return index;
}

/** How a variety reads anywhere it is named: "Cherokee Purple · Tomato". */
export function varietyLabel(
  variety: Pick<Variety, "name" | "cropId"> | undefined,
  crops: readonly Crop[],
): string {
  if (variety === undefined) return "Unknown variety";
  const crop = byId(crops).get(variety.cropId);
  return crop === undefined ? variety.name : `${variety.name} · ${crop.name}`;
}

/**
 * The botanical family a variety belongs to, or nothing if the crop is gone.
 *
 * The crop's own family when one is stored, else the one inferred from its
 * name (`cropFamily`) — so a crop typed as "Tomato" with nothing else is a
 * nightshade to the rotation guard, offline, without anybody saying so.
 */
export function familyOf(
  varietyId: Ulid | undefined,
  varieties: readonly Variety[],
  crops: readonly Crop[],
): string | undefined {
  if (varietyId === undefined) return undefined;
  const variety = byId(varieties).get(varietyId);
  if (variety === undefined) return undefined;
  return cropFamily(byId(crops).get(variety.cropId));
}

export interface FamilyPlanting {
  readonly bedId: Ulid;
  readonly family: string;
  readonly plantedOn: Date;
}

/**
 * What each bed has grown, in the shape `rotationWarning` reads.
 *
 * Three things are dropped, each for a reason:
 *
 * - **A planting with no date.** A planned or indoor-started row has not been
 *   in that ground yet, and counting it would warn about a rotation that has
 *   not happened.
 * - **A planting whose variety or crop has been deleted.** Rotation is checked
 *   on the family, and a row we cannot resolve to a family has nothing to say.
 * - **A planting excluded by `ignoreId`.** Editing an existing planting has to
 *   compare it against the rest of the bed's history and not against itself,
 *   or every edit warns that the bed already holds what is being edited.
 */
export function familyHistory(
  plantings: readonly Planting[],
  varieties: readonly Variety[],
  crops: readonly Crop[],
  ignoreId?: Ulid,
): FamilyPlanting[] {
  const history: FamilyPlanting[] = [];

  for (const planting of plantings) {
    if (planting.id === ignoreId) continue;
    if (planting.plantedOn === undefined) continue;

    const family = familyOf(planting.varietyId, varieties, crops);
    if (family === undefined) continue;

    history.push({ bedId: planting.bedId, family, plantedOn: planting.plantedOn });
  }

  return history;
}

export interface ShelfLine {
  /** What is written on the jar. */
  readonly label: string;
  readonly method: PreservationMethod;
  readonly unit: PreservationLog["unit"];
  readonly quantity: number;
  /** Some batch under this label has no count, so `quantity` is "at least". */
  readonly uncounted: boolean;
  /** Every place this label is kept, so "where is it" has an answer. */
  readonly locations: readonly string[];
  /** The most recent batch under this label — how old the oldest jar is not. */
  readonly latest: Date;
}

/**
 * The pantry, read as a pantry rather than as a log (spec §5.5).
 *
 * Twelve entries of "6 jars of salsa" across a summer is not twelve things on
 * a shelf; it is seventy-two jars of salsa. So rows are folded on label,
 * method and unit — the three that have to match before two entries are the
 * same thing. Method stays in the key because canned green beans and frozen
 * green beans are different food kept in different places, and unit stays
 * because adding four bags to six quarts produces a number that is not true in
 * either.
 *
 * Sorted by label so it reads like a shelf, not like a diary.
 */
export function pantryShelf(logs: readonly PreservationLog[]): ShelfLine[] {
  const lines = new Map<string, ShelfLine>();

  for (const log of logs) {
    const key = `${log.label.trim().toLowerCase()}|${log.method}|${log.unit}`;
    const existing = lines.get(key);

    const locations =
      log.storageLocation === undefined || log.storageLocation.trim() === ""
        ? (existing?.locations ?? [])
        : [...new Set([...(existing?.locations ?? []), log.storageLocation.trim()])];

    lines.set(key, {
      label: existing?.label ?? log.label,
      method: log.method,
      unit: log.unit,
      quantity: (existing?.quantity ?? 0) + (log.quantity ?? 0),
      uncounted: (existing?.uncounted ?? false) || log.quantity === undefined,
      locations,
      latest:
        existing === undefined || log.preservedOn > existing.latest
          ? log.preservedOn
          : existing.latest,
    });
  }

  return [...lines.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.method.localeCompare(right.method),
  );
}

/** How much is put by, by method — the four numbers above the shelf. */
export function pantryByMethod(logs: readonly PreservationLog[]): Map<PreservationMethod, number> {
  const totals = new Map<PreservationMethod, number>();
  for (const log of logs) {
    totals.set(log.method, (totals.get(log.method) ?? 0) + (log.quantity ?? 0));
  }
  return totals;
}

/** Blank, or only spaces, is not a value. */
function text(value: string): string | undefined {
  return value.trim() === "" ? undefined : value.trim();
}

/**
 * The fields a crop is saved with, from a draft or a search pick.
 *
 * The family is stored only when it says something the table would not: an
 * override, or GBIF's answer for a plant the table has never heard of. One
 * that merely repeats the inference is left out, so it stays derived (§2) and
 * improves on its own when the table does.
 */
export function cropFields(draft: {
  readonly name: string;
  readonly scientificName: string;
  readonly family: string;
  readonly notes?: string;
  readonly growing?: GrowingDraft;
}): Pick<Crop, "name" | "family" | "scientificName" | "notes" | keyof GrowingFacts> {
  const name = draft.name.trim();
  const scientificName = text(draft.scientificName);
  const typed = normaliseFamily(draft.family);
  const inferred = inferFamily(name, scientificName);
  return {
    name,
    scientificName,
    family: typed === undefined || typed === inferred ? undefined : typed,
    notes: text(draft.notes ?? ""),
    ...growingFields(draft.growing ?? BLANK_GROWING),
  };
}

/**
 * How a crop is grown, as a form holds it: numbers as typed, choices as ""
 * for "not recorded". Filled from a plant pick, editable field by field.
 */
export interface GrowingDraft {
  readonly daysToMaturity: string;
  readonly spacingInches: string;
  readonly season: Season | "";
  readonly lifecycle: Lifecycle | "";
  readonly sun: SunNeed | "";
  readonly sowing: SowingMethod | "";
  readonly depthInches: string;
}

export const BLANK_GROWING: GrowingDraft = {
  daysToMaturity: "",
  spacingInches: "",
  season: "",
  lifecycle: "",
  sun: "",
  sowing: "",
  depthInches: "",
};

/** A crop's (or a pick's) facts, ready for the form. */
export function growingDraft(facts: GrowingFacts | undefined): GrowingDraft {
  const number = (value: number | undefined) => (value === undefined ? "" : String(value));
  return {
    daysToMaturity: number(facts?.daysToMaturity),
    spacingInches: number(facts?.spacingInches),
    season: facts?.season ?? "",
    lifecycle: facts?.lifecycle ?? "",
    sun: facts?.sun ?? "",
    sowing: facts?.sowing ?? "",
    depthInches: number(facts?.depthInches),
  };
}

/**
 * The form's facts as fields to save. A blank is `undefined` — on an edit,
 * that clears what was there, which is what emptying a box means.
 */
export function growingFields(draft: GrowingDraft): GrowingFacts {
  const number = (value: string) => (value.trim() === "" ? undefined : Number(value.trim()));
  return {
    daysToMaturity: number(draft.daysToMaturity),
    spacingInches: number(draft.spacingInches),
    season: draft.season === "" ? undefined : draft.season,
    lifecycle: draft.lifecycle === "" ? undefined : draft.lifecycle,
    sun: draft.sun === "" ? undefined : draft.sun,
    sowing: draft.sowing === "" ? undefined : draft.sowing,
    depthInches: number(draft.depthInches),
  };
}

/**
 * Days and spacing for a new variety: what is already typed, else the
 * crop's typical figures. Only blanks are filled — a number off the packet
 * always beats a typical one.
 */
export function varietyDefaults(
  current: { readonly daysToMaturity: string; readonly spacingInches: string },
  facts: GrowingFacts | undefined,
): { daysToMaturity: string; spacingInches: string } {
  const fill = (typed: string, typical: number | undefined) =>
    typed.trim() !== "" || typical === undefined ? typed : String(typical);
  return {
    daysToMaturity: fill(current.daysToMaturity, facts?.daysToMaturity),
    spacingInches: fill(current.spacingInches, facts?.spacingInches),
  };
}
