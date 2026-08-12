import type { ImportedAnimal } from "./digital-beef.js";
import {
  allRegistrations,
  normaliseRegistration,
  type ExternalAnimal,
} from "./pedigree.js";

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
 * What a page says about the *other* animals on it.
 *
 * This is where the defect results actually live, and getting it wrong cost a
 * whole feature. Digital Beef does not print an animal's genetic tests on its
 * own page — it prints them **on the pedigree chart**, beside each ancestor.
 * `PHAF THF` next to a bull means that bull is free of both, and it is written
 * on the page of every animal descended from him rather than on his own.
 *
 * So a refresh that only reads the detail panel can never learn a defect
 * result. The first attempt at this looked for the subject's flags among its
 * own ancestors, found nothing every single time, and reported no changes
 * without ever saying it had looked in a place they could not be.
 *
 * Reading a page therefore updates the *ancestors on it*, matched by
 * registration within the association whose page it is — the only comparison
 * that is safe, since two registries number the same animal differently.
 *
 * Colour and date of birth come the same way. Shorthorn prints both beneath
 * every chart entry, going back to bulls born in the 1950s, and that is the
 * only record of either that exists anywhere.
 */
export function pedigreeChanges(
  imported: ImportedAnimal,
  existing: readonly ExternalAnimal[],
): { animal: ExternalAnimal; changes: FieldChange[] }[] {
  const index = new Map<string, ExternalAnimal>();
  for (const animal of existing) {
    for (const registration of allRegistrations(animal)) {
      index.set(
        `${registration.association}:${normaliseRegistration(registration.regNumber)}`,
        animal,
      );
    }
  }

  const found: { animal: ExternalAnimal; changes: FieldChange[] }[] = [];
  const seen = new Set<string>();

  for (const ancestor of [...imported.ancestors, ...imported.unplacedAncestors]) {
    if (ancestor.regNumber === undefined) continue;

    const key = `${imported.association}:${normaliseRegistration(ancestor.regNumber)}`;
    const match = index.get(key);
    if (match === undefined || seen.has(match.id)) continue;
    seen.add(match.id);

    const changes: FieldChange[] = [];
    const add = (field: string, value: unknown) => {
      const current = (match as unknown as Record<string, unknown>)[field];
      if (current !== undefined || value === undefined) return;
      changes.push({
        field,
        label: LABELS[field] ?? field,
        kind: "fill",
        after: show(value),
        value,
      });
    };

    add("tattoo", ancestor.tattoo);
    add("colour", ancestor.colour);
    add("dob", asDate(ancestor.dob));
    if (ancestor.position !== undefined) {
      add("sex", /(^|\s)sire$/.test(ancestor.position) ? "male" : /(^|\s)dam$/.test(ancestor.position) ? "female" : undefined);
    }

    // Defect results merge rather than replace. A hair card typed in here for
    // TH has to survive a page that only prints PHA, and a straight field
    // comparison would drop it.
    const held = match.geneticTests ?? [];
    const fresh = ancestor.geneticTests.filter(
      (test) => !held.some((known) => known.defect === test.defect),
    );
    if (fresh.length > 0) {
      const next = [...held, ...fresh];
      changes.push({
        field: "geneticTests",
        label: LABELS["geneticTests"] as string,
        kind: "fill",
        ...(held.length === 0 ? {} : { before: show(held) }),
        after: show(next),
        value: next,
      });
    }

    if (changes.length > 0) found.push({ animal: match, changes });
  }

  return found;
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
