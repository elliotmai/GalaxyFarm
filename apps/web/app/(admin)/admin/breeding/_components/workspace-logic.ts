import { addDays, ageInDays, displayName, type Animal } from "@galaxy-farm/core";
import {
  allRegistrations,
  carriedDefects,
  DEFAULT_GESTATION_DAYS,
  HOUSE_RULE_DEFECTS,
  isKnownFree,
  matingAllowed,
  matingDefectRisk,
  normaliseRegistration,
  predictCalfColour,
  projectedDueDate,
  relatedness,
  relatednessVerdict,
  RELATEDNESS_GENERATIONS,
  serviceGroups,
  statusOf,
  type BreedingRecord,
  type CalvingLike,
  type CattleProfile,
  type CoatInference,
  type ExternalAnimal,
  type GeneticTest,
  type ParentRef,
  type PlannedMating,
  type RegistryAnimal,
} from "@galaxy-farm/module-cattle";
import type { Tone } from "@galaxy-farm/ui";

/**
 * The arithmetic behind the breeding workspace, kept apart from the screen so
 * it can be pinned by tests without rendering three panes.
 *
 * Nothing here is new genetics. Defects, relatedness and colour are the same
 * module functions the pairing planner on the breeding log calls; this only
 * boils each one down to the single line a desk pane has room for.
 */

/**
 * Which season a mating made now belongs to: the year its calf lands.
 *
 * There is no breeding-window setting on file, so the season is named by the
 * calf rather than the service — a cow bred this winter calves next autumn,
 * and that calf crop is what a breeder calls "the 2027 season".
 */
export function seasonOf(now: Date): string {
  return `${addDays(now, DEFAULT_GESTATION_DAYS).getFullYear()} season`;
}

/**
 * How far ahead a calving still counts as "before the window".
 *
 * A cow calving within this many days is cycling again inside the coming
 * season and needs a bull picked for her now; one due later is next year's
 * decision.
 */
export const SEASON_LEAD_DAYS = 120;

/**
 * A service whose due date is this far gone with no calving recorded is not a
 * pregnancy any more — it is a calving nobody entered, or a cow that slipped.
 * Either way she is not carrying, and leaving her off the list hides her.
 */
const STALE_DUE_DAYS = 30;

export type CowState =
  | { readonly kind: "open"; readonly rebreed: boolean }
  | { readonly kind: "due"; readonly due: Date };

export interface CowToBreed {
  readonly animal: Animal;
  readonly state: CowState;
  /** "Open · 6 yr · PHA carrier" — already joined, so the row stays dumb. */
  readonly line: string;
  /** Her open plan, when one has been made. */
  readonly plan?: PlannedMating | undefined;
}

const day = (value: Date): string =>
  value.toLocaleDateString(undefined, { day: "numeric", month: "short" });

function ageText(animal: Animal, now: Date): string | undefined {
  const days = ageInDays(animal, now);
  if (days === undefined || days < 0) return undefined;
  return days >= 730 ? `${Math.floor(days / 365.25)} yr` : `${Math.floor(days / 30.437)} mo`;
}

/**
 * The cows this season's list is about: active cattle females who are open,
 * or who calve before the season's matings have to be decided.
 *
 * Read off her latest attempt (`serviceGroups`), the same grouping the
 * breeding log uses, so a cow re-bred after coming back open is judged by the
 * service that still stands rather than the one it answered.
 */
