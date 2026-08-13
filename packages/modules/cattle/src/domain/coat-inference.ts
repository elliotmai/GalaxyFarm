import {
  EXTENSION_ALLELES,
  ROAN_ALLELES,
  coatName,
  extensionColour,
  roanColour,
  type CoatGenotype,
  type ExtensionAllele,
  type RoanAllele,
} from "./coat-colour.js";

/**
 * Working out an animal's coat genotype from everything that bears on it
 * (spec §5.2).
 *
 * Almost nothing on this place is hair-tested for colour, and it does not need
 * to be: most of a genotype follows from what you can see plus who the parents
 * are. A red animal is `e/e` and there is nothing to test. A roan is `R/r`,
 * because roan is co-dominant and the coat *is* the genotype. A black calf out
 * of a red cow carries red, because she had nothing else to give it.
 *
 * ## Narrowing, not guessing
 *
 * Every locus starts as the full set of pairs it could be, and each piece of
 * evidence removes the ones it rules out. Nothing is ever *added* on a hunch.
 * What comes back is the set that survived — one pair if the evidence pinned
 * it down, several if it did not — so a screen can say "E/e" where that is
 * known and "black, and it may or may not carry red" where it is not, instead
 * of picking one and sounding certain.
 *
 * Four kinds of evidence, and the order does not matter because they are
 * intersected rather than applied in turn:
 *
 * 1. **A hair card.** Settles it outright.
 * 2. **The coat.** Red is `e/e`. Roan is `R/r`. White is `r/r`. Solid is
 *    `R/R`. Black narrows Extension to the four pairs that are not `e/e`.
 * 3. **The parents.** An animal is one allele from each, so its possible pairs
 *    are exactly the cross of theirs. A red parent has only `e` to give, which
 *    is why a black calf out of a red cow is known to carry red without
 *    anybody testing anything.
 * 4. **Its own calves.** A red calf proves *both* its parents handed over an
 *    `e`, whatever they look like. This is how a carrier is actually found on
 *    a working outfit, and it is evidence flowing up the pedigree rather than
 *    down it.
 *
 * ## Never written down
 *
 * This is computed on every read and stored nowhere. That is the point: the
 * day somebody records that a black bull threw a red calf, every descendant's
 * inference has to change with it. A genotype written into a record at import
 * time would still say "black, unknown" a year later, and nothing on any
 * screen would look wrong.
 *
 * The one thing that *is* stored is a real test result, and it wins over all
 * of this — a hair card is not a deduction.
 */

/** What an animal looks like, as far as the two loci here are concerned. */
export interface Phenotype {
  readonly base?: "black" | "red" | undefined;
  readonly pattern?: "solid" | "roan" | "white" | undefined;
}

/**
 * Read a phenotype off the colour somebody wrote down.
 *
 * Deliberately narrow. `Red & White` on a Shorthorn is a *spotted* animal —
 * patches of each — and it is `R/R` at this locus, because roan is white hairs
 * mixed *through* the coat rather than in patches of their own. Reading it as
 * white would make a red-and-white cow `r/r` and every calf out of her a roan
 * that never arrives. Anything not recognised returns nothing at all, which
 * leaves the locus to the parents rather than to a guess.
 */
export function readPhenotype(colour: string | undefined): Phenotype {
  if (colour === undefined) return {};
  const text = colour.toLowerCase();

  const base = /\b(blue|black|blk)\b/.test(text)
    ? ("black" as const)
    : /\b(red|rd)\b/.test(text)
      ? ("red" as const)
      : undefined;

  // Roan first: "blue roan" and "red roan" both name the pattern outright.
  const pattern = /\broan\b/.test(text)
    ? ("roan" as const)
    : // White on its own. `red & white` and `black and white` are spotted
      // animals and are solid at this locus.
      /^\s*white\b/.test(text) && !/\b(and|&|\+)\b/.test(text)
      ? ("white" as const)
      : base !== undefined
        ? ("solid" as const)
        : undefined;

  return {
    ...(base === undefined ? {} : { base }),
    ...(pattern === undefined ? {} : { pattern }),
  };
}

/* ------------------------------------------------------------------ pairs */

const pairKey = <A extends string>(pair: readonly [A, A], order: readonly A[]): string =>
  [...pair].sort((left, right) => order.indexOf(left) - order.indexOf(right)).join("/");

