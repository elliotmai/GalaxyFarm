import type { Ulid } from "@galaxy-farm/core";

import type { ImportedAncestor, ImportedAnimal } from "./digital-beef.js";
import { allRegistrations, normaliseRegistration, type ExternalAnimal } from "./pedigree.js";

/**
 * Deciding when two pedigree pages are describing the same animal (spec §5.2).
 *
 * This is the problem that makes importing from more than one association
 * harder than importing from one. **An animal registered with two associations
 * has two numbers, and neither page mentions the other.**
 *
 * ZNT MONTEGO BAY 901W is AMAA 402303 and ACA 359968. His dam, ZNT JENNA 707T,
 * is AMAA 378987 and ACA 337003. Import his Maine-Anjou page and then his
 * Chianina page against a single registration number and you get two of him
 * and two of her — each copy holding half of what is known, neither showing
 * the whole line, and every relatedness figure computed off whichever half the
 * screen happened to walk.
 *
 * Three ways one animal is recognised, in descending order of how much they
 * can be trusted, and the order is the whole design:
 *
 * 1. **Same registry, same number.** Certain. Merged without asking.
 * 2. **Same name and same date of birth**, or same name and same tattoo.
 *    Strong — herd names are not unique, but a name *plus* a birthday is about
 *    as close to an identifier as this world offers. Proposed, not assumed.
 * 3. **The same slot in a pedigree whose subject already matched.** If this is
 *    the Chianina page for a bull already on file from Maine-Anjou, then the
 *    animal in his dam's-sire slot is the animal in the other page's
 *    dam's-sire slot, whatever number it carries. Proposed, not assumed.
 *
 * Rule 1 merges silently because it cannot be wrong. Rules 2 and 3 produce a
 * *suggestion* with the reason attached, and a person ticks it — because a
 * wrong merge is worse than a duplicate. A duplicate is visible and can be
 * merged later; a wrong merge welds two animals' descendants together and
 * nothing on any screen looks unusual afterwards.
 */

export type MatchConfidence = "certain" | "strong" | "positional";

export interface ImportMatch {
  /** The record already on file. */
  readonly existingId: Ulid;
  readonly existingName: string;
  readonly confidence: MatchConfidence;
  /** Why, in words — this is what somebody reads before ticking the box. */
  readonly reason: string;
  /** The number this import would add to that record, if it is new. */
  readonly addsRegistration?: { association: string; regNumber: string } | undefined;
}

export interface ImportRow {
  /** Stable key for the row within one import — the position, or the number. */
  readonly key: string;
  readonly name: string;
  readonly regNumber?: string | undefined;
  readonly association: string;
  /** "sire", "dam's dam's sire", or undefined for the animal itself. */
  readonly position?: string | undefined;
  readonly generation?: number | undefined;
  readonly ancestor?: ImportedAncestor | undefined;
  /** Undefined when nothing on file looks like this animal. */
  readonly match?: ImportMatch | undefined;
}

export interface ImportPlan {
  readonly rows: readonly ImportRow[];
  /** Rows read off the chart whose slot could not be pinned down. */
  readonly unplaced: readonly ImportRow[];
}

const clean = (value: string | undefined): string =>
  (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

const sameDay = (left: Date | undefined, right: string | undefined): boolean => {
  if (left === undefined || right === undefined) return false;
  const parsed = new Date(right);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    left.getUTCFullYear() === parsed.getUTCFullYear() &&
    left.getUTCMonth() === parsed.getUTCMonth() &&
    left.getUTCDate() === parsed.getUTCDate()
  );
};

/** Index of what is already on file, by registry-and-number. */
function registrationIndex(existing: readonly ExternalAnimal[]): Map<string, ExternalAnimal> {
  const index = new Map<string, ExternalAnimal>();
  for (const animal of existing) {
    for (const registration of allRegistrations(animal)) {
      index.set(
        `${registration.association}:${normaliseRegistration(registration.regNumber)}`,
        animal,
      );
    }
  }
  return index;
}

interface Candidate {
  readonly name: string;
  readonly regNumber?: string | undefined;
  readonly tattoo?: string | undefined;
  readonly dob?: string | undefined;
  readonly position?: string | undefined;
}

/**
 * Find the record this candidate already is, if any.
 *
 * `positionalParent` is the animal the pedigree hangs off — supplied once the
 * subject itself has matched, which is what makes rule 3 usable.
 */
