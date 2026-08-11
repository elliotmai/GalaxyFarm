import { addDays, type FeedingPlan, type FeedingPlanLine, type Ulid } from "@galaxy-farm/core";

import type { FeedType } from "./feed-type.js";

/**
 * The creep plan a newborn calf earns (spec §5.2, §5.3).
 *
 * This is the feed half of the calving flow, and it is deliberately written
 * without the word "cattle" appearing anywhere: §4.1 forbids feed importing
 * cattle, so what arrives here is a birth date and an animal id off a domain
 * event. That constraint is doing real work — the same function serves a lamb
 * or a foal, because none of the arithmetic below cares what species it is.
 *
 * Nothing here writes. It returns a *suggestion*, which the screen offers and
 * a person accepts or ignores. A calving that silently created a feeding plan
 * would be an inventory drawdown nobody asked for, and §5.3's run-out
 * projection would start counting feed against a calf that is not eating yet.
 */

/**
 * Calves start at creep around two months.
 *
 * Earlier than that a calf is on milk and will not eat enough for the feed to
 * be anything but wasted; much later and the point of creep — weight on before
 * weaning — is half gone. Sixty days is the common commercial start and is the
 * number to change if this farm settles on a different one.
 */
export const CREEP_START_DAYS = 60;

export interface CreepPlanSuggestion {
  readonly animalId: Ulid;
  /** Not before this date. The screen offers it; nobody is nagged sooner. */
  readonly startOn: Date;
  readonly plan: Omit<FeedingPlan, "id" | "createdAt" | "updatedAt" | "propertyId">;
  /** Why this is being offered, shown verbatim. */
  readonly rationale: string;
}

/**
 * Build the offer, or decline to.
 *
 * Returns undefined when there is nothing sensible to suggest — no live calf,
 * or no creep feed in the catalogue. An empty plan offered anyway would train
 * people to dismiss the prompt, and then the one that mattered gets dismissed
 * too.
 */
export function creepPlanSuggestion(
  birth: { readonly animalId?: Ulid; readonly bornOn: Date; readonly liveCalf: boolean },
  creepFeeds: readonly FeedType[],
  options: { readonly startDays?: number } = {},
): CreepPlanSuggestion | undefined {
  if (!birth.liveCalf || birth.animalId === undefined) return undefined;

  const feed = creepFeeds.find((type) => type.category === "creep" && type.active);
  if (feed === undefined) return undefined;

  const startOn = addDays(birth.bornOn, options.startDays ?? CREEP_START_DAYS);

  // Free choice: creep is offered ad lib rather than measured out, so the line
  // records what is put in front of the calf per day. The number is a starting
  // point somebody will edit — what matters is that the plan exists and the
  // §5.3 projection can see it.
  const line: FeedingPlanLine = {
    feedTypeId: feed.id,
    amount: { amount: 5, unit: "lb" },
    frequency: "once_daily",
    timeOfDay: "morning",
    notes: "Free choice — adjust once you see what is actually going.",
  };

  return {
    animalId: birth.animalId,
    startOn,
    plan: {
      name: `${feed.name} — creep`,
      target: "animal",
      targetId: birth.animalId,
      lines: [line],
      // Off until the start date arrives, so §5.3 does not count feed against
      // a calf that is still entirely on its dam.
      active: false,
      specialNotes: `Creep from ${startOn.toISOString().slice(0, 10)}, about ${
        options.startDays ?? CREEP_START_DAYS
      } days old.`,
    },
    rationale: `A calf born ${birth.bornOn.toISOString().slice(0, 10)} is ready for creep around ${startOn.toISOString().slice(0, 10)}.`,
  };
}