/** Every unordered pair of a locus's alleles. */
function allPairs<A extends string>(alleles: readonly A[]): [A, A][] {
  const found: [A, A][] = [];
  for (let left = 0; left < alleles.length; left += 1) {
    for (let right = left; right < alleles.length; right += 1) {
      found.push([alleles[left] as A, alleles[right] as A]);
    }
  }
  return found;
}

const EXTENSION_PAIRS = allPairs(EXTENSION_ALLELES);
const ROAN_PAIRS = allPairs(ROAN_ALLELES);

export interface Possible<A extends string> {
  readonly pair: readonly [A, A];
  /** Undefined when the set was narrowed without a cross to weight it. */
  readonly chance?: number | undefined;
}

export interface LocusInference<A extends string> {
  /** Everything still possible, likeliest first. One entry means settled. */
  readonly possible: readonly Possible<A>[];
  /** True when the evidence left exactly one pair. */
  readonly settled: boolean;
  /**
   * Whether the chances mean anything.
   *
   * They only do when the set came from crossing two known parents. A black
   * animal with no pedigree could be any of four pairs, and calling each of
   * them 25% would be inventing a prior out of nothing.
   */
  readonly weighted: boolean;
  /** What narrowed it, in the words somebody would use. */
  readonly because: readonly string[];
}

/**
 * Cross two parents' possible pairs into the calf's.
 *
 * Each parent hands over one allele. When both parents' sets are weighted the
 * result is too — otherwise the counts are still right about *what* is
 * possible and say nothing about how likely.
 */
function crossPossible<A extends string>(
  sire: LocusInference<A>,
  dam: LocusInference<A>,
  order: readonly A[],
): { possible: Possible<A>[]; weighted: boolean } {
  const counted = new Map<string, { pair: [A, A]; weight: number }>();

  for (const left of sire.possible) {
    for (const right of dam.possible) {
      const share = (left.chance ?? 1) * (right.chance ?? 1);
      for (const fromSire of left.pair) {
        for (const fromDam of right.pair) {
          const pair: [A, A] = [fromSire, fromDam];
          const name = pairKey(pair, order);
          const held = counted.get(name);
          counted.set(name, { pair: held?.pair ?? pair, weight: (held?.weight ?? 0) + share });
        }
      }
    }
  }

  const total = [...counted.values()].reduce((sum, entry) => sum + entry.weight, 0);
  const weighted = sire.weighted && dam.weighted;

  return {
    possible: [...counted.values()]
      .map((entry) => ({
        pair: entry.pair as readonly [A, A],
        ...(total === 0 ? {} : { chance: entry.weight / total }),
      }))
      .sort((left, right) => (right.chance ?? 0) - (left.chance ?? 0)),
    weighted,
  };
}

/**
 * Settle a locus, keeping the chances and the `weighted` flag in step.
 *
 * They have to agree or `transmits` lies. A settled locus that was flagged
 * weighted but carried no chance on its one pair read as "hands this allele
 * down 0% of the time" — so a red cow, `e/e` beyond any doubt, was reported
 * as unable to throw a red calf. One pair means one certainty: chance 1.
 */
function finish<A extends string>(
  possible: readonly Possible<A>[],
  weighted: boolean,
  because: readonly string[],
): LocusInference<A> {
  const settled = possible.length === 1;
  if (settled && possible[0] !== undefined) {
    return {
      possible: [{ pair: possible[0].pair, chance: 1 }],
      settled: true,
      weighted: true,
      because: [...because],
    };
  }

  const priced = renormalise(possible);
  return {
    possible: priced,
    settled: false,
    // Only weighted when every pair actually carries a number. A flag saying
    // otherwise is what produced the bug above.
    weighted: weighted && priced.every((entry) => entry.chance !== undefined),
    because: [...because],
  };
}

/** Keep only the pairs a rule allows, and note why if anything went. */
function narrow<A extends string>(
  current: { possible: readonly Possible<A>[]; because: readonly string[] },
  keep: (pair: readonly [A, A]) => boolean,
  reason: string,
): { possible: Possible<A>[]; because: string[] } {
  const left = current.possible.filter((entry) => keep(entry.pair));
  // A rule that rules out *everything* is a contradiction in the records — a
  // red calf recorded out of two animals that cannot make one. Keeping the
  // wider set and saying nothing is the wrong answer, but so is showing an
  // empty one; the contradiction is reported instead by whoever reads
  // `because`, and the set is left as it was.
  if (left.length === 0) {
    return {
      possible: [...current.possible],
      because: [...current.because, `${reason} — but that disagrees with the rest, so it is ignored`],
    };
  }
  return {
    possible: left,
    because:
      left.length === current.possible.length ? [...current.because] : [...current.because, reason],
  };
}

