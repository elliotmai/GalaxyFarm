import { addDays, type Ulid } from "@galaxy-farm/core";

/**
 * The boarding rules, as policy objects (spec §5.7).
 *
 * §5.7 asks for exactly this shape: "your rules encoded as first-class,
 * testable policy objects, evaluated at booking and continuously against DOB".
 * The reason they are objects rather than `if` statements scattered through a
 * booking form is that they are also the text of an agreement somebody signs —
 * when a rule changes, one place changes, and the booking gate, the deadline
 * projection, and the liability wording all follow.
 *
 * **Client enrollments only.** §5.7 is explicit and it matters: "your own
 * calves bypass eligibility gates". A rule engine that stopped you weaning
 * your own calf on your own schedule would be worse than none.
 */

export const RULE_IDS = [
  "weaned-at-drop-off",
  "under-six-months",
  "visible-id",
  "bull-ringed-by-eight-months",
  "bull-departs-by-ten-months",
  "depart-by-twelve-months",
  "behaviour-termination",
  "owner-pays-consumables",
  "owner-liability",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

/** How a rule is enforced, in the spec's own terms. */
export type Enforcement =
  /** Checked before drop-off is allowed. */
  | "booking-gate"
  /** Computed from a date of birth, continuously. */
  | "dob-deadline"
  /** A person decides and documents it. */
  | "manual"
  /** Carried into billing or the agreement text, not gated. */
  | "contract";

export interface BoardingRule {
  readonly id: RuleId;
  /** The rule as §5.7's table writes it. */
  readonly statement: string;
  readonly enforcement: Enforcement;
  /** For a deadline rule: the age in months at which it bites. */
  readonly ageMonths?: number;
  /** For a deadline rule: which animals it applies to. */
  readonly appliesTo?: "bulls" | "heifers-and-steers" | "all";
}

export const BOARDING_RULES: readonly BoardingRule[] = [
  {
    id: "weaned-at-drop-off",
    statement: "Must be weaned at drop-off (no pairs unless cow is here for breeding)",
    enforcement: "booking-gate",
  },
  {
    id: "under-six-months",
    statement: "Under 6 months old at drop-off",
    enforcement: "dob-deadline",
    ageMonths: 6,
    appliesTo: "all",
  },
  { id: "visible-id", statement: "Tagged / visible ID", enforcement: "booking-gate" },
  {
    id: "bull-ringed-by-eight-months",
    statement: "Bulls ringed by 8 months",
    enforcement: "dob-deadline",
    ageMonths: 8,
    appliesTo: "bulls",
  },
  {
    id: "bull-departs-by-ten-months",
    statement: "Bulls depart by 10 months",
    enforcement: "dob-deadline",
    ageMonths: 10,
    appliesTo: "bulls",
  },
  {
    id: "depart-by-twelve-months",
    statement: "Heifers/steers depart by 12 months",
    enforcement: "dob-deadline",
    ageMonths: 12,
    appliesTo: "heifers-and-steers",
  },
  { id: "behaviour-termination", statement: "Behavior termination clause", enforcement: "manual" },
  {
    id: "owner-pays-consumables",
    statement: "Owner pays feed & supplies",
    enforcement: "contract",
  },
  {
    id: "owner-liability",
    statement: "Owner liability for damages / no responsibility assumed / owner handles medical",
    enforcement: "contract",
  },
];

export function ruleById(id: RuleId): BoardingRule {
  const found = BOARDING_RULES.find((rule) => rule.id === id);
  // Unreachable through the type, but a thrown error beats an undefined that
  // silently disables a gate.
  if (found === undefined) throw new Error(`No boarding rule "${id}"`);
  return found;
}

export interface RuleSubject {
  readonly animalId: Ulid;
  readonly ownership: "own" | "client";
  readonly dob?: Date | undefined;
  readonly sex: "male" | "female" | "steer" | "unknown";
  readonly weaned: boolean;
  readonly hasVisibleId: boolean;
  readonly ringed?: boolean | undefined;
}

export interface RuleViolation {
  readonly rule: BoardingRule;
  readonly message: string;
  /** True when the animal simply is not eligible; false when it is a warning. */
  readonly blocking: boolean;
}

function ageInMonthsAt(dob: Date | undefined, at: Date): number | undefined {
  if (dob === undefined) return undefined;
  return (at.getFullYear() - dob.getFullYear()) * 12 + (at.getMonth() - dob.getMonth());
}

function appliesToSex(rule: BoardingRule, sex: RuleSubject["sex"]): boolean {
  if (rule.appliesTo === "all" || rule.appliesTo === undefined) return true;
  if (rule.appliesTo === "bulls") return sex === "male";
  return sex === "female" || sex === "steer";
}

/**
 * Evaluate the gates for a proposed drop-off.
 *
 * Own animals return nothing at all — not "no violations found", but a
 * deliberate skip, because §5.7 exempts them from eligibility entirely.
 */
export function evaluateRules(subject: RuleSubject, at: Date): RuleViolation[] {
  if (subject.ownership === "own") return [];

  const violations: RuleViolation[] = [];
  const age = ageInMonthsAt(subject.dob, at);

  if (!subject.weaned) {
    violations.push({
      rule: ruleById("weaned-at-drop-off"),
      message: "This calf is not weaned yet",
      blocking: true,
    });
  }

  if (!subject.hasVisibleId) {
    violations.push({
      rule: ruleById("visible-id"),
      message: "This calf needs a tag or another visible ID before drop-off",
      blocking: true,
    });
  }

  if (age !== undefined && age >= 6) {
    violations.push({
      rule: ruleById("under-six-months"),
      message: `This calf is ${age} months old — the limit at drop-off is 6`,
      blocking: true,
    });
  }

  if (subject.dob === undefined) {
    // Not a violation of a rule, but the age gates cannot run without it, and
    // silently passing an animal whose age is unknown is how one arrives.
    violations.push({
      rule: ruleById("under-six-months"),
      message: "No date of birth, so the age limit cannot be checked",
      blocking: true,
    });
  }

  return violations;
}

export interface RuleDeadline {
  readonly rule: BoardingRule;
  readonly animalId: Ulid;
  readonly dueOn: Date;
  readonly overdue: boolean;
  readonly satisfied: boolean;
}

/**
 * The dates the age rules produce, projected onto the calendar (§6).
 *
 * Continuous rather than checked at booking: a calf that arrives at four
 * months is ringed at eight and gone at ten, and both dates are knowable the
 * day it arrives.
 */
export function ruleDeadlines(subject: RuleSubject, now: Date): RuleDeadline[] {
  if (subject.ownership === "own" || subject.dob === undefined) return [];

  return BOARDING_RULES.filter((rule) => rule.enforcement === "dob-deadline")
    .filter((rule) => rule.ageMonths !== undefined && rule.ageMonths > 6)
    .filter((rule) => appliesToSex(rule, subject.sex))
    .map((rule) => {
      const dueOn = addDays(subject.dob as Date, Math.round((rule.ageMonths as number) * 30.4375));
      return {
        rule,
        animalId: subject.animalId,
        dueOn,
        overdue: now >= dueOn,
        satisfied: rule.id === "bull-ringed-by-eight-months" ? subject.ringed === true : false,
      };
    })
    .sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime());
}

/** Can this calf be dropped off today? */
export function isEligibleForDropOff(subject: RuleSubject, at: Date): boolean {
  return evaluateRules(subject, at).every((violation) => !violation.blocking);
}
