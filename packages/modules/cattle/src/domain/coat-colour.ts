import { z } from "zod";

/**
 * What colour the calf will be (spec §5.2).
 *
 * Two loci, and only two, because those two account for nearly everything this
 * herd will throw and because a model that pretended to cover the rest would
 * be confidently wrong rather than usefully partial:
 *
 * **Extension (MC1R)** decides black against red. Three alleles in a strict
 * dominance order — `ED` (dominant black) over `E` (wild type) over `e` (red).
 * Any copy of `ED` makes a black animal; `e/e` makes a red one; `E/e` is red
 * or wild-type-patterned depending on breed, and is treated as black-capable
 * here because in these breeds `E` expresses dark.
 *
 * **Roan (KIT)** is the Shorthorn locus and is co-dominant, which is why
 * Shorthorn breeders can predict it exactly: `R/R` is solid, `R/r` is roan,
 * `r/r` is white. Red × white gives all roan, and roan × roan gives a quarter
 * of each — a fact anybody who has bred Shorthorns already knows, which makes
 * it a good check on whether this screen is telling the truth.
 *
 * **Not modelled**, and said plainly on the screen rather than left to be
 * discovered: dilution (the Charolais and Simmental genes), the spotting locus
 * that puts a white face on a calf, and the Chianina white, which is its own
 * business. A calf out of two black animals can still come out with a white
 * face, and this will not have predicted it.
 */

export const EXTENSION_ALLELES = ["ED", "E", "e"] as const;
export type ExtensionAllele = (typeof EXTENSION_ALLELES)[number];

export const ROAN_ALLELES = ["R", "r"] as const;
export type RoanAllele = (typeof ROAN_ALLELES)[number];

/** A pair, written the way a test result is written: `ED/e`. */
export interface CoatGenotype {
  readonly extension?: readonly [ExtensionAllele, ExtensionAllele] | undefined;
  readonly roan?: readonly [RoanAllele, RoanAllele] | undefined;
}

export const coatGenotypeSchema = z.object({
  extension: z.tuple([z.enum(EXTENSION_ALLELES), z.enum(EXTENSION_ALLELES)]).optional(),
  roan: z.tuple([z.enum(ROAN_ALLELES), z.enum(ROAN_ALLELES)]).optional(),
});

/** `ED/e`, in the order a hair card prints it — dominant first. */
export function writeExtension(pair: readonly [ExtensionAllele, ExtensionAllele]): string {
  const rank = (allele: ExtensionAllele) => EXTENSION_ALLELES.indexOf(allele);
  return [...pair].sort((left, right) => rank(left) - rank(right)).join("/");
}

export function writeRoan(pair: readonly [RoanAllele, RoanAllele]): string {
  return [...pair].sort().reverse().join("/");
}

/** Read `ED/e` back. Undefined for anything that is not a pair of alleles. */
export function readExtension(
  value: string,
): readonly [ExtensionAllele, ExtensionAllele] | undefined {
  const parts = value.split("/");
  const valid = parts.filter((part): part is ExtensionAllele =>
    (EXTENSION_ALLELES as readonly string[]).includes(part),
  );
  return valid.length === 2
    ? [valid[0] as ExtensionAllele, valid[1] as ExtensionAllele]
    : undefined;
}

export function readRoan(value: string): readonly [RoanAllele, RoanAllele] | undefined {
  const parts = value.split("/");
  const valid = parts.filter((part): part is RoanAllele =>
    (ROAN_ALLELES as readonly string[]).includes(part),
  );
  return valid.length === 2 ? [valid[0] as RoanAllele, valid[1] as RoanAllele] : undefined;
}

export interface PunnettCell<A extends string> {
  readonly from: A;
  readonly to: A;
  readonly genotype: readonly [A, A];
}

/**
 * The square itself — four cells, one per gamete combination.
 *
 * Returned as a grid rather than as summed probabilities because the square is
 * the thing worth showing: a breeder reads the four boxes and checks them, and
 * a bar chart of percentages is something they have to take on trust.
 */
export function punnett<A extends string>(
  sire: readonly [A, A],
  dam: readonly [A, A],
): PunnettCell<A>[][] {
  return sire.map((fromSire) =>
    dam.map((fromDam) => ({
      from: fromSire,
      to: fromDam,
      genotype: [fromSire, fromDam] as readonly [A, A],
    })),
  );
}

/**
 * The base colour this pair of Extension alleles makes.
 *
 * `ED` beats everything; one copy makes a black animal whatever is opposite
 * it. `E/e` is the interesting one — it is dark-coated but carries red, which
 * is exactly the animal that surprises people by throwing red calves out of a
 * black cow.
 */
export function extensionColour(
  pair: readonly [ExtensionAllele, ExtensionAllele],
): "black" | "red" {
  return pair.includes("ED") || pair.includes("E") ? "black" : "red";
}

/** True when the animal is dark but carries a red allele it can pass on. */
export function carriesRed(pair: readonly [ExtensionAllele, ExtensionAllele]): boolean {
  return extensionColour(pair) === "black" && pair.includes("e");
}

export function roanColour(pair: readonly [RoanAllele, RoanAllele]): "solid" | "roan" | "white" {
  const solids = pair.filter((allele) => allele === "R").length;
  return solids === 2 ? "solid" : solids === 1 ? "roan" : "white";
}

/**
 * The two loci together, which is the only form worth showing.
 *
 * Roan is white hairs mixed through the base coat, so it does not have a
 * colour of its own — it takes the one Extension gave it. Black through roan
 * is **blue roan**; red through roan is **red roan**. Reporting the loci
 * separately would say "half black, half roan" about a mating where every
 * calf is a blue roan, which is not the same claim at all.
 *
 * `r/r` is white whatever Extension did, but the skin and points still follow
 * the base — a black-based white has dark ears and a dark nose, and that is
 * the difference between a white Shorthorn and a white Chianina on paper.
 */