const renormalise = <A extends string>(possible: readonly Possible<A>[]): Possible<A>[] => {
  const total = possible.reduce((sum, entry) => sum + (entry.chance ?? 0), 0);
  if (total <= 0) return possible.map((entry) => ({ pair: entry.pair }));
  return possible.map((entry) => ({
    pair: entry.pair,
    ...(entry.chance === undefined ? {} : { chance: entry.chance / total }),
  }));
};

/**
 * How often this animal hands a given allele down, when that is exact.
 *
 * Worth its own function because it is exact far more often than the *pair* is
 * known, and this is the number a breeder actually wants. A black animal that
 * has thrown a red calf is `ED/e` or `E/e` — nobody knows which, and it does
 * not matter: both hand `e` down half the time. Refusing to say so because the
 * pair is unsettled would throw away an answer that is not in doubt at all.
 *
 * Undefined when the pairs disagree about how many copies they hold and there
 * is no weighting to settle it, because then the number really is unknown.
 */
export function transmits<A extends string>(
  locus: LocusInference<A>,
  allele: A,
): number | undefined {
  const counts = locus.possible.map((entry) => entry.pair.filter((held) => held === allele).length);
  if (counts.length === 0) return undefined;

  if (locus.weighted) {
    return locus.possible.reduce(
      (total, entry, at) => total + (entry.chance ?? 0) * ((counts[at] as number) / 2),
      0,
    );
  }
  return counts.every((count) => count === counts[0]) ? (counts[0] as number) / 2 : undefined;
}

/**
 * What the parents alone say this animal could be.
 *
 * Undefined when neither parent is known, which is not the same as "anything
 * is possible" — it means the parents have no vote, and the animal's own coat
 * should not be second-guessed by a set nobody derived.
 */
function fromParents<A extends string>(
  sire: LocusInference<A> | undefined,
  dam: LocusInference<A> | undefined,
  order: readonly A[],
  universe: readonly [A, A][],
): { possible: Possible<A>[]; weighted: boolean; because: string[] } | undefined {
  if (sire !== undefined && dam !== undefined) {
    const crossed = crossPossible(sire, dam, order);
    return { ...crossed, because: ["One allele from each parent."] };
  }

  const known = sire ?? dam;
  if (known === undefined) return undefined;

  // One parent known: the calf holds at least one allele that parent could
  // give. Nothing can be said about the other side.
  const givable = new Set(known.possible.flatMap((entry) => entry.pair));
  return {
    possible: universe
      .filter((pair) => pair.some((allele) => givable.has(allele)))
      .map((pair) => ({ pair })),
    weighted: false,
    because: ["One parent's alleles are known; the other side is not."],
  };
}

/**
 * Put the two kinds of evidence together, and decide which wins when they
 * disagree.
 *
 * **What the animal itself proves beats what its parents imply**, and getting
 * that backwards was a real bug with real consequences. A cow recorded as roan
 * out of two parents that both came out solid was being *forced* to solid —
 * her own coat discarded in favour of an inference — and every calf predicted
 * off her came out solid too, so a roan cow could never throw a roan.
 *
 * The coat is a fact about the animal standing in front of you. The parents'
 * cross is a deduction, and it rests on things that are often wrong: a colour
 * nobody recorded on a grandparent, a sire linked to the wrong bull, a page
 * misread. When a deduction contradicts an observation, it is the deduction
 * that is unsafe.
 *
 * So a disagreement keeps the observation and says so. That message is worth
 * more than the genotype it accompanies — a roan out of two solid parents
 * means something in that pedigree is wrong, and this is the only place that
 * would ever notice.
 */
function settle<A extends string>(
  direct: { possible: readonly Possible<A>[]; because: readonly string[] },
  parental: { possible: Possible<A>[]; weighted: boolean; because: string[] } | undefined,
): LocusInference<A> {
  if (parental === undefined) return finish(direct.possible, false, direct.because);

  const allowed = new Set(parental.possible.map((entry) => entry.pair.join("|")));
  const both = direct.possible.filter((entry) => allowed.has(entry.pair.join("|")));

  if (both.length === 0) {
    return finish(direct.possible, false, [
      ...direct.because,
      "Its parents cannot account for that coat — one of the three records is wrong. What the animal itself shows is kept; the pedigree is the part worth checking.",
    ]);
  }

  // Weights come from the cross, since that is the only side that has any.
  const weights = new Map(parental.possible.map((entry) => [entry.pair.join("|"), entry.chance]));
  return finish(
    both.map((entry) => ({
      pair: entry.pair,
      ...(weights.get(entry.pair.join("|")) === undefined
        ? {}
        : { chance: weights.get(entry.pair.join("|")) as number }),
    })),
    parental.weighted,
    [...direct.because, ...parental.because],
  );
}

