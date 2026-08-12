import type { Ulid } from "@galaxy-farm/core";

import type { ParentRef } from "./cattle-profile.js";
import { allRegistrations, normaliseRegistration, type ExternalAnimal } from "./pedigree.js";

/**
 * Which of an outside animal's ancestors is a bull and which is a cow
 * (spec §5.2).
 *
 * Nobody types this in. An ancestor arrives off a certificate, and a
 * certificate does not have a sex field — it has a **sire** column and a
 * **dam** column, and that is the claim. So sex is *derived* from how the
 * animal is used, three ways, and only recorded when somebody overrides it:
 *
 * 1. **Where it sits in an imported pedigree.** A slot called `sire's dam's
 *    sire` ends in "sire", so that animal is a bull. Free, and right for all
 *    thirty ancestors of every imported chart.
 * 2. **Who names it as a parent.** An ancestor used as anybody's dam is a cow,
 *    whether or not it came from an import.
 * 3. **Typed in**, when a record predates both and somebody wants to fix it.
 *
 * The point of doing this at all: a sire dropdown listing four hundred names,
 * half of them cows, is how a cow ends up recorded as a bull's sire — and
 * every pedigree, relatedness figure and colour prediction drawn afterwards is
 * wrong in a way that looks perfectly normal on screen.
 */

export type AncestorSex = "male" | "female";

export interface SexVerdict {
  readonly sex?: AncestorSex | undefined;
  /** True when nobody typed it — it follows from how the animal is used. */
  readonly inferred: boolean;
  /**
   * Used as a sire somewhere and as a dam somewhere else.
   *
   * Not a display quirk: it means two records disagree about an animal, and
   * one of the two pedigrees hanging off it is wrong. Surfaced rather than
   * resolved, because picking a winner here would hide the mistake.
   */
  readonly conflict: boolean;
}

/** "sire's dam's sire" is a bull; "dam's dam" is a cow. */
export function sexFromPosition(position: string): AncestorSex | undefined {
  if (/(^|\s)sire$/.test(position.trim())) return "male";
  if (/(^|\s)dam$/.test(position.trim())) return "female";
  return undefined;
}

/**
 * Work out every outside animal's sex at once.
 *
 * Built for the whole screen in one pass rather than per row: the sire and dam
 * dropdowns both need it, the ancestors list groups by it, and recomputing it
 * per option would walk every parent reference once per ancestor.
 */
export function inferAncestorSexes(
  outsiders: readonly ExternalAnimal[],
  parentages: readonly { readonly sire?: ParentRef | undefined; readonly dam?: ParentRef | undefined }[],
): Map<Ulid, SexVerdict> {
  const asSire = new Set<Ulid>();
  const asDam = new Set<Ulid>();

  for (const parentage of parentages) {
    if (parentage.sire?.kind === "external") asSire.add(parentage.sire.id);
    if (parentage.dam?.kind === "external") asDam.add(parentage.dam.id);
  }

  const verdicts = new Map<Ulid, SexVerdict>();
  for (const animal of outsiders) {
    const conflict = asSire.has(animal.id) && asDam.has(animal.id);

    if (animal.sex !== undefined) {
      verdicts.set(animal.id, { sex: animal.sex, inferred: false, conflict });
      continue;
    }

    const used = conflict ? undefined : asSire.has(animal.id) ? "male" : asDam.has(animal.id) ? "female" : undefined;
    verdicts.set(animal.id, {
      ...(used === undefined ? {} : { sex: used }),
      inferred: true,
      conflict,
    });
  }

  return verdicts;
}

/**
 * Can this animal be a sire, or a dam?
 *
 * Deliberately permissive about the unknown: an ancestor nobody has placed yet
 * shows in both lists, because a dropdown that hides the animal somebody is
 * looking for is worse than one that shows a few extra. What it will not do is
 * offer a known cow as a sire.
 */
export function canBe(verdict: SexVerdict | undefined, role: AncestorSex): boolean {
  if (verdict?.sex === undefined) return true;
  return verdict.sex === role;
}