export function coatName(
  extension: readonly [ExtensionAllele, ExtensionAllele],
  roan: readonly [RoanAllele, RoanAllele],
): string {
  const base = extensionColour(extension);
  const pattern = roanColour(roan);

  if (pattern === "roan") return base === "black" ? "blue roan" : "red roan";
  if (pattern === "white") return base === "black" ? "white, dark points" : "white, red points";
  return base;
}

export interface Outcome {
  readonly label: string;
  /** 0 to 1 — sixteenths, when both loci are known. */
  readonly chance: number;
  /** The genotypes behind it, so the number can be checked rather than trusted. */
  readonly genotypes: readonly string[];
  /** True when this calf would be dark and carrying red. */
  readonly carriesRed?: boolean | undefined;
}

/** Collapse a list of weighted genotypes into named outcomes, commonest first. */
function summarise(
  entries: readonly { label: string; genotype: string; carriesRed?: boolean }[],
): Outcome[] {
  const byLabel = new Map<string, { count: number; genotypes: Set<string>; carriesRed: boolean }>();

  for (const entry of entries) {
    const existing = byLabel.get(entry.label) ?? {
      count: 0,
      genotypes: new Set<string>(),
      carriesRed: false,
    };
    existing.count += 1;
    existing.genotypes.add(entry.genotype);
    // Any genotype behind this outcome carrying red makes the outcome worth
    // flagging: "some of these black calves carry red" is the useful claim.
    existing.carriesRed = existing.carriesRed || entry.carriesRed === true;
    byLabel.set(entry.label, existing);
  }

  return [...byLabel]
    .map(([label, entry]) => ({
      label,
      chance: entry.count / entries.length,
      genotypes: [...entry.genotypes].sort(),
      carriesRed: entry.carriesRed,
    }))
    .sort((left, right) => right.chance - left.chance);
}

export interface ColourPrediction {
  /** Every calf colour this pairing can throw, with its chance. */
  readonly outcomes: readonly Outcome[];
  readonly extensionSquare?: PunnettCell<ExtensionAllele>[][] | undefined;
  readonly roanSquare?: PunnettCell<RoanAllele>[][] | undefined;
  /** Outcomes for one locus alone, when only that one is known. */
  readonly extensionOutcomes: readonly Outcome[];
  readonly roanOutcomes: readonly Outcome[];
  /** Which loci could not be predicted because a genotype is missing. */
  readonly missing: readonly string[];
  /** What this model does not cover, said rather than left to be found out. */
  readonly caveats: readonly string[];
}

const CAVEATS = [
  "Dilution is not modelled — a Charolais or Simmental dilution gene turns black into grey and red into yellow, and nothing here knows about it.",
  "The spotting locus is not modelled. A calf out of two solid animals can still come out with a white face.",
  "The Chianina white is its own gene and is not the Shorthorn white above.",
];

/**
 * What this pairing can throw.
 *
 * Both loci at once when both are known — sixteen cells, collapsed by the
 * colour they produce. A locus with either genotype missing is reported as
 * missing rather than guessed from the animal's own coat: a black cow can be
 * `ED/ED` or `ED/e`, and out of a red bull those two produce entirely
 * different calf crops. Guessing gives an answer that is right half the time
 * and stated as confidently as one that is right always.
 */
export function predictColour(sire: CoatGenotype, dam: CoatGenotype): ColourPrediction {
  const missing: string[] = [];

  const extensionSquare =
    sire.extension !== undefined && dam.extension !== undefined
      ? punnett(sire.extension, dam.extension)
      : undefined;
  if (extensionSquare === undefined) missing.push("Extension (black or red)");

  const roanSquare =
    sire.roan !== undefined && dam.roan !== undefined ? punnett(sire.roan, dam.roan) : undefined;
  if (roanSquare === undefined) missing.push("Roan (solid, roan or white)");

  const extensionCells = extensionSquare?.flat() ?? [];
  const roanCells = roanSquare?.flat() ?? [];

  const extensionOutcomes = summarise(
    extensionCells.map((cell) => ({
      label: extensionColour(cell.genotype),
      genotype: writeExtension(cell.genotype),
      carriesRed: carriesRed(cell.genotype),
    })),
  );

  const roanOutcomes = summarise(
    roanCells.map((cell) => ({
      label: roanColour(cell.genotype),
      genotype: writeRoan(cell.genotype),
    })),
  );

  /*
   * The joint square. Independent loci, so every Extension cell pairs with
   * every Roan cell — sixteen equally likely calves, which is where "a quarter
   * blue roan, a quarter red roan, a quarter black, a quarter red" comes from
   * when a red roan cow meets a black bull carrying red.
   */
  const outcomes =
    extensionSquare !== undefined && roanSquare !== undefined
      ? summarise(
          extensionCells.flatMap((extension) =>
            roanCells.map((roan) => ({
              label: coatName(extension.genotype, roan.genotype),
              genotype: `${writeExtension(extension.genotype)} · ${writeRoan(roan.genotype)}`,
              carriesRed: carriesRed(extension.genotype),
            })),
          ),
        )
      : // Only one locus known: report what that one says rather than nothing.
        extensionSquare !== undefined
        ? extensionOutcomes
        : roanOutcomes;

  return {
    outcomes,
    extensionSquare,
    roanSquare,
    extensionOutcomes,
    roanOutcomes,
    missing,
    caveats: CAVEATS,
  };
}