export function cowsToBreed({
  animals,
  profiles,
  breedings,
  calvings,
  plans,
  now,
}: {
  readonly animals: readonly Animal[];
  readonly profiles: readonly CattleProfile[];
  readonly breedings: readonly BreedingRecord[];
  readonly calvings: readonly CalvingLike[];
  readonly plans: readonly PlannedMating[];
  readonly now: Date;
}): CowToBreed[] {
  const profileOf = new Map(profiles.map((profile) => [profile.animalId, profile]));

  const latest = new Map<string, ReturnType<typeof serviceGroups>[number]>();
  for (const group of serviceGroups(breedings, calvings)) {
    const held = latest.get(group.damId);
    if (held === undefined || held.standing.date < group.standing.date) {
      latest.set(group.damId, group);
    }
  }

  // The newest open plan per cow. An older one left open alongside it is a
  // plan somebody changed their mind about and never set aside.
  const planOf = new Map<string, PlannedMating>();
  for (const plan of plans) {
    if (plan.planStatus !== "open" || plan.damId === undefined) continue;
    const held = planOf.get(plan.damId);
    if (held === undefined || held.createdAt < plan.createdAt) planOf.set(plan.damId, plan);
  }

  const horizon = addDays(now, SEASON_LEAD_DAYS);
  const stale = addDays(now, -STALE_DUE_DAYS);

  const rows: CowToBreed[] = [];
  for (const animal of animals) {
    if (animal.species !== "cattle" || animal.sex !== "female" || animal.status !== "active") {
      continue;
    }

    const group = latest.get(animal.id);
    let state: CowState = { kind: "open", rebreed: false };
    if (group !== undefined && group.calving === undefined) {
      const due = projectedDueDate(group.standing);
      if (group.standing.pregCheck?.result === "open") state = { kind: "open", rebreed: true };
      else if (due >= stale) state = { kind: "due", due };
    }
    if (state.kind === "due" && state.due > horizon) continue;

    const carried = carriedDefects(profileOf.get(animal.id)?.geneticTests ?? []);
    const line = [
      state.kind === "due"
        ? `Calves ${day(state.due)}`
        : state.rebreed
          ? "Open · came back open"
          : "Open",
      ageText(animal, now),
      carried.length === 0 ? undefined : `${carried.join(", ")} carrier`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" · ");

    rows.push({ animal, state, line, plan: planOf.get(animal.id) });
  }

  // Soonest calving first — those are the decisions with a date on them —
  // then the open cows by name.
  return rows.sort((left, right) => {
    if (left.state.kind === "due" && right.state.kind === "due") {
      return left.state.due.getTime() - right.state.due.getTime();
    }
    if (left.state.kind !== right.state.kind) return left.state.kind === "due" ? -1 : 1;
    return displayName(left.animal).localeCompare(displayName(right.animal));
  });
}

/**
 * The one chip a sire row carries.
 *
 * The catalog's rule: a carrier is what is worth seeing before picking him, so
 * it wins; "Clean" only when every house-rule defect is on file as free.
 * Anything short of that says nothing rather than something reassuring.
 */
export function sireFlag(
  tests: readonly GeneticTest[] | undefined,
): { readonly label: string; readonly tone: Tone } | undefined {
  if (tests === undefined) return undefined;
  const carried = carriedDefects(tests);
  if (carried.length > 0) return { label: `${carried.join(", ")} carrier`, tone: "danger" };
  if (HOUSE_RULE_DEFECTS.every((defect) => isKnownFree(statusOf(tests, defect)))) {
    return { label: "Clean", tone: "calm" };
  }
  return undefined;
}

/**
 * The ancestor on file a catalog result already is, when it is one.
 *
 * Matched on any registration either side holds, normalised the way the
 * catalog import matches — so a bull brought across under his Chianina number
 * is still found from his Maine-Anjou page.
 */
export function onFileMatch(
  found: Pick<RegistryAnimal, "regNumber" | "association" | "registrations">,
  outsiders: readonly ExternalAnimal[],
): ExternalAnimal | undefined {
  const keys = new Set(
    allRegistrations(found).map((r) => `${r.association}:${normaliseRegistration(r.regNumber)}`),
  );
  return outsiders.find((outsider) =>
    allRegistrations(outsider).some((r) =>
      keys.has(`${r.association}:${normaliseRegistration(r.regNumber)}`),
    ),
  );
}

/* ------------------------------------------------------------------ polled */

type Horn = "polled" | "horned" | "scurred";

/**
 * A horn status as written, read into what it says about the genes.
 *
 * Ancestor records carry whatever the papers printed — "Polled", "P", "HORNED"
 * — so this reads loosely. Dehorned is checked first because it contains
 * "horn" and means horned: the buds were there to remove.
 */
export function readHorn(value: string | undefined): Horn | undefined {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "") return undefined;
  if (text.startsWith("dehorn") || text.startsWith("horn") || text === "h") return "horned";
  if (text.startsWith("scur") || text === "s") return "scurred";
  if (text.startsWith("poll") || text === "p" || text === "pp") return "polled";
  return undefined;
}

/**
 * Whether the calf will be polled.
 *
 * Polled is dominant, so a horned parent is `p/p` and a polled one is `P/?`
 * — nobody here has the test that settles the second allele. A scurred animal
 * is read as `P/p`: scurs show on polled carriers, not on horned cattle. The
 * answer is a floor wherever a polled parent's second allele is unknown.
 */
export function polledOutlook(sire: string | undefined, dam: string | undefined): string {
  const a = readHorn(sire);
  const b = readHorn(dam);
  if (a === undefined || b === undefined) return "Not known — horn status missing";

  const pair = [a, b].sort().join("+");
  switch (pair) {
    case "horned+horned":
      return "Horned — both parents horned";
    case "horned+polled":
      return "At least half polled";
    case "horned+scurred":
      return "Half polled";
    case "scurred+scurred":
      return "3 in 4 polled";
    default:
      // polled+polled or polled+scurred: both carry P, and either may be P/P.
      return "At least 3 in 4 polled";
  }
}

/* ----------------------------------------------------------------- pairing */