/* --------------------------------------------------------------- the animal */

export interface CoatEvidence {
  /** A hair card. Wins outright — a test is not a deduction. */
  readonly tested?: CoatGenotype | undefined;
  /** What the animal looks like. */
  readonly observed?: Phenotype | undefined;
  /** The parents, already worked out. */
  readonly sire?: CoatInference | undefined;
  readonly dam?: CoatInference | undefined;
  /**
   * What this animal's own calves look like.
   *
   * A red calf proves it handed over an `e`. This is how a carrier is found
   * on a place that does not hair-test, and it is the one piece of evidence
   * that travels *up* a pedigree.
   */
  readonly progeny?: readonly Phenotype[] | undefined;
}

export interface CoatInference {
  readonly extension: LocusInference<ExtensionAllele>;
  readonly roan: LocusInference<RoanAllele>;
  /** Whether it is black and carrying red — the question anybody asks. */
  readonly carriesRed: { verdict: "yes" | "no" | "maybe"; chance?: number | undefined };
  /** The coat both loci amount to, when both are settled. */
  readonly coat?: string | undefined;
}

function inferExtension(evidence: CoatEvidence): LocusInference<ExtensionAllele> {
  if (evidence.tested?.extension !== undefined) {
    return {
      possible: [{ pair: evidence.tested.extension, chance: 1 }],
      settled: true,
      weighted: true,
      because: ["A hair card."],
    };
  }

  // What this animal itself proves, before anybody looks at its relatives.
  let direct: { possible: Possible<ExtensionAllele>[]; because: string[] } = {
    possible: EXTENSION_PAIRS.map((pair) => ({ pair })),
    because: [],
  };

  if (evidence.observed?.base !== undefined) {
    const base = evidence.observed.base;
    direct = narrow(
      direct,
      (pair) => extensionColour(pair) === base,
      base === "red"
        ? "It is red, and red is e/e — there is nothing else it can be."
        : "It is black, so it holds at least one ED or E.",
    );
  }

  if ((evidence.progeny ?? []).some((calf) => calf.base === "red")) {
    direct = narrow(
      direct,
      (pair) => pair.includes("e"),
      "It has thrown a red calf, so it handed over an e whatever it looks like.",
    );
  }

  const parental = fromParents(
    evidence.sire?.extension,
    evidence.dam?.extension,
    EXTENSION_ALLELES,
    EXTENSION_PAIRS,
  );

  return settle(direct, parental);
}

function inferRoan(evidence: CoatEvidence): LocusInference<RoanAllele> {
  if (evidence.tested?.roan !== undefined) {
    return {
      possible: [{ pair: evidence.tested.roan, chance: 1 }],
      settled: true,
      weighted: true,
      because: ["A hair card."],
    };
  }

  let direct: { possible: Possible<RoanAllele>[]; because: string[] } = {
    possible: ROAN_PAIRS.map((pair) => ({ pair })),
    because: [],
  };

  // Roan is co-dominant, so the coat *is* the genotype. This is the locus that
  // needs no testing at all: three phenotypes, three genotypes, no hiding.
  if (evidence.observed?.pattern !== undefined) {
    const pattern = evidence.observed.pattern;
    direct = narrow(
      direct,
      (pair) => roanColour(pair) === pattern,
      pattern === "roan"
        ? "It is roan, and roan is R/r — roan shows itself, so there is no other pair it can be."
        : pattern === "white"
          ? "It is white, which is r/r."
          : "It is solid, which is R/R.",
    );
  }

  // A calf's coat proves what each parent could give, the same way a red calf
  // does at the other locus.
  for (const [pattern, allele, reason] of [
    ["white", "r", "It has thrown a white calf, so it handed over an r."],
    ["solid", "R", "It has thrown a solid calf, so it handed over an R."],
  ] as const) {
    if (!(evidence.progeny ?? []).some((calf) => calf.pattern === pattern)) continue;
    direct = narrow(direct, (pair) => pair.includes(allele), reason);
  }

  const parental = fromParents(evidence.sire?.roan, evidence.dam?.roan, ROAN_ALLELES, ROAN_PAIRS);

  return settle(direct, parental);
}

