import type { ImportedAnimal } from "./digital-beef.js";
import { allRegistrations, type ExternalAnimal } from "./pedigree.js";

/**
 * Checking an animal against the association again (spec §5.2).
 *
 * A registry is not a snapshot. A bull gets culled and his status changes, a
 * hair card comes back and a defect goes from untested to free, a birth date
 * gets corrected, an animal picks up a second registration. The papers on file
 * here were right on the day they were read and quietly go stale afterwards.
 *
 * The rule this is built on: **a refresh proposes, it does not overwrite.**
 *
 * Anything already recorded here may have been typed or corrected by hand, and
 * a re-read of a page is not evidence against that. So a blank being filled in
 * and a value being changed are different things and are treated differently —
 * blanks are ticked by default, changes are not, and a change always shows
 * both values so somebody can see what they are agreeing to.
 *
 * The alternative — writing whatever the page says — means one bad parse after
 * a template change silently rewrites thirty records, and nothing on any
 * screen would look unusual afterwards.
 */

export type ChangeKind = "fill" | "change";

export interface FieldChange {
  readonly field: string;
  /** What to call it on screen. */
  readonly label: string;
  readonly kind: ChangeKind;
  /** What is recorded now. Undefined for a fill. */
  readonly before?: string | undefined;
  readonly after: string;
  /** The value to write. */
  readonly value: unknown;
}

/** Field name → what a person calls it. */
const LABELS: Record<string, string> = {
  name: "Name",
  tattoo: "Tattoo",
  sex: "Bull or cow",
  dob: "Date of birth",
  colour: "Colour",
  hornStatus: "Horns",
  breedComposition: "Breed makeup",
  coi: "Their inbreeding figure",
  status: "Status",
  disposedOn: "Disposal date",
  serviceType: "How it was got",
  geneticTests: "Defect results",
  registrations: "Registrations",
  sourceUrl: "Source page",
};

const show = (value: unknown): string => {
  if (value === undefined || value === null) return "—";
  if (value instanceof Date) return value.toLocaleDateString();
  if (Array.isArray(value)) {
    return value
      .map((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) return String(entry);
        const record = entry as Record<string, unknown>;
        if ("percent" in record) return `${String(record["percent"])}% ${String(record["breed"])}`;
        if ("defect" in record) return `${String(record["defect"])} ${String(record["status"])}`;
        if ("regNumber" in record)
          return `${String(record["association"])} ${String(record["regNumber"])}`;
        return JSON.stringify(entry);
      })
      .join(", ");
  }
  return String(value);
};

const same = (left: unknown, right: unknown): boolean => {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return JSON.stringify(left) === JSON.stringify(right);
};

const asDate = (value: string | undefined): Date | undefined => {
  if (value === undefined || value === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/**
 * What a fresh read of the page would change.
 *
 * Fields the page did not carry are not proposed at all — a Maine-Anjou page
 * prints no breed makeup, and reading that as "the makeup is now empty" would
 * wipe the one the Chianina page supplied.
 */
export function refreshChanges(
  existing: ExternalAnimal,
  imported: ImportedAnimal,
): FieldChange[] {
  const sexOf = (value: string | undefined): "male" | "female" | undefined => {
    if (value === undefined) return undefined;
    if (/^(bull|steer)/i.test(value)) return "male";
    if (/^(cow|heifer)/i.test(value)) return "female";
    return undefined;
  };

  const read: Record<string, unknown> = {
    ...(imported.name === undefined ? {} : { name: imported.name }),
    ...(imported.tattoo === undefined ? {} : { tattoo: imported.tattoo }),
    ...(sexOf(imported.sex) === undefined ? {} : { sex: sexOf(imported.sex) }),
    ...(asDate(imported.dob) === undefined ? {} : { dob: asDate(imported.dob) }),
    ...(imported.colour === undefined ? {} : { colour: imported.colour }),
    ...(imported.hornStatus === undefined ? {} : { hornStatus: imported.hornStatus }),
    ...(imported.breedComposition.length === 0
      ? {}
      : { breedComposition: imported.breedComposition }),
    ...(imported.coi === undefined ? {} : { coi: imported.coi }),
    ...(imported.status === undefined ? {} : { status: imported.status }),
    ...(asDate(imported.disposedOn) === undefined
      ? {}
      : { disposedOn: asDate(imported.disposedOn) }),
    ...(imported.serviceType === undefined ? {} : { serviceType: imported.serviceType }),
    ...(imported.sourceUrl === undefined ? {} : { sourceUrl: imported.sourceUrl }),
  };

  const changes: FieldChange[] = [];

  for (const [field, value] of Object.entries(read)) {
    const current = (existing as unknown as Record<string, unknown>)[field];
    if (same(current, value)) continue;

    changes.push({
      field,
      label: LABELS[field] ?? field,
      kind: current === undefined ? "fill" : "change",
      ...(current === undefined ? {} : { before: show(current) }),
      after: show(value),
      value,
    });
  }

  // A number this registry issued that is not on the record yet. Added rather
  // than replacing, because an animal papered twice keeps both.
  const known = allRegistrations(existing);
  const holds = known.some(
    (entry) =>
      entry.association === imported.association &&
      entry.regNumber.replace(/\D/g, "") === imported.registration.replace(/\D/g, ""),
  );
  if (!holds) {
    const next = [
      ...known,
      { association: imported.association, regNumber: imported.registration },
    ];
    changes.push({
      field: "registrations",
      label: LABELS["registrations"] as string,
      kind: "fill",
      before: show(known),
      after: show(next),
      value: next,
    });
  }

  return changes;
}

/**
 * Which defect results the page reports that the record does not have.
 *
 * Held apart from the field diff because these merge rather than replace: a
 * hair card typed in here for TH must survive a page that only prints PHA, and
 * a straight field comparison would drop it.
 */
export function refreshDefects(
  existing: ExternalAnimal,
  imported: ImportedAnimal,
): FieldChange | undefined {
  // The page carries flags per *ancestor*, not for the animal it is about, so
  // this reads the row the chart gives for the subject itself when there is
  // one. Nothing to propose when there is not.
  const fresh = imported.ancestors.find((entry) => entry.position === undefined)?.geneticTests ?? [];
  if (fresh.length === 0) return undefined;

  const current = existing.geneticTests ?? [];
  const added = fresh.filter((test) => !current.some((held) => held.defect === test.defect));
  if (added.length === 0) return undefined;

  const next = [...current, ...added];
  return {
    field: "geneticTests",
    label: LABELS["geneticTests"] as string,
    kind: "fill",
    before: show(current),
    after: show(next),
    value: next,
  };
}

/** The changes somebody ticked, as a patch. */
export function applyChanges(
  changes: readonly FieldChange[],
  accepted: ReadonlySet<string>,
): Partial<ExternalAnimal> {
  const patch: Record<string, unknown> = {};
  for (const change of changes) {
    if (!accepted.has(change.field)) continue;
    patch[change.field] = change.value;
  }
  return patch as Partial<ExternalAnimal>;
}

/** Ticked by default: blanks being filled, never a value being changed. */
export function defaultAccepted(changes: readonly FieldChange[]): Set<string> {
  return new Set(changes.filter((change) => change.kind === "fill").map((change) => change.field));
}
