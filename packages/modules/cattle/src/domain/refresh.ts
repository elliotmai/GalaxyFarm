import { HORN_STATUSES, type CattleProfile } from "./cattle-profile.js";
import type { ImportedAnimal } from "./parsers/page.js";
import { allRegistrations, normaliseRegistration, type ExternalAnimal } from "./pedigree.js";
import { splitRegistration } from "./registries.js";

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
  colour: "Color",
  hornStatus: "Horns",
  breedComposition: "Breed makeup",
  coi: "Their inbreeding figure",
  status: "Status",
  disposedOn: "Disposal date",
  serviceType: "How it was got",
  classification: "Class on the papers",
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
  /**
   * Everything on file, so the sire and dam the page names can be *linked*
   * rather than just read.
   *
   * Optional because the one-animal check had no reason to pass it until now,
   * and a refresh that cannot resolve a parent should still report the rest.
   */
  everyone: readonly ExternalAnimal[] = [],
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
    ...(imported.classification === undefined ? {} : { classification: imported.classification }),
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

  // Registrations, on two counts.
  //
  // One: a number this registry issued that is not on the record yet. Added
  // rather than replacing, because an animal papered twice keeps both.
  //
  // Two: a number filed under the wrong registry. A record holding `ASA /
  // MA364424` is a Maine-Anjou animal that arrived on a Shorthorn page, and
  // until it is re-filed every lookup of it asks the wrong association — which
  // is a refresh that finds nothing and a link that opens a page saying no
  // such animal. Proposed rather than done, like everything else here.
  const known = allRegistrations(existing);
  const filed = known.map((entry) => {
    const issued = splitRegistration(entry.regNumber, entry.association);
    return issued.foreignTo === undefined
      ? entry
      : { association: issued.association, regNumber: issued.regNumber };
  });
  const holds = filed.some(
    (entry) =>
      entry.association === imported.association &&
      entry.regNumber.replace(/\D/g, "") === imported.registration.replace(/\D/g, ""),
  );
  const next = holds
    ? filed
    : [...filed, { association: imported.association, regNumber: imported.registration }];

  if (show(next) !== show(known)) {
    changes.push({
      field: "registrations",
      label: LABELS["registrations"] as string,
      // Re-filing is a *change* — it moves a number from one registry to
      // another — so it is not ticked by default and shows both sides.
      kind: holds ? "change" : "fill",
      before: show(known),
      after: show(next),
      value: next,
    });
  }

  // The sire and dam, wired to records already here.
  //
  // The detail panel names both outright — number and name — and until now a
  // refresh read them and did nothing with them. An ancestor entered by hand
  // off a certificate has no parents linked, and its own page is exactly where
  // that gets fixed.
  //
  // Only ever fills a blank. Re-pointing a parent that is already set would
  // rewrite a pedigree somebody built by hand, on the strength of a page that
  // may simply be recording the same animal under a different number.
  for (const [role, parent] of [
    ["sire", imported.sire],
    ["dam", imported.dam],
  ] as const) {
    if (parent === undefined || existing[role] !== undefined) continue;

    const match = findParent(parent, imported.association, everyone);
    if (match === undefined) continue;

    changes.push({
      field: role,
      label: role === "sire" ? "Sire" : "Dam",
      kind: "fill",
      after: `${match.name}${parent.regNumber === undefined ? "" : ` (${imported.association} ${parent.regNumber})`}`,
      value: { kind: "external", id: match.id },
    });
  }

  return changes;
}

/**
 * The record a page's named parent refers to.
 *
 * By registration within the page's own registry first, because that cannot be
 * wrong. By name only as a fallback and only when exactly one animal has it —
 * two cows called SWEET DANDY in one county is an ordinary Tuesday, and a
 * pedigree pointed at the wrong one looks entirely normal afterwards.
 */