/**
 * Everything that can be said about one animal's coat.
 *
 * Parents come in already worked out, so a caller walks the pedigree once and
 * this stays a pure function of what it was handed.
 */
export function inferCoat(evidence: CoatEvidence): CoatInference {
  const extension = inferExtension(evidence);
  const roan = inferRoan(evidence);

  const carrying = extension.possible.filter(
    (entry) => extensionColour(entry.pair) === "black" && entry.pair.includes("e"),
  );
  const carriesRed: CoatInference["carriesRed"] =
    carrying.length === 0
      ? { verdict: "no" }
      : carrying.length === extension.possible.length
        ? { verdict: "yes" }
        : { verdict: "maybe", ...(chanceOfCarryingRed(evidence, extension) ?? {}) };

  const coat =
    extension.settled && roan.settled && extension.possible[0] && roan.possible[0]
      ? coatName(extension.possible[0].pair, roan.possible[0].pair)
      : undefined;

  return {
    extension,
    roan,
    carriesRed,
    ...(coat === undefined ? {} : { coat }),
  };
}

/**
 * The odds a black animal is hiding red, when they can be worked out exactly.
 *
 * From how often each parent hands `e` down rather than from a guess at which
 * pair each parent is — see `transmits`. Two parents that each pass `e` half
 * the time throw a quarter red, a half carrying and a quarter clear; among the
 * three that are *black*, two of them carry. That two-thirds is exact, and it
 * is the number that decides whether a heifer is worth testing before she goes
 * to a red bull.
 *
 * Only ever reported for an animal known to be black. "Carrying" means hiding
 * it behind a dark coat, and on an animal whose colour nobody wrote down there
 * is no question to answer.
 */
function chanceOfCarryingRed(
  evidence: CoatEvidence,
  extension: LocusInference<ExtensionAllele>,
): { chance: number } | undefined {
  if (evidence.observed?.base !== "black") return undefined;
  if (extension.weighted) {
    const carrying = extension.possible.filter(
      (entry) => extensionColour(entry.pair) === "black" && entry.pair.includes("e"),
    );
    return { chance: carrying.reduce((sum, entry) => sum + (entry.chance ?? 0), 0) };
  }

  const fromSire = evidence.sire === undefined ? undefined : transmits(evidence.sire.extension, "e");
  const fromDam = evidence.dam === undefined ? undefined : transmits(evidence.dam.extension, "e");
  if (fromSire === undefined || fromDam === undefined) return undefined;

  const red = fromSire * fromDam;
  const carries = fromSire * (1 - fromDam) + (1 - fromSire) * fromDam;
  // Conditioned on the animal being black, so the red quarter is off the table.
  if (red >= 1) return undefined;
  return { chance: carries / (1 - red) };
}

export interface CalfColour {
  /** What the calf can be, commonest first. */
  readonly outcomes: readonly { name: string; chance: number }[];
  /** What stopped a fuller answer, when something did. */
  readonly missing: readonly string[];
}

/**
 * What colour a calf out of these two could be (spec §5.2).
 *
 * Off the parents' *inferred* genotypes rather than off hair cards, which is
 * the whole point: this farm has cards for almost nothing, and a planner that
 * says "no colour genotype on file" for every pairing is a planner nobody
 * opens twice. A red cow is `e/e` whether or not anybody paid a lab to say so.
 *
 * Worked from how often each parent hands an allele down rather than from
 * which pair it is, so it stays exact where the pair is not. Two parents each
 * known to carry red — `ED/e` or `E/e`, nobody knows which — throw a quarter
 * red, and that quarter is not in doubt even though neither parent's pair is
 * settled.
 *
 * A locus nothing can be said about is left out rather than guessed at, and
 * named in `missing` so the screen can say which half of the answer is absent
 * instead of showing a confident-looking list that is only half the story.
 */
