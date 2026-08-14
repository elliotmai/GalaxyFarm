import { ageInDays, type Animal, type Sex, type Ulid } from "@galaxy-farm/core";

/**
 * What kind of animal this is, in the words used at the chute (spec §5.2).
 *
 * Cows, bulls, steers and calves. Sex alone does not answer it — a bull calf
 * and a herd bull are both `male`, and counting them together gives a bull
 * number that is nonsense on a place that keeps one. Age alone does not
 * either. The class is the pair.
 *
 * ## Where the year comes from
 *
 * A calf is anything under twelve months, of either sex, which is how the herd
 * is actually spoken about here: heifer calves and bull calves are calves
 * until they are yearlings. Nothing about it is derived from a rule elsewhere
 * in the app — it is a convention, so it is a constant with its name on it
 * rather than a `< 365` buried in a comparison.
 *
 * ## A steer is a steer from the day he is cut
 *
 * Not a calf that later becomes one. Banding is a decision somebody made about
 * what that animal is *for*, and on a show place it is the decision that puts
 * him in a different pen, a different ration and a different sale. A
 * six-month-old steer counted as a calf disappears from the number that
 * matters most about him.
 *
 * ## A heifer becomes a cow by calving, not by ageing
 *
 * This is the one class that is not a fact about the animal on its own. A
 * four-year-old female who has never calved is still a heifer, and a
 * two-year-old who has raised one is a cow — the distinction is what she has
 * *done*, and it is the one that decides whether she is on a breeding list, a
 * replacement list or a cull list.
 *
 * So `cattleClass` needs to be told whether she has calved. Callers that do not
 * know say nothing, and she reads as a heifer: that is the honest default,
 * because a female with no calving on file is far likelier never to have calved
 * than to have calved without anybody writing it down.
 */

export const CATTLE_CLASSES = ["cow", "heifer", "bull", "steer", "calf"] as const;
export type CattleClass = (typeof CATTLE_CLASSES)[number];

/** Under this many days old is a calf. Twelve months, as it is spoken. */
export const CALF_MAX_DAYS = 365;

export const CATTLE_CLASS_LABELS: Readonly<Record<CattleClass, string>> = {
  cow: "Cows",
  heifer: "Heifers",
  bull: "Bulls",
  steer: "Steers",
  calf: "Calves",
};

/** Singular, for a table cell where the row is one animal. */
export const CATTLE_CLASS_SINGULAR: Readonly<Record<CattleClass, string>> = {
  cow: "Cow",
  heifer: "Heifer",
  bull: "Bull",
  steer: "Steer",
  calf: "Calf",
};

const classForSex = (sex: Sex): CattleClass | undefined => {
  // Female resolves to heifer or cow further down, once calving is known.
  if (sex === "female") return "heifer";
  if (sex === "male") return "bull";
  if (sex === "steer") return "steer";
  return undefined;
};

/** What the caller knows beyond the animal record itself. */
export interface ClassContext {
  /**
   * Whether this female has ever calved.
   *
   * Absent means "not as far as anything on file says", which reads as a
   * heifer. Deliberately not "unknown": a fifth answer on a screen that sorts
   * the herd would be a bucket nobody could act on.
   */
  readonly hasCalved?: boolean | undefined;
}

/**
 * Which class an animal falls in, as of a date.
 *
 * Undefined when the sex is not recorded — there is no honest answer, and
 * guessing puts an animal in a count somebody makes decisions on. The screens
 * show those separately rather than dropping them, because an animal missing
 * from every group is one nobody will ever go and fix.
 *
 * **A missing birthday reads as grown, not as a calf.** It has to read as
 * something, and an animal with no date is far more likely one that came onto
 * the place already grown than one born here — calves born here arrive through
 * a calving record, which carries the date. Reading it the other way would put
 * bought cows in the calf count every time.
 */
export function cattleClass(
  animal: Pick<Animal, "sex" | "dob">,
  asOf: Date,
  context: ClassContext = {},
): CattleClass | undefined {
  const grown = classForSex(animal.sex);
  if (grown === undefined) return undefined;

  // Cut is cut, whatever his age.
  if (grown === "steer") return "steer";

  // A female that has calved is a cow at any age. It happens: a bought-in
  // two-year-old with a calf at side is not a heifer, whatever her birthday
  // says, and she would otherwise land in the calf bucket if she were young
  // enough — which is the one reading that is plainly wrong.
  if (grown === "heifer" && context.hasCalved === true) return "cow";

  const age = ageInDays(animal, asOf);
  if (age !== undefined && age < CALF_MAX_DAYS) return "calf";

  return grown;
}

export interface ClassCount {
  readonly cattleClass: CattleClass;
  readonly label: string;
  readonly count: number;
}

/**
 * The herd split by class, in a fixed order.
 *
 * Fixed rather than sorted by size, because this is read at a glance every day
 * and a row of numbers that reorders itself as calves are born has to be read
 * word by word every time.
 *
 * Empty classes are kept. "Bulls 0" is a fact worth seeing on a place that
 * breeds by AI; a class that vanishes when it empties looks like a class the
 * app forgot about.
 */
export function classCounts(
  animals: readonly (Pick<Animal, "sex" | "dob"> & { id?: Ulid })[],
  asOf: Date,
  /** Ids of females known to have calved. Absent reads as "none on file". */
  calved: ReadonlySet<Ulid> = new Set(),
): ClassCount[] {
  const counted = new Map<CattleClass, number>(CATTLE_CLASSES.map((name) => [name, 0]));

  for (const animal of animals) {
    const name = cattleClass(animal, asOf, {
      hasCalved: animal.id !== undefined && calved.has(animal.id),
    });
    if (name !== undefined) counted.set(name, (counted.get(name) ?? 0) + 1);
  }

  return CATTLE_CLASSES.map((name) => ({
    cattleClass: name,
    label: CATTLE_CLASS_LABELS[name],
    count: counted.get(name) ?? 0,
  }));
}

/** How many have no class at all, because nobody recorded a sex. */
export function unclassified(animals: readonly Pick<Animal, "sex" | "dob">[], asOf: Date): number {
  return animals.filter((animal) => cattleClass(animal, asOf) === undefined).length;
}

/**
 * Every female with a calving on file, as a set to hand to the two above.
 *
 * Built from the records rather than a flag on the animal, so a calving entered
 * or corrected moves her between heifer and cow without anything else needing
 * to be remembered.
 */
export function damsThatHaveCalved(calvings: readonly { readonly damId: Ulid }[]): Set<Ulid> {
  return new Set(calvings.map((record) => record.damId));
}
