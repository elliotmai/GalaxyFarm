import {
  addDays,
  displayName,
  isOnFarm,
  safetyLabel,
  type Animal,
  type SafetyLabelOverrides,
  type SafetyLevel,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Pets (spec §5.8).
 *
 * "**Pet** — Animal subtype (species `dog | cat`), reusing HealthRecord
 * (vaccines, meds), FeedingPlan, vet visits (Contact), photos, and free-form
 * notes. Pets appear in the housesitter guide automatically."
 *
 * So there is no `Pet` entity, and adding one would break §2's one-animal-model
 * rule for no gain. What this module holds is the two things that are actually
 * particular to a dog or a cat:
 *
 * - **What is outstanding.** A pet's care is a short list of dated things — a
 *   rabies booster, the next flea treatment — and the date comes from whoever
 *   gave the last one, not from a vaccination schedule this app invents. We do
 *   not know what protocol a vet keeps, and an app that says "due" on its own
 *   authority is worse than one that says nothing.
 * - **What a helper has to be told.** §5.8's last sentence is the reason this
 *   module exists at all. A briefing is the pet's name, whether it bites, what
 *   it eats, and what medicine it is on — in that order, because that is the
 *   order somebody standing in a kitchen at 7am needs them.
 *
 * Records arrive as the narrow shapes below rather than as entities from other
 * modules: §4.1 has modules talk through ids, and a health record lives in
 * `module-cattle` where a dog's rabies shot has no business importing from.
 */

export const PET_SPECIES = ["dog", "cat"] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export function isPet(animal: Pick<Animal, "species">): boolean {
  return (PET_SPECIES as readonly string[]).includes(animal.species);
}

/** The dogs and cats living here now — not the ones that have gone. */
export function petsOnFarm(animals: readonly Animal[]): Animal[] {
  return animals
    .filter((animal) => isPet(animal) && isOnFarm(animal))
    .sort((left, right) => displayName(left).localeCompare(displayName(right)));
}

/**
 * The placements that belong to something that actually lives in a pen (§5.8).
 *
 * A pen is a fact about grazing, handling and who has to be let through a
 * gate. A dog lives in the house and follows whoever is holding the lead, so
 * "which pasture is the dog in" has no answer worth storing — which is why
 * §5.8 gives pets their own section of the housesitter guide rather than a
 * line under a pen, and why nothing on this app asks where a cat is kept.
 *
 * It filters **assignments, not animals**, because the join is where the
 * damage is done. Drop the rows once, at the point where a placement becomes
 * an occupant, and the pet is gone from the pen board, the map, the guide and
 * from the safety level a pen derives from who is standing in it — no
 * migration, and no screen left restating the rule and getting it half right.
 *
 * That matters for placements already written. The property map's chips are
 * draggable, and a dog drawn beside the herd is one slip away from the North
 * Trap; a row created by that slip stops counting the moment this is applied,
 * without anything being deleted out from under the history.
 */
export function penAssignments<T extends { readonly animalId: Ulid }>(
  assignments: readonly T[],
  animals: readonly Pick<Animal, "id" | "species">[],
): T[] {
  const pets = new Set(animals.filter(isPet).map((animal) => animal.id));
  return assignments.filter((assignment) => !pets.has(assignment.animalId));
}

/**
 * A dated thing somebody said would come round again.
 *
 * `givenOn` is not a completion flag on this record — it is the date of a
 * *later* record of the same thing. Asking somebody to log the booster and
 * then tick the first record as done guarantees the two disagree.
 */
export interface PetCareRecord {
  readonly id: Ulid;
  readonly animalId: Ulid;
  readonly label: string;
  readonly performedOn: Date;
  readonly nextDueOn?: Date | undefined;
}

export type PetCareStatus = "overdue" | "due" | "upcoming";

export interface PetCareNeed {
  readonly animalId: Ulid;
  readonly recordId: Ulid;
  readonly label: string;
  readonly dueOn: Date;
  readonly status: PetCareStatus;
  /** Whole days: negative once it has passed. */
  readonly daysUntil: number;
}

/** Two weeks. Long enough to book a vet, short enough not to be background noise. */
export const PET_CARE_LEAD_DAYS = 14;

/**
 * What is outstanding for these pets, soonest first.
 *
 * A need is satisfied by a later record carrying the same label for the same
 * animal — giving the booster is itself a record, so nothing has to be ticked
 * off. Anything already covered that way drops out entirely rather than
 * appearing as "done", because a list of completed care is a history, and the
 * history is the records themselves.
 */
export function outstandingPetCare(
  records: readonly PetCareRecord[],
  now: Date,
  leadDays: number = PET_CARE_LEAD_DAYS,
): PetCareNeed[] {
  const horizon = addDays(now, leadDays);
  const needs: PetCareNeed[] = [];

  for (const record of records) {
    const dueOn = record.nextDueOn;
    if (dueOn === undefined || dueOn > horizon) continue;

    const covered = records.some(
      (other) =>
        other.id !== record.id &&
        other.animalId === record.animalId &&
        other.label === record.label &&
        other.performedOn >= dueOn,
    );
    if (covered) continue;

    const daysUntil = Math.ceil((dueOn.getTime() - now.getTime()) / 86_400_000);
    needs.push({
      animalId: record.animalId,
      recordId: record.id,
      label: record.label,
      dueOn,
      status: dueOn < now ? "overdue" : daysUntil <= 0 ? "due" : "upcoming",
      daysUntil,
    });
  }

  return needs.sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime());
}