/* ---------------------------------------------------- finding one of them */

export interface AncestorFilter {
  /** Matched against name, every registration number, and the tattoo. */
  readonly search: string;
  readonly sex: "all" | "male" | "female" | "unknown";
  /** An association code, or "" for all of them. */
  readonly association: string;
  /** Whether anything's pedigree names it. */
  readonly usage: "all" | "used" | "unused";
  readonly papers: "all" | "registered" | "unregistered" | "multiple";
}

export const NO_FILTER: AncestorFilter = {
  search: "",
  sex: "all",
  association: "",
  usage: "all",
  papers: "all",
};

/**
 * Fold case and punctuation for comparison.
 *
 * Both spellings are kept: `SULL TINA'S SOLUTION ET` becomes
 * `sull tina s solution et sulltinassolutionet`. The spaced form is what makes
 * "tina sull" match in either order; the squashed one is what makes "tinas"
 * match, which is how the name is actually typed by somebody who does not
 * think about where the apostrophe went.
 */
const fold = (value: string): string => {
  const spaced = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${spaced} ${spaced.replace(/ /g, "")}`;
};

/**
 * Does this ancestor match what was typed?
 *
 * Every word has to appear somewhere, in any order — so "sull tina" finds
 * "SULL TINA'S SOLUTION ET", which is how somebody reading off a certificate
 * types it. A registration number counts as searchable text because that is
 * often the only part of a worn paper anybody can read.
 */
export function ancestorMatches(animal: ExternalAnimal, search: string): boolean {
  const words = search
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return true;

  const haystack = fold(
    [
      animal.name,
      animal.tattoo ?? "",
      animal.colour ?? "",
      animal.hornStatus ?? "",
      animal.status ?? "",
      ...(animal.breedComposition ?? []).map((share) => share.breed),
      ...allRegistrations(animal).map((entry) => `${entry.association} ${entry.regNumber}`),
    ].join(" "),
  );

  return words.every((word) => haystack.includes(word));
}

/**
 * The list, filtered and sorted by name.
 *
 * A pure function taking the sexes and the usage counts as arguments rather
 * than deriving them, so the screen computes those once for the whole page
 * instead of once per row — and so this can be tested without a store.
 */
export function filterAncestors(
  animals: readonly ExternalAnimal[],
  filter: AncestorFilter,
  sexes: ReadonlyMap<Ulid, SexVerdict>,
  usedBy: ReadonlyMap<string, readonly string[]>,
): ExternalAnimal[] {
  return animals
    .filter((animal) => {
      if (!ancestorMatches(animal, filter.search)) return false;

      if (filter.sex !== "all") {
        const sex = sexes.get(animal.id)?.sex;
        if (filter.sex === "unknown" ? sex !== undefined : sex !== filter.sex) return false;
      }

      // Every number the animal holds, not just the first. One animal
      // registered with both Maine-Anjou and Chianina has to turn up under
      // either — filtering on a single `regNumber` field hid half the herd
      // from whichever registry happened not to be the primary one.
      const papers = allRegistrations(animal);
      if (
        filter.association !== "" &&
        !papers.some((entry) => entry.association === filter.association)
      ) {
        return false;
      }

      const used = (usedBy.get(`external:${animal.id}`) ?? []).length > 0;
      if (filter.usage === "used" && !used) return false;
      if (filter.usage === "unused" && used) return false;

      if (filter.papers === "registered" && papers.length === 0) return false;
      if (filter.papers === "unregistered" && papers.length > 0) return false;
      if (filter.papers === "multiple" && papers.length < 2) return false;

      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/* --------------------------------------------------- joining two into one */

export interface MergeReference {
  /** Which store the record lives in. */
  readonly kind: "profile" | "external";
  readonly id: Ulid;
  readonly label: string;
  readonly role: "sire" | "dam";
}

export interface AncestorMergePlan {
  /** What to write on the record being kept. */
  readonly patch: Partial<ExternalAnimal>;
  /** Everything pointing at the one being dropped, which has to be repointed. */
  readonly repoint: readonly MergeReference[];
  /**
   * Disagreements between the two.
   *
   * Not blockers. Two registries genuinely record different names for one cow,
   * and one of two records may simply be better. But a merge is not reversible
   * and these are what somebody should read before agreeing to it.
   */
  readonly warnings: readonly string[];
}

/**
 * Fold one ancestor record into another (spec §4.5 clause 3).
 *
 * The situation: the same cow was imported from two associations before the
 * matcher could join them — different registries, different numbers, nothing
 * connecting the two — so she is on file twice, each copy holding half her
 * descendants and neither showing the whole line.
 *
 * The kept record gains every registration number, and every field it does not
 * already have. It never loses anything: where both records hold a value, the
 * kept one wins and the difference is reported rather than resolved. A merge
 * cannot be undone, and quietly preferring the newer of two hand-typed values
 * is the kind of thing nobody would ever notice going wrong.
 */
export function planAncestorMerge(
  keep: ExternalAnimal,
  drop: ExternalAnimal,
  profiles: readonly {
    readonly id: Ulid;
    readonly label: string;
    readonly sire?: ParentRef | undefined;
    readonly dam?: ParentRef | undefined;
  }[],
  outsiders: readonly ExternalAnimal[],
): AncestorMergePlan {
  const warnings: string[] = [];

  const registrations = [...allRegistrations(keep)];
  for (const entry of allRegistrations(drop)) {
    const held = registrations.some(
      (known) =>
        known.association === entry.association &&
        normaliseRegistration(known.regNumber) === normaliseRegistration(entry.regNumber),
    );
    if (!held) registrations.push(entry);
  }

  const patch: Record<string, unknown> = { registrations };

  const FIELDS = [
    "tattoo",
    "sex",
    "dob",
    "colour",
    "hornStatus",
    "breedComposition",
    "coi",
    "status",
    "disposedOn",
    "serviceType",
    "sourceUrl",
    "sire",
    "dam",
  ] as const;

  const held = keep as unknown as Record<string, unknown>;
  const other = drop as unknown as Record<string, unknown>;

  for (const field of FIELDS) {
    if (other[field] === undefined) continue;
    if (held[field] === undefined) {
      patch[field] = other[field];
      continue;
    }
    if (JSON.stringify(held[field]) !== JSON.stringify(other[field])) {
      warnings.push(`Both records have a ${field}, and they differ. The kept one is unchanged.`);
    }
  }

  // Defect results merge rather than replace: a hair card typed against one
  // copy has to survive, and a straight field comparison would drop it.
  const heldTests = keep.geneticTests ?? [];
  const added = (drop.geneticTests ?? []).filter(
    (test) => !heldTests.some((known) => known.defect === test.defect),
  );
  if (added.length > 0) patch["geneticTests"] = [...heldTests, ...added];

  if (keep.name.trim().toUpperCase() !== drop.name.trim().toUpperCase()) {
    warnings.push(
      `The two are named differently — "${keep.name}" and "${drop.name}". Only the first survives.`,
    );
  }

  const repoint: MergeReference[] = [];
  for (const profile of profiles) {
    if (profile.sire?.kind === "external" && profile.sire.id === drop.id) {
      repoint.push({ kind: "profile", id: profile.id, label: profile.label, role: "sire" });
    }
    if (profile.dam?.kind === "external" && profile.dam.id === drop.id) {
      repoint.push({ kind: "profile", id: profile.id, label: profile.label, role: "dam" });
    }
  }
  for (const outsider of outsiders) {
    if (outsider.id === drop.id) continue;
    if (outsider.sire?.kind === "external" && outsider.sire.id === drop.id) {
      repoint.push({ kind: "external", id: outsider.id, label: outsider.name, role: "sire" });
    }
    if (outsider.dam?.kind === "external" && outsider.dam.id === drop.id) {
      repoint.push({ kind: "external", id: outsider.id, label: outsider.name, role: "dam" });
    }
  }

  return { patch: patch as Partial<ExternalAnimal>, repoint, warnings };
}
