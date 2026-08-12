import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "@galaxy-farm/core";

import { parentRefSchema, type ParentRef } from "./cattle-profile.js";
import { geneticTestSchema, type GeneticTest } from "./genetics.js";

/**
 * A registration number reduced to what can be compared.
 *
 * Shorthorn prints one animal's number as `*s4219133` on her own page and
 * `*x4157771` in a pedigree, while the URL that reached the page says
 * `4219133`. The `*` and the lowercase letters are that registry's flags for
 * how the entry is recorded, not part of the number.
 *
 * Uppercase letters *are* part of it and stay: `MA364424`, `CA240047` and
 * `AR30478` are different series, and `240047` under Chianina is a different
 * animal from `CA240047` under Maine-Anjou. Stripping every letter would merge
 * those two, which is the opposite mistake and a worse one.
 */
export function normaliseRegistration(value: string): string {
  return value
    .replace(/[^0-9A-Za-z]/g, "")
    .replace(/^[a-z]+/, "")
    .toUpperCase();
}

/**
 * Pedigree, on-farm and off (spec §5.2).
 *
 * The problem this solves: a five-generation tree has thirty ancestors and
 * this farm will own two of them. Requiring every ancestor to be a farm record
 * would mean thirty Animals with no location, no health, and no reason to
 * exist. `ExternalAnimal` is the outside half — a name, a registration, and its
 * own parents — so the chain goes back as far as the papers do without
 * pretending those animals are here.
 */

/** One registry's number for an animal. */
export interface ExternalRegistration {
  readonly association: string;
  readonly regNumber: string;
}

export interface ExternalAnimal extends BaseRecord {
  readonly name: string;
  /** The number shown first. One of `registrations`, or the only one there is. */
  readonly regNumber?: string | undefined;
  readonly association?: string | undefined;
  /**
   * Every registry this animal is recorded in.
   *
   * A bull registered with both Maine-Anjou and Chianina has a different
   * number in each. His Maine-Anjou pedigree prints his dam's Maine-Anjou
   * number and his Chianina pedigree prints her Chianina one — so importing
   * both pages against a single `regNumber` made two copies of one cow, each
   * holding half her descendants and neither showing the whole line.
   */
  readonly registrations?: readonly ExternalRegistration[] | undefined;
  readonly tattoo?: string | undefined;
  /**
   * Recorded only when somebody typed it.
   *
   * A certificate has no sex field — it has a sire column and a dam column —
   * so this is usually left alone and derived from where the animal sits in a
   * pedigree. See `inferAncestorSexes`.
   */
  readonly sex?: "male" | "female" | undefined;
  readonly dob?: Date | undefined;
  readonly colour?: string | undefined;
  readonly breeder?: string | undefined;
  /** Defect flags as the association printed them. */
  readonly geneticTests?: readonly GeneticTest[] | undefined;
  readonly sire?: ParentRef | undefined;
  readonly dam?: ParentRef | undefined;
  readonly notes?: string | undefined;
}

export const externalRegistrationSchema = z.object({
  association: z.string().min(1).max(40),
  regNumber: z.string().min(1).max(60),
});