export interface PairingInput {
  readonly sireRef: ParentRef;
  readonly damRef: ParentRef;
  /** Undefined when that side has no record to read tests off at all. */
  readonly sireTests: readonly GeneticTest[] | undefined;
  readonly damTests: readonly GeneticTest[] | undefined;
  readonly sireCoat: CoatInference | undefined;
  readonly damCoat: CoatInference | undefined;
  readonly sireHorn: string | undefined;
  readonly damHorn: string | undefined;
  readonly source: Parameters<typeof relatedness>[2];
}

export interface PairingFact {
  readonly label: string;
  readonly value: string;
  readonly tone: Tone;
}

export interface PairingResult {
  readonly facts: readonly PairingFact[];
  /** Set when the pairing should not happen — shown above the plan button. */
  readonly refusal?: string | undefined;
}

const pct = (value: number, digits = 0): string => `${(value * 100).toFixed(digits)}%`;

/** The five answers, one line each, off the same functions the planner uses. */
export function analysePairing(input: PairingInput): PairingResult {
  // Defects: TH, PHA and DS against the house rule, plus whatever else either
  // side has on file — an affected calf is worth naming whatever the defect.
  let defect: PairingFact;
  let refusal: string | undefined;
  if (input.sireTests === undefined || input.damTests === undefined) {
    defect = { label: "Defect risk", value: "No test results on file", tone: "action" };
  } else {
    const allowed = matingAllowed(input.sireTests, input.damTests);
    const worst = matingDefectRisk(input.sireTests, input.damTests)
      .filter((risk) => risk.affectedChance > 0)
      .sort((left, right) => right.affectedChance - left.affectedChance)[0];
    if (worst !== undefined) {
      defect = {
        label: "Defect risk",
        value: `${pct(worst.affectedChance)} ${worst.defect} affected — avoid`,
        tone: "danger",
      };
      refusal = `This pairing can throw a ${worst.defect}-affected calf.`;
    } else if (!allowed.allowed) {
      // Carrier × free: no affected calves, half carriers — the mating a
      // "manage the carriers" policy allows and this farm does not.
      defect = {
        label: "Defect risk",
        value: `${allowed.carried.join(", ")} carriers, none affected`,
        tone: "danger",
      };
      refusal = `This pairing carries ${allowed.carried.join(" and ")}. No carrier belongs on this place.`;
    } else if (allowed.untested.length > 0) {
      defect = {
        label: "Defect risk",
        value: `Untested for ${allowed.untested.join(", ")}`,
        tone: "action",
      };
    } else {
      defect = { label: "Defect risk", value: "None found", tone: "calm" };
    }
  }

  const kinship = relatedness(input.sireRef, input.damRef, input.source, RELATEDNESS_GENERATIONS);
  const verdict = relatednessVerdict(kinship.inbreedingCoefficient);
  const close =
    verdict.level === "refuse"
      ? " — parent-offspring or full sibs"
      : verdict.level === "caution"
        ? " — half-sibs or closer"
        : verdict.level === "note"
          ? " — around first cousins"
          : "";
  const kin: PairingFact =
    kinship.pedigreeIncomplete && kinship.common.length === 0
      ? { label: "Relatedness", value: "Not enough pedigree to say", tone: "action" }
      : {
          label: "Relatedness",
          value: `${pct(kinship.inbreedingCoefficient, 1)}${close}`,
          tone:
            verdict.level === "refuse" || verdict.level === "caution"
              ? "danger"
              : verdict.level === "note"
                ? "action"
                : "calm",
        };
  if (refusal === undefined && (verdict.level === "refuse" || verdict.level === "caution")) {
    refusal = "These two are close.";
  }

  const colour =
    input.sireCoat === undefined || input.damCoat === undefined
      ? undefined
      : predictCalfColour(input.sireCoat, input.damCoat);
  const coat: PairingFact = {
    label: "Coat colour",
    value:
      colour === undefined || colour.outcomes.length === 0
        ? "Nothing to go on yet"
        : colour.outcomes
            .slice(0, 3)
            .map((outcome) => `${outcome.name} ${pct(outcome.chance)}`)
            .join(" · "),
    tone: "neutral",
  };

  const polled: PairingFact = {
    label: "Polled",
    value: polledOutlook(input.sireHorn, input.damHorn),
    tone: "neutral",
  };

  const names = kinship.common.map((ancestor) =>
    ancestor.regNumber === undefined ? ancestor.name : `${ancestor.name} ${ancestor.regNumber}`,
  );
  const shared: PairingFact = {
    label: "Shared ancestors",
    value:
      names.length === 0
        ? `None in ${RELATEDNESS_GENERATIONS} generations`
        : names.length <= 2
          ? names.join(", ")
          : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`,
    tone: names.length === 0 ? "calm" : "identity",
  };

  return { facts: [defect, kin, coat, polled, shared], refusal };
}
