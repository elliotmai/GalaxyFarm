/**
 * The pets module (spec §5.8).
 *
 * No `Pet` entity: a pet is an `Animal` with species `dog` or `cat`, reusing
 * HealthRecord and FeedingPlan, per §2's one-animal-model rule. What lives
 * here is what is particular to a dog or a cat — what care is outstanding, and
 * what a housesitter has to be told before they open the back door.
 */

export * from "./domain/pet.js";