export const externalAnimalSchema = baseRecordSchema.extend({
  name: z.string().min(1, "An ancestor needs a name").max(160),
  regNumber: z.string().max(60).optional(),
  association: z.string().max(40).optional(),
  registrations: z.array(externalRegistrationSchema).max(8).optional(),
  tattoo: z.string().max(40).optional(),
  sex: z.enum(["male", "female"]).optional(),
  dob: z.coerce.date().optional(),
  colour: z.string().max(120).optional(),
  breeder: z.string().max(160).optional(),
  geneticTests: z.array(geneticTestSchema).optional(),
  sire: parentRefSchema.optional(),
  dam: parentRefSchema.optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<ExternalAnimal>;

/**
 * Every number this animal is known by, old records included.
 *
 * Records written before `registrations` existed carry a single
 * `regNumber`/`association` pair, and a lookup that only reads the array would
 * stop finding them. One accessor, so nothing has to remember that.
 */
export function allRegistrations(
  animal: Pick<ExternalAnimal, "regNumber" | "association" | "registrations">,
): ExternalRegistration[] {
  const found = new Map<string, ExternalRegistration>();

  if (animal.regNumber !== undefined && animal.regNumber !== "") {
    found.set(`${animal.association ?? "other"}:${normaliseRegistration(animal.regNumber)}`, {
      association: animal.association ?? "other",
      regNumber: animal.regNumber,
    });
  }
  for (const entry of animal.registrations ?? []) {
    found.set(`${entry.association}:${normaliseRegistration(entry.regNumber)}`, entry);
  }

  return [...found.values()];
}

/** One node of the tree, whichever side of the fence it came from. */
export interface PedigreeNode {
  readonly ref: ParentRef;
  readonly name: string;
  readonly regNumber?: string | undefined;
  /** Generations above the subject: 1 is a parent, 2 a grandparent. */
  readonly generation: number;
  readonly sire?: PedigreeNode | undefined;
  readonly dam?: PedigreeNode | undefined;
}

/** What a caller has to supply to resolve a reference into a name. */
export interface PedigreeSource {
  parentsOf(ref: ParentRef): { sire?: ParentRef; dam?: ParentRef } | undefined;
  describe(ref: ParentRef): { name: string; regNumber?: string } | undefined;
}

export const MAX_PEDIGREE_GENERATIONS = 5;

/**
 * Build the tree, depth-limited.
 *
 * Depth-limited for two reasons, and the second is not theoretical: §5.2 asks
 * for a 3/4/5-generation view, and a pedigree can genuinely contain a cycle
 * once somebody mistypes a registration number and makes an animal its own
 * great-grandsire. Without a bound that is an infinite walk on a screen
 * somebody opened by accident.
 */
export function buildPedigree(
  subject: ParentRef,
  source: PedigreeSource,
  generations: number = MAX_PEDIGREE_GENERATIONS,
): PedigreeNode | undefined {
  const walk = (
    ref: ParentRef,
    generation: number,
    seen: ReadonlySet<string>,
  ): PedigreeNode | undefined => {
    const described = source.describe(ref);
    if (described === undefined) return undefined;

    const key = `${ref.kind}:${ref.id}`;
    const node: PedigreeNode = {
      ref,
      name: described.name,
      regNumber: described.regNumber,
      generation,
    };

    // A repeated ancestor is normal — line breeding puts the same bull in two
    // places — but a repeat on the path back to the root is a cycle.
    if (generation >= generations || seen.has(key)) return node;

    const parents = source.parentsOf(ref);
    if (parents === undefined) return node;

    const nextSeen = new Set(seen).add(key);
    return {
      ...node,
      sire: parents.sire === undefined ? undefined : walk(parents.sire, generation + 1, nextSeen),
      dam: parents.dam === undefined ? undefined : walk(parents.dam, generation + 1, nextSeen),
    };
  };

  return walk(subject, 0, new Set());
}

/** Everything at one remove — the row a pedigree chart draws as a column. */
export function ancestorsAtGeneration(
  node: PedigreeNode | undefined,
  generation: number,
): PedigreeNode[] {
  if (node === undefined) return [];
  if (node.generation === generation) return [node];
  return [
    ...ancestorsAtGeneration(node.sire, generation),
    ...ancestorsAtGeneration(node.dam, generation),
  ];
}

/** How far back the papers actually go for this animal. */
export function pedigreeDepth(node: PedigreeNode | undefined): number {
  if (node === undefined) return 0;
  return Math.max(node.generation, pedigreeDepth(node.sire), pedigreeDepth(node.dam));
}

/**
 * Ancestors appearing more than once, and how often.
 *
 * This is the line-breeding picture. It is also the first thing that shows a
 * mistyped registration number, because an animal that appears on both sides
 * of a pedigree it has no business being on shows up here first.
 */
export function repeatedAncestors(node: PedigreeNode | undefined): Map<string, number> {
  const counts = new Map<string, number>();

  const visit = (current: PedigreeNode | undefined): void => {
    if (current === undefined || current.generation === 0) {
      if (current !== undefined) {
        visit(current.sire);
        visit(current.dam);
      }
      return;
    }
    const key = `${current.ref.kind}:${current.ref.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    visit(current.sire);
    visit(current.dam);
  };

  visit(node);
  return new Map([...counts].filter(([, count]) => count > 1));
}

/**
 * Would setting this parent create a loop?
 *
 * Checked before the write rather than tolerated by the reader, because a
 * pedigree that contains a cycle is wrong regardless of whether anything
 * survives walking it.
 */
export function wouldCreateCycle(
  subject: ParentRef,
  proposedParent: ParentRef,
  source: PedigreeSource,
): boolean {
  if (subject.kind === proposedParent.kind && subject.id === proposedParent.id) return true;

  const tree = buildPedigree(proposedParent, source, MAX_PEDIGREE_GENERATIONS * 2);
  if (tree === undefined) return false;

  const contains = (node: PedigreeNode | undefined): boolean =>
    node !== undefined &&
    ((node.ref.kind === subject.kind && node.ref.id === subject.id) ||
      contains(node.sire) ||
      contains(node.dam));

  return contains(tree);
}