export interface PetFeedingLine {
  /** "1 scoop of Purina, twice daily, morning" — already worded by the caller. */
  readonly text: string;
}

export interface PetBriefingInput {
  readonly pet: Animal;
  readonly feeding: readonly PetFeedingLine[];
  /** Medicines the pet is on now, in the words somebody would say them. */
  readonly medicines: readonly string[];
  readonly vetName?: string | undefined;
  readonly vetPhone?: string | undefined;
}

export interface PetBriefing {
  readonly animalId: Ulid;
  readonly name: string;
  readonly species: string;
  readonly safetyLevel: SafetyLevel;
  readonly safetyLabel: string;
  readonly safetyNotes?: string | undefined;
  /** Levels 4 and 5: somebody feeding a dog as a favour must not be surprised. */
  readonly handleWithCare: boolean;
  readonly instructions?: string | undefined;
  readonly feeding: readonly string[];
  readonly medicines: readonly string[];
  readonly vet?: string | undefined;
}

/**
 * What the guide says about one pet.
 *
 * The safety label leads, in words rather than a number: "level 4" means
 * nothing to somebody letting a dog out as a favour, and it is the one line
 * on the page that has to land the first time it is read.
 */
export function petBriefing(input: PetBriefingInput, labels?: SafetyLabelOverrides): PetBriefing {
  const { pet } = input;
  const vet =
    input.vetName === undefined
      ? undefined
      : input.vetPhone === undefined
        ? input.vetName
        : `${input.vetName} — ${input.vetPhone}`;

  return {
    animalId: pet.id,
    name: displayName(pet),
    species: pet.species,
    safetyLevel: pet.safetyLevel,
    safetyLabel: safetyLabel(pet.safetyLevel, labels),
    safetyNotes: pet.safetyNotes,
    handleWithCare: pet.safetyLevel >= 4,
    instructions: pet.customInstructions,
    feeding: input.feeding.map((line) => line.text),
    medicines: [...input.medicines],
    vet,
  };
}

/**
 * Every pet's briefing, the ones needing care first.
 *
 * Ordered by handling level rather than alphabetically. A helper who reads
 * only the top of the page has to have read the dog that bites.
 */
export function petBriefings(
  inputs: readonly PetBriefingInput[],
  labels?: SafetyLabelOverrides,
): PetBriefing[] {
  return inputs
    .map((input) => petBriefing(input, labels))
    .sort(
      (left, right) => right.safetyLevel - left.safetyLevel || left.name.localeCompare(right.name),
    );
}
