import type { Ulid } from "@galaxy-farm/core";

import { matchCandidate, type ImportMatch } from "./import-identity.js";
import { allRegistrations, normaliseRegistration, type ExternalAnimal } from "./pedigree.js";
import type { RegistryAnimal } from "../ports/registry-graph.js";

/**
 * Bringing an animal across from the catalogue (spec §5.2).
 *
 * The catalogue is a hundred thousand animals the crawler found in the
 * associations' herdbooks. None of them are ours, and the only reason to look
 * at one is to pull him across: the bull whose straw is being considered, and
 * the four generations behind him that decide whether the mating is any good.
 *
 * That copy is the whole of this file, and it has to answer three questions
 * before anything is written.
 *
 * **Which of these are already here?** A bull half this farm's cattle descend
 * from is on file already, and importing him again would fork his descendants
 * across two records. So every row is matched against the ancestors on file by
 * the same rules the page importer uses — same registry and number is certain,
 * a name plus a birthday or a tattoo is a suggestion, and a suggestion is
 * ticked by a person rather than assumed.
 *
 * **What order do they go in?** The subject first, then his pedigree, nearest
 * generation outwards. Not because the writes need it, but because a record
 * cannot point at a parent that has not been created yet, and doing it in
 * pedigree order means every parent already exists by the time its calf is
 * written.
 *
 * **How do they join up?** The crawler names parents by registration, not by
 * an id of ours. So the link is made after the fact: once each row has an id —
 * either newly created or the record it matched — the sire and dam references
 * are resolved through that same table. An animal whose sire was not part of
 * this import keeps no reference at all rather than a dangling one.
 *
 * Nothing here writes. It produces a plan, a screen shows it, and a person
 * agrees to it — the same shape as the page importer, for the same reason: a
 * wrong merge welds two animals' descendants together and nothing looks
 * unusual afterwards.
 */

export interface CatalogueRow {
  /** `Shorthorn:4219133` — stable within a plan, and how parents are resolved. */
  readonly key: string;
  readonly animal: RegistryAnimal;
  /** "sire", "dam's dam's sire"; absent for the animal the search landed on. */
  readonly position?: string | undefined;
  /** 0 for the subject, 1 for his parents, and so on. */
  readonly generation: number;
  /** The record this already is, if it is one. */
  readonly match?: ImportMatch | undefined;
}

export interface CataloguePlan {
  readonly rows: readonly CatalogueRow[];
  /** How many rows are already on file, certain matches included. */
  readonly known: number;
}

/** How a row is keyed, and how a parent reference finds the row it points at. */
export function catalogueKey(association: string, regNumber: string): string {
  return `${association}:${normaliseRegistration(regNumber)}`;
}

const asIsoDay = (value: Date | undefined): string | undefined =>
  value === undefined ? undefined : value.toISOString().slice(0, 10);

/**
 * What bringing this animal across would do, with nothing decided.
 *
 * `pedigree` is the walk the catalogue returned — the subject's ancestors, each
 * carrying the slot it sits in. It is deduplicated on the way in: a line that
 * doubles back on itself, which a linebred pedigree does routinely, would
 * otherwise offer the same bull four times and create him four times over.
 */
export function planCatalogueImport(
  subject: RegistryAnimal,
  pedigree: readonly (RegistryAnimal & { position: string; generation: number })[],
  existing: readonly ExternalAnimal[],
): CataloguePlan {
  const index = new Map<string, ExternalAnimal>();
  for (const animal of existing) {
    for (const registration of allRegistrations(animal)) {
      index.set(catalogueKey(registration.association, registration.regNumber), animal);
    }
  }

  const seen = new Set<string>();
  const rows: CatalogueRow[] = [];

  const add = (animal: RegistryAnimal, generation: number, position?: string): void => {
    const key = catalogueKey(animal.association, animal.regNumber);
    // The nearest appearance wins. A bull who is both the sire and the dam's
    // sire is one animal, and the row that names him "sire" is the more useful
    // of the two to look at.
    if (seen.has(key)) return;
    seen.add(key);

    const match = matchCandidate(
      {
        name: animal.name,
        regNumber: animal.regNumber,
        ...(animal.tattoo === undefined ? {} : { tattoo: animal.tattoo }),
        ...(asIsoDay(animal.dob) === undefined ? {} : { dob: asIsoDay(animal.dob) as string }),
      },
      animal.association,
      existing,
      index,
    );

    rows.push({
      key,
      animal,
      generation,
      ...(position === undefined ? {} : { position }),
      ...(match === undefined ? {} : { match }),
    });
  };

  add(subject, 0);
  // Nearest generation first, so a parent is always written before its calf.
  for (const ancestor of [...pedigree].sort((left, right) => left.generation - right.generation)) {
    add(ancestor, ancestor.generation, ancestor.position);
  }

  return { rows, known: rows.filter((row) => row.match !== undefined).length };
}