export function matchCandidate(
  candidate: Candidate,
  association: string,
  existing: readonly ExternalAnimal[],
  index: Map<string, ExternalAnimal>,
  positional?: ReadonlyMap<string, ExternalAnimal>,
): ImportMatch | undefined {
  // 1. Same registry, same number.
  if (candidate.regNumber !== undefined) {
    const exact = index.get(`${association}:${normaliseRegistration(candidate.regNumber)}`);
    if (exact !== undefined) {
      return {
        existingId: exact.id,
        existingName: exact.name,
        confidence: "certain",
        reason: `Already on file as ${association} ${candidate.regNumber}.`,
      };
    }
  }

  const adds =
    candidate.regNumber === undefined
      ? undefined
      : { association, regNumber: candidate.regNumber };

  // 2. Same name, and something else that agrees.
  const named = existing.filter((animal) => clean(animal.name) === clean(candidate.name));
  for (const animal of named) {
    if (sameDay(animal.dob, candidate.dob)) {
      return {
        existingId: animal.id,
        existingName: animal.name,
        confidence: "strong",
        reason: `Same name and the same date of birth as an animal already on file${
          adds === undefined ? "" : `, under a different registry — this would add ${association} ${candidate.regNumber as string} to it`
        }.`,
        addsRegistration: adds,
      };
    }
    if (
      candidate.tattoo !== undefined &&
      animal.tattoo !== undefined &&
      clean(animal.tattoo) === clean(candidate.tattoo)
    ) {
      return {
        existingId: animal.id,
        existingName: animal.name,
        confidence: "strong",
        reason: `Same name and the same tattoo as an animal already on file.`,
        addsRegistration: adds,
      };
    }
  }

  // 3. The same slot, under a subject that already matched.
  const slot = candidate.position === undefined ? undefined : positional?.get(candidate.position);
  if (slot !== undefined) {
    const agrees = clean(slot.name) === clean(candidate.name);
    return {
      existingId: slot.id,
      existingName: slot.name,
      confidence: "positional",
      reason: agrees
        ? `Same ${candidate.position as string} as the pedigree already on file for this ` +
          `animal, under the same name. The two registries number the same animal differently.`
        : // An animal has exactly one dam, so the slot is the same animal
          // whatever it is called — but two registries disagreeing about the
          // *name* is worth saying out loud rather than merging past. It
          // usually means one of them holds a placeholder for a cow the other
          // registry never recorded, and occasionally it means one is wrong.
          `Same ${candidate.position as string} slot as the pedigree already on file, but the ` +
          `two registries give different names: "${candidate.name}" here, "${slot.name}" on ` +
          `file. Worth a look before merging.`,
      addsRegistration: adds,
    };
  }

  // A single same-named animal with nothing to corroborate it is *not* a
  // match. Herd names repeat, and two cows called SWEET DANDY in one county is
  // an ordinary Tuesday.
  return undefined;
}

/**
 * Turn a parsed page into a list of things to do, with nothing decided yet.
 *
 * `pedigreeOf` resolves an already-known animal's chart into slot → record, so
 * rule 3 has something to compare against. It is a callback rather than a
 * walked structure because the caller owns the store.
 */
export function planImport(
  animal: ImportedAnimal,
  existing: readonly ExternalAnimal[],
  pedigreeOf?: (subject: ExternalAnimal) => ReadonlyMap<string, ExternalAnimal>,
): ImportPlan {
  const index = registrationIndex(existing);
  const association = animal.association;

  const subjectMatch = matchCandidate(
    {
      name: animal.name ?? `${association} ${animal.registration}`,
      regNumber: animal.registration,
      ...(animal.tattoo === undefined ? {} : { tattoo: animal.tattoo }),
      ...(animal.dob === undefined ? {} : { dob: animal.dob }),
    },
    association,
    existing,
    index,
  );

  const subject = existing.find((entry) => entry.id === subjectMatch?.existingId);
  const positional =
    subject === undefined || pedigreeOf === undefined ? undefined : pedigreeOf(subject);

  const row = (ancestor: ImportedAncestor, fallbackKey: string): ImportRow => {
    const name = ancestor.name ?? `${association} ${ancestor.regNumber ?? "?"}`;
    const match = matchCandidate(
      {
        name,
        ...(ancestor.regNumber === undefined ? {} : { regNumber: ancestor.regNumber }),
        ...(ancestor.tattoo === undefined ? {} : { tattoo: ancestor.tattoo }),
        ...(ancestor.dob === undefined ? {} : { dob: ancestor.dob }),
        ...(ancestor.position === undefined ? {} : { position: ancestor.position }),
      },
      association,
      existing,
      index,
      positional,
    );

    return {
      key: ancestor.position ?? fallbackKey,
      name,
      ...(ancestor.regNumber === undefined ? {} : { regNumber: ancestor.regNumber }),
      association,
      ...(ancestor.position === undefined ? {} : { position: ancestor.position }),
      ...(ancestor.generation === undefined ? {} : { generation: ancestor.generation }),
      ancestor,
      ...(match === undefined ? {} : { match }),
    };
  };

  return {
    rows: [
      {
        key: "subject",
        name: animal.name ?? `${association} ${animal.registration}`,
        regNumber: animal.registration,
        association,
        ...(subjectMatch === undefined ? {} : { match: subjectMatch }),
      },
      ...animal.ancestors.map((ancestor, at) => row(ancestor, `ancestor-${at}`)),
    ],
    unplaced: animal.unplacedAncestors.map((ancestor, at) => row(ancestor, `unplaced-${at}`)),
  };
}

/**
 * Fold a new number into a record that already exists.
 *
 * Returns undefined when there is nothing to add, so a caller can skip the
 * write rather than bumping `updatedAt` on every ancestor of every re-import
 * and sending the whole pedigree back over the wire.
 */
export function mergeRegistration(
  existingAnimal: ExternalAnimal,
  registration: { association: string; regNumber: string },
): Partial<ExternalAnimal> | undefined {
  const known = allRegistrations(existingAnimal);
  const already = known.some(
    (entry) =>
      entry.association === registration.association &&
      normaliseRegistration(entry.regNumber) === normaliseRegistration(registration.regNumber),
  );
  if (already) return undefined;

  return { registrations: [...known, registration] };
}