export function predictCalfColour(sire: CoatInference, dam: CoatInference): CalfColour {
  /**
   * Which side is actually short.
   *
   * "Neither parent's roan pair is pinned down" is plainly wrong when the cow
   * is a roan and it is the bull nobody has recorded a colour for — and it
   * sends somebody to the wrong record. Naming the side is the difference
   * between a message that gets acted on and one that gets ignored.
   */
  const shortOf = (fromSire: number | undefined, fromDam: number | undefined): string =>
    fromSire === undefined && fromDam === undefined
      ? "neither parent's"
      : fromSire === undefined
        ? "the sire's"
        : "the dam's";

  const missing: string[] = [];

  const redFromSire = transmits(sire.extension, "e");
  const redFromDam = transmits(dam.extension, "e");
  // A parent that hands red down *never* settles it on its own: nothing times
  // zero is zero, so a homozygous-black bull makes every calf black whatever
  // is unknown about the cow. Requiring both sides would throw that away.
  const red =
    redFromSire === 0 || redFromDam === 0
      ? 0
      : redFromSire === undefined || redFromDam === undefined
        ? undefined
        : redFromSire * redFromDam;
  const base = red === undefined ? undefined : { red, black: 1 - red };
  if (base === undefined) {
    missing.push(
      `Red or black is open — ${shortOf(redFromSire, redFromDam)} Extension is not pinned down.` +
        " A colour on the animal usually settles it: red is e/e outright, and a black one out of a red parent carries red.",
    );
  }

  const roanFromSire = transmits(sire.roan, "r");
  const roanFromDam = transmits(dam.roan, "r");
  const pattern =
    roanFromSire === undefined || roanFromDam === undefined
      ? undefined
      : {
          white: roanFromSire * roanFromDam,
          roan: roanFromSire * (1 - roanFromDam) + (1 - roanFromSire) * roanFromDam,
          solid: (1 - roanFromSire) * (1 - roanFromDam),
        };
  if (pattern === undefined) {
    missing.push(
      `Solid, roan or white is open — ${shortOf(roanFromSire, roanFromDam)} roan pair is not pinned down.` +
        " A colour settles this one outright, because roan hides nothing: roan is R/r, solid is R/R and white is r/r.",
    );
  }

  // Representative pairs, only so the naming lives in one place — `coatName`
  // already knows that black through roan is a blue roan and that a white
  // animal's points follow its base.
  const BASE_PAIR: Record<"black" | "red", readonly [ExtensionAllele, ExtensionAllele]> = {
    black: ["ED", "ED"],
    red: ["e", "e"],
  };
  const PATTERN_PAIR: Record<"solid" | "roan" | "white", readonly [RoanAllele, RoanAllele]> = {
    solid: ["R", "R"],
    roan: ["R", "r"],
    white: ["r", "r"],
  };

  const outcomes: { name: string; chance: number }[] = [];
  if (base !== undefined && pattern !== undefined) {
    // The loci are independent, so the coat is one multiplied by the other.
    for (const [baseName, baseChance] of Object.entries(base) as [
      "black" | "red",
      number,
    ][]) {
      for (const [patternName, patternChance] of Object.entries(pattern) as [
        "solid" | "roan" | "white",
        number,
      ][]) {
        const chance = baseChance * patternChance;
        if (chance <= 0) continue;
        outcomes.push({ name: coatName(BASE_PAIR[baseName], PATTERN_PAIR[patternName]), chance });
      }
    }
  } else if (base !== undefined) {
    // Named so a half-answer cannot be read as a whole one. "black 50%" beside
    // "red 50%" looks exactly like a finished prediction — solid black or
    // solid red — when what it actually means is that the pattern is still
    // open and every one of these could arrive roan.
    for (const [name, chance] of Object.entries(base)) {
      if (chance > 0) outcomes.push({ name: `${name} — solid, roan or white`, chance });
    }
  } else if (pattern !== undefined) {
    for (const [name, chance] of Object.entries(pattern)) {
      if (chance > 0) outcomes.push({ name: `${name} — red or black`, chance });
    }
  }

  return {
    outcomes: outcomes.sort((left, right) => right.chance - left.chance),
    missing,
  };
}

/** The pair as a hair card would write it, or a description of what is left. */
export function describeLocus<A extends string>(
  locus: LocusInference<A>,
  order: readonly A[],
): string {
  if (locus.possible.length === 0) return "unknown";
  if (locus.settled) return pairKey(locus.possible[0]?.pair as readonly [A, A], order);

  return locus.possible
    .map((entry) => {
      const name = pairKey(entry.pair, order);
      return locus.weighted && entry.chance !== undefined
        ? `${name} (${Math.round(entry.chance * 100)}%)`
        : name;
    })
    .join(" or ");
}

/** `E/e` and the rest, for anything that wants the settled pairs only. */
export function settledGenotype(inference: CoatInference): CoatGenotype {
  return {
    ...(inference.extension.settled && inference.extension.possible[0] !== undefined
      ? { extension: inference.extension.possible[0].pair }
      : {}),
    ...(inference.roan.settled && inference.roan.possible[0] !== undefined
      ? { roan: inference.roan.possible[0].pair }
      : {}),
  };
}