/**
 * One catalogue animal as a record of ours.
 *
 * Everything the catalogue holds and nothing it does not. The parents are left
 * off deliberately — they are references to ids that do not exist until the
 * rest of the plan has been written, and `catalogueParentPatch` fills them in
 * once they do.
 */
export function catalogueRecord(row: CatalogueRow): Partial<ExternalAnimal> {
  const animal = row.animal;

  return {
    name: animal.name,
    regNumber: animal.regNumber,
    association: animal.association,
    registrations:
      animal.registrations !== undefined && animal.registrations.length > 0
        ? [...animal.registrations]
        : [{ association: animal.association, regNumber: animal.regNumber }],
    ...(animal.tattoo === undefined ? {} : { tattoo: animal.tattoo }),
    ...(animal.sex === undefined ? {} : { sex: animal.sex }),
    ...(animal.dob === undefined ? {} : { dob: animal.dob }),
    ...(animal.colour === undefined ? {} : { colour: animal.colour }),
    ...(animal.hornStatus === undefined ? {} : { hornStatus: animal.hornStatus }),
    ...(animal.classification === undefined ? {} : { classification: animal.classification }),
    ...(animal.breed === undefined || animal.breed.length === 0
      ? {}
      : { breed: [...animal.breed] }),
    ...(animal.breedComposition === undefined || animal.breedComposition.length === 0
      ? {}
      : { breedComposition: [...animal.breedComposition] }),
    ...(animal.coi === undefined ? {} : { coi: animal.coi }),
    ...(animal.geneticTests === undefined || animal.geneticTests.length === 0
      ? {}
      : { geneticTests: [...animal.geneticTests] }),
    ...(animal.sourceUrl === undefined ? {} : { sourceUrl: animal.sourceUrl }),
    notes: `From the ${animal.association} catalogue${row.position === undefined ? "" : ` · ${row.position}`}`,
  };
}

/**
 * The sire and dam references for a row, once every row has an id.
 *
 * Returns undefined when there is nothing to set, so a caller can skip the
 * write instead of bumping `updatedAt` on a record it did not change.
 *
 * A parent the catalogue names but this import did not bring across is left
 * out. Half a link is worse than none: a reference to an id that was never
 * created breaks the pedigree walk everywhere it is followed, and "no sire on
 * file" is at least true.
 */
export function catalogueParentPatch(
  row: CatalogueRow,
  ids: ReadonlyMap<string, Ulid>,
  existingRecord?: Pick<ExternalAnimal, "sire" | "dam"> | undefined,
): Partial<ExternalAnimal> | undefined {
  const resolve = (
    parent: { association: string; regNumber: string } | undefined,
  ): Ulid | undefined =>
    parent === undefined ? undefined : ids.get(catalogueKey(parent.association, parent.regNumber));

  const sire = resolve(row.animal.sire);
  const dam = resolve(row.animal.dam);

  const patch: Partial<ExternalAnimal> = {
    // Never overwritten. A pedigree corrected by hand is worth more than a
    // crawl, and this is the field somebody corrects.
    ...(sire === undefined || existingRecord?.sire !== undefined
      ? {}
      : { sire: { kind: "external" as const, id: sire } }),
    ...(dam === undefined || existingRecord?.dam !== undefined
      ? {}
      : { dam: { kind: "external" as const, id: dam } }),
  };

  return Object.keys(patch).length === 0 ? undefined : patch;
}
