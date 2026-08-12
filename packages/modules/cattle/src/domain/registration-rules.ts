import type { Association, BreedShare } from "./cattle-profile.js";
import {
  MAINE_ANGUS_NOTE,
  MAINE_CLASS_LABELS,
  maineClassFor,
  maineClassFromCode,
  mainePaper,
  mainePercent,
  meetsMaineMinimum,
} from "./maine-upgrade.js";

/**
 * What an animal is eligible to be registered as (spec §5.2).
 *
 * A breed makeup is a number; a *registration class* is what that number buys
 * you, and it is the thing that decides whether a calf can be papered
 * Fullblood, Purebred or Percentage — which is most of what it is worth. The
 * rules are the associations' own, quoted by the owner, and they are written
 * here rather than in a screen because the pairing planner and the animal
 * record have to answer identically: "the calf would be 89% Chi" and "the calf
 * could be papered Purebred" are the same fact stated twice, and two places
 * computing it is two places to disagree.
 *
 * **What is here is what the associations publish, and nothing else.** All
 * three are transcribed from their own text: the Chianina and Shorthorn rules
 * from the rulebook extracts, the Maine-Anjou classes from the AMAA upgrading
 * chart. Nothing is inferred — a confidently wrong eligibility class is worse
 * than a blank one, because it is the sort of thing that gets quoted in a sale
 * catalogue.
 *
 * Percentages are compared with a small tolerance, because an association's
 * arithmetic and ours will not agree to the last decimal — 87.5% and 87.49%
 * are the same animal, and a strict comparison would deny it a class it
 * plainly qualifies for.
 */

/** Half a point, the same tolerance a composition is checked against. */
const TOLERANCE = 0.5;

export interface RegistrationClass {
  readonly association: Association;
  /** What the association calls it. */
  readonly name: string;
  /** Why it qualifies, in the association's own terms. */
  readonly because: string;
  /**
   * Conditions the makeup cannot settle.
   *
   * Chiangus requires a black or red polled or scurred animal with registered
   * parents; a percentage alone does not make one. Named rather than assumed,
   * so nobody quotes a class the animal does not actually hold.
   */
  readonly alsoRequires?: readonly string[] | undefined;
}

export interface EligibilityVerdict {
  readonly classes: readonly RegistrationClass[];
  /**
   * Set when the association's rules are not on file.
   *
   * Distinct from "qualifies for nothing", which is a real answer.
   */
  readonly unknownRules?: string | undefined;
}

const percentOf = (composition: readonly BreedShare[], ...codes: readonly string[]): number => {
  const wanted = new Set(codes.map((code) => code.toLowerCase()));
  return composition
    .filter((share) => wanted.has(share.breed.trim().toLowerCase()))
    .reduce((total, share) => total + share.percent, 0);
};

const otherThan = (composition: readonly BreedShare[], ...codes: readonly string[]): number => {
  const wanted = new Set(codes.map((code) => code.toLowerCase()));
  return composition
    .filter((share) => !wanted.has(share.breed.trim().toLowerCase()))
    .reduce((total, share) => total + share.percent, 0);
};

const atLeast = (value: number, threshold: number): boolean => value >= threshold - TOLERANCE;

/**
 * Chianina, per the ACA rulebook the owner supplied.
 *
 * Fullblood at 100%, Purebred at 7/8, and the composites below that. The
 * Chiangus rule is the interesting one: it is not a percentage of Chianina at
 * all but a ceiling — no more than 6.249% of *any other* breed, on a black or
 * red polled or scurred animal out of registered parents.
 */
