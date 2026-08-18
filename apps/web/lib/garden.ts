import type { Ulid } from "@galaxy-farm/core";
import type {
  Crop,
  PreservationLog,
  Planting,
  PreservationMethod,
  Variety,
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

/** How a variety reads anywhere it is named: "Cherokee Purple · Tomato". */
export function varietyLabel(
  variety: Pick<Variety, "name" | "cropId"> | undefined,
  crops: readonly Crop[],
): string {
  if (variety === undefined) return "Unknown variety";
  const crop = crops.find((entry) => entry.id === variety.cropId);
  return crop === undefined ? variety.name : `${variety.name} · ${crop.name}`;
}

/** The botanical family a variety belongs to, or nothing if the crop is gone. */
export function familyOf(
  varietyId: Ulid | undefined,
  varieties: readonly Variety[],
  crops: readonly Crop[],
): string | undefined {
  const variety = varieties.find((entry) => entry.id === varietyId);
  if (variety === undefined) return undefined;
  return crops.find((crop) => crop.id === variety.cropId)?.family;
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
      quantity: (existing?.quantity ?? 0) + log.quantity,
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
    totals.set(log.method, (totals.get(log.method) ?? 0) + log.quantity);
  }
  return totals;
}