function findParent(
  parent: { readonly regNumber?: string | undefined; readonly name?: string | undefined },
  association: string,
  everyone: readonly ExternalAnimal[],
): ExternalAnimal | undefined {
  if (parent.regNumber !== undefined) {
    // `Sire: MA364424` on a Chianina page is a Maine-Anjou number, so the
    // registry to search is the one that issued it and not the one printing
    // it. Both spellings are tried, for records written before that was known.
    const wanted = new Set(chartKeys(parent.regNumber, association));
    const byNumber = everyone.find((animal) =>
      allRegistrations(animal).some((entry) =>
        wanted.has(`${entry.association}:${normaliseRegistration(entry.regNumber)}`),
      ),
    );
    if (byNumber !== undefined) return byNumber;
  }

  if (parent.name === undefined) return undefined;
  const wanted = parent.name.trim().toUpperCase();
  const named = everyone.filter((animal) => animal.name.trim().toUpperCase() === wanted);
  return named.length === 1 ? named[0] : undefined;
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
/**
 * The keys a number printed on a chart could be filed under here.
 *
 * Two, and both are needed. A Chianina page prints a Maine-Anjou ancestor as
 * `MA364424`, and the importer files that where it belongs — under AMAA, as
 * 364424 — so looking it up as `ACA:MA364424` finds nothing. That is not a
 * cosmetic miss: the chart is the *only* place an association prints an
 * ancestor's defect results, so a lookup that fails is a herd that comes back
 * with no genetics at all. Twelve ancestors on one page carried results and
 * four of them landed.
 *
 * The as-printed key is kept as a fallback for records written before the
 * registry prefix was understood, which are filed under the page they arrived
 * on.
 */
function chartKeys(regNumber: string, onPage: string): string[] {
  const issued = splitRegistration(regNumber, onPage);
  return [
    `${issued.association}:${normaliseRegistration(issued.regNumber)}`,
    `${onPage}:${normaliseRegistration(regNumber)}`,
  ];
}

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

    const match = chartKeys(ancestor.regNumber, imported.association)
      .map((key) => index.get(key))
      .find((found) => found !== undefined);
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
      add(
        "sex",
        /(^|\s)sire$/.test(ancestor.position)
          ? "male"
          : /(^|\s)dam$/.test(ancestor.position)
            ? "female"
            : undefined,
      );
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

/**
 * What a page would change on one of the farm's own animals.
 *
 * The two things worth having off a page are the **breed makeup** and the
 * **defect results**, and for the farm's own cattle neither was being read at
 * all: their pages were fetched only for what the chart said about the
 * ancestors above them. So the animals whose composition matters most — the
 * ones being bred, shown and sold — were the ones a refresh never touched.
 *
 * Same rule as everywhere else: fills a blank, reports a difference, never
 * overwrites. And the defect results merge, so a hair card typed against the
 * animal survives a page that only mentions something else.
 */
export function profileChanges(profile: CattleProfile, imported: ImportedAnimal): FieldChange[] {
  const changes: FieldChange[] = [];

  const horn = HORN_STATUSES.find((status) => status === imported.hornStatus?.trim().toLowerCase());

  const read: Record<string, unknown> = {
    ...(imported.breedComposition.length === 0
      ? {}
      : { breedComposition: imported.breedComposition }),
    ...(imported.colour === undefined ? {} : { colour: imported.colour }),
    ...(horn === undefined ? {} : { hornStatus: horn }),
  };

  for (const [field, value] of Object.entries(read)) {
    const current = (profile as unknown as Record<string, unknown>)[field];
    // An empty makeup is no makeup — `breedComposition` defaults to `[]`, and
    // treating that as "already answered" is why a papered animal with no
    // composition on file would never gain one.
    const blank = current === undefined || (Array.isArray(current) && current.length === 0);
    if (!blank && same(current, value)) continue;

    changes.push({
      field,
      label: LABELS[field] ?? field,
      kind: blank ? "fill" : "change",
      ...(blank ? {} : { before: show(current) }),
      after: show(value),
      value,
    });
  }

  // The animal's own defect flags are not on its own page — they are printed
  // beside it on its descendants' charts. What *is* here is anything its own
  // chart says about it under a repeated ancestor, which is nothing, so this
  // reads the chart's entry for the subject when the page happens to carry one.
  const own = imported.ancestors.find((entry) => entry.position === undefined)?.geneticTests ?? [];
  const held = profile.geneticTests;
  const added = own.filter((test) => !held.some((known) => known.defect === test.defect));
  if (added.length > 0) {
    const next = [...held, ...added];
    changes.push({
      field: "geneticTests",
      label: LABELS["geneticTests"] as string,
      kind: "fill",
      ...(held.length === 0 ? {} : { before: show(held) }),
      after: show(next),
      value: next,
    });
  }

  return changes;
}

/**
 * Animals on this page's chart that are not on file at all.
 *
 * A refresh deliberately does not create them: adding thirty records is what
 * the import screen is for, and it shows every one for approval and wires the
 * whole tree. But saying nothing leaves somebody thinking the page had nothing
 * to give when it had twelve ancestors — so the count is reported and the
 * screen points at the import.
 */
export function unknownOnChart(
  imported: ImportedAnimal,
  existing: readonly ExternalAnimal[],
): string[] {
  const known = new Set<string>();
  for (const animal of existing) {
    for (const registration of allRegistrations(animal)) {
      known.add(`${registration.association}:${normaliseRegistration(registration.regNumber)}`);
    }
  }

  const found = new Set<string>();
  for (const ancestor of [...imported.ancestors, ...imported.unplacedAncestors]) {
    if (ancestor.regNumber === undefined || ancestor.name === undefined) continue;
    if (chartKeys(ancestor.regNumber, imported.association).some((key) => known.has(key))) continue;
    found.add(ancestor.name);
  }

  return [...found];
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