function chianina(composition: readonly BreedShare[]): RegistrationClass[] {
  const chi = percentOf(composition, "CA", "CH", "CHIA", "CHIANINA");
  const angus = percentOf(composition, "AN", "ANGUS", "RA", "RED ANGUS");
  const hereford = percentOf(composition, "HH", "HEREFORD", "PH");
  const found: RegistrationClass[] = [];

  const both = (name: string, because: string, alsoRequires?: readonly string[]) =>
    found.push({
      association: "ACA",
      name,
      because,
      ...(alsoRequires === undefined ? {} : { alsoRequires }),
    });

  if (atLeast(chi, 100)) {
    both("Fullblood Chianina", "100% Chianina.", [
      "The sire and dam are registered in the ACA herdbook",
    ]);
  } else if (atLeast(chi, 87.5)) {
    both("Purebred Chianina", `${chi}% Chianina — 7/8 or better.`, [
      "The sire and dam are registered in the ACA herdbook",
    ]);
  }

  // Chiangus is a ceiling on everything that is not Chianina or Angus, not a
  // floor on Chianina.
  const strangers = otherThan(composition, "CA", "CH", "CHIA", "CHIANINA", "AN", "ANGUS", "RA", "RED ANGUS");
  if (chi > 0 && angus > 0 && strangers <= 6.249 + TOLERANCE) {
    both(
      "Chiangus or Red Chiangus",
      `Chianina on Angus with ${strangers === 0 ? "no" : `${Math.round(strangers * 100) / 100}%`} of any other breed — the rule allows up to 6.249%.`,
      [
        "Black or red, with white only from the navel back and kept to the underline",
        "Polled or scurred — and scurs must not have been removed",
        "A Foundation parent registered with the Angus, Red Angus or ACA herdbook",
      ],
    );
  }

  if (chi > 0 && hereford > 0) {
    both("Chiford", "Fullblood Chianina on Hereford or Polled Hereford.", [
      "The Hereford parent registered with the American Hereford Association or the ACA",
      "Colour from pale fawn through to Hereford red and white",
    ]);
  }

  if (chi > 0 && found.length === 0) {
    both(
      "Percentage Chianina",
      `${Math.round(chi * 100) / 100}% Chianina — carries Chianina genetics without meeting a composite's terms.`,
    );
  }

  return found;
}

/**
 * Maine-Anjou, per the AMAA upgrading chart.
 *
 * The paper classification follows from the fraction — MaineTainer on green
 * from 1/4 to 5/8, High Maine on brown from 3/4 up — and the floor is a
 * quarter, below which the association registers nothing at all.
 */
function maine(
  composition: readonly BreedShare[],
  stated?: string | undefined,
): RegistrationClass[] {
  // The papers win. `Classification: PB` is the registry's own decision, and
  // an animal upgraded years ago can hold a class its current makeup would not
  // earn — recomputing it from a percentage would take that away.
  const recorded = stated === undefined ? undefined : maineClassFromCode(stated);
  if (recorded !== undefined) {
    const paper = mainePaper(recorded);
    return [
      {
        association: "AMAA",
        name: `${paper ?? "Maine-Anjou"} — ${MAINE_CLASS_LABELS[recorded]}`,
        because: `The papers state ${stated as string}.`,
        alsoRequires:
          paper === "MaineTainer" ? [MAINE_ANGUS_NOTE] : ["Registered with the AMAA"],
      },
    ];
  }

  const percent = mainePercent(composition);
  if (percent <= 0) return [];

  if (!meetsMaineMinimum(percent)) {
    return [
      {
        association: "AMAA",
        name: "Not eligible",
        because: `${Math.round(percent * 100) / 100}% Maine-Anjou — under the quarter that is the least the AMAA will register.`,
      },
    ];
  }

  const maineClass = maineClassFor(percent);
  const paper = mainePaper(maineClass);
  const alsoRequires = [
    "The sire registered Maine-Anjou, or with a commercial number on file with the AMAA",
    ...(paper === "MaineTainer" ? [MAINE_ANGUS_NOTE] : []),
  ];

  return [
    {
      association: "AMAA",
      name: `${paper ?? "Maine-Anjou"} — ${MAINE_CLASS_LABELS[maineClass]}`,
      because: `${Math.round(percent * 100) / 100}% Maine-Anjou.`,
      alsoRequires,
    },
  ];
}

/** Shorthorn, per the ASA text the owner supplied. */
function shorthorn(composition: readonly BreedShare[]): RegistrationClass[] {
  const shorthorn = percentOf(composition, "SH", "SHORTHORN");

  if (atLeast(shorthorn, 100)) {
    return [{ association: "ASA", name: "Purebred Shorthorn", because: "100% Shorthorn." }];
  }
  if (atLeast(shorthorn, 50)) {
    return [
      {
        association: "ASA",
        name: "ShorthornPlus",
        because: `${Math.round(shorthorn * 100) / 100}% Shorthorn — at least half, with other breeds allowed.`,
      },
    ];
  }
  return [];
}

/**
 * Every class an animal's makeup qualifies it for.
 *
 * More than one is normal and correct: a bull can be Purebred Chianina with
 * the ACA and ShorthornPlus with the ASA at the same time, and that is exactly
 * the dual registration this farm keeps.
 */
export function registrationClasses(
  composition: readonly BreedShare[],
  /** The class an AMAA paper states, when one is on file. It wins. */
  maineClassification?: string | undefined,
): EligibilityVerdict {
  if (composition.length === 0) {
    return { classes: [], unknownRules: "No breed makeup on file, so nothing can be worked out." };
  }

  return {
    classes: [
      ...chianina(composition),
      ...maine(composition, maineClassification),
      ...shorthorn(composition),
    ],
  };
}
