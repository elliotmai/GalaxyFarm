import { ageInDays, type Animal, type Sex } from "@galaxy-farm/core";

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
 * ## Heifers
 *
 * Deliberately not a fifth class. A female over a year is counted as a cow
 * here even if she has never calved, because the four names above are the ones
 * this farm sorts by. Splitting heifers out is a real question — it changes
 * who is on a breeding list — but it is a different question from this one,
 * and answering it needs a first-calving date rather than a birthday.
 */

export const CATTLE_CLASSES = ["cow", "bull", "steer", "calf"] as const;
export type CattleClass = (typeof CATTLE_CLASSES)[number];

/** Under this many days old is a calf. Twelve months, as it is spoken. */
export const CALF_MAX_DAYS = 365;

export const CATTLE_CLASS_LABELS: Readonly<Record<CattleClass, string>> = {
  cow: "Cows",
  bull: "Bulls",
  steer: "Steers",
  calf: "Calves",
};

/** Singular, for a table cell where the row is one animal. */
export const CATTLE_CLASS_SINGULAR: Readonly<Record<CattleClass, string>> = {
  cow: "Cow",
  bull: "Bull",
  steer: "Steer",
  calf: "Calf",
};

const classForSex = (sex: Sex): CattleClass | undefined => {
  if (sex === "female") return "cow";
  if (sex === "male") return "bull";
  if (sex === "steer") return "steer";
  return undefined;
};

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
): CattleClass | undefined {
  const grown = classForSex(animal.sex);
  if (grown === undefined) return undefined;

  // Cut is cut, whatever his age.
  if (grown === "steer") return "steer";

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
 * The herd split four ways, in a fixed order.
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
  animals: readonly Pick<Animal, "sex" | "dob">[],
  asOf: Date,
): ClassCount[] {
  const counted = new Map<CattleClass, number>(CATTLE_CLASSES.map((name) => [name, 0]));

  for (const animal of animals) {
    const name = cattleClass(animal, asOf);
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
