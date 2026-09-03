import {
  ancestorsOf,
  animalsFedBy,
  displayName,
  emergencyContacts,
  isOnFarm,
  isShared,
  occupantsOf,
  primaryPhone,
  type Animal,
  type ChoreTemplate,
  type Contact,
  type FeedingPlan,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type { GuideZone } from "@galaxy-farm/module-housesitting";
import type { FeedType } from "@galaxy-farm/module-feed";
import { isPet, penAssignments } from "@galaxy-farm/module-pets";

import { describeRecurrence, GENERATING_RECURRENCES } from "@/lib/chores";
import { describePlanLine, nameList } from "@/lib/feed-lines";

/**
 * Turning the farm's live records into what the guide composes from (§5.10).
 *
 * `composeGuide` takes zones with their occupants and knows nothing about how
 * an occupant is worked out — deliberately, since that is a join across three
 * entities and one of them (the assignment) is only meaningful in relation to
 * a date. That join is here, in the composition root, along with the sections
 * the module does not compose: chores, emergency numbers, and the vet.
 *
 * Everything is recomputed on read. §5.10 is explicit: "Update a feeding plan
 * anywhere and every format is already current." A guide generated once and
 * saved would be wrong the first time an animal moved pens, which is the week
 * it is most likely to be read.
 */

/**
 * Zones as the guide wants them, worst first once composed.
 *
 * Only zones somebody could be sent to: a zone that is switched off or empty
 * with nothing written on it is a heading with nothing under it, and a guide
 * padded with those is one people stop reading to the bottom of.
 */
export function guideZonesFrom(
  zones: readonly Zone[],
  assignments: readonly ZoneAssignment[],
  animals: readonly Animal[],
  now: Date,
): GuideZone[] {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  // The pets have their own section (§5.8). A dog listed under a pasture as
  // well is the same double-naming the ration filter below exists to stop.
  const placements = penAssignments(assignments, animals);

  return zones
    .filter((zone) => zone.active)
    .map((zone) => {
      const occupants = occupantsOf(placements, zone.id, now)
        .map((animalId) => byId.get(animalId))
        .filter((animal): animal is Animal => animal !== undefined && isOnFarm(animal))
        .map((animal) => ({
          id: animal.id,
          name: displayName(animal),
          safetyLevel: animal.safetyLevel,
          safetyNotes: animal.safetyNotes,
          customInstructions: animal.customInstructions,
        }));

      return {
        id: zone.id,
        name: zone.name,
        baselineSafetyLevel: zone.baselineSafetyLevel,
        customInstructions: zone.customInstructions,
        occupants,
        // The same three levels the Pen Board merges when somebody taps a cow
        // (§5.1). Read here by whoever is standing in the pen with nobody to
        // ask, which is the reader the merge was written for.
        groups: ancestorsOf(zones, zone.id),
      };
    })
    .filter((zone) => zone.occupants.length > 0 || zone.customInstructions !== undefined);
}

export interface GuideFeedingPlan {
  readonly id: Ulid;
  readonly name: string;
  /** "The whole herd", "West Pen — 4 head", "Dolly and Rosie". */
  readonly who: string;
  /** Whether the amounts are each animal's or the lot's, said in words. */
  readonly portion?: string | undefined;
  readonly lines: readonly string[];
  readonly notes?: string | undefined;
}

/**
 * The rations, as their own section of the guide (§5.10's `cattle_feeding`).
 *
 * Separate from the pens because a plan and a pen are not the same shape: a
 * group plan feeds the whole place, a zone plan feeds a pen, and an animal
 * plan follows one cow between pens. Printed under whichever pen she is
 * standing in this week, that last one moves every time she is shifted — and
 * the group plan would print on every pen or on none.
 *
 * Everything not aimed at a dog or a cat lands here. Sorting by species would
 * read better on a farm that only runs cattle and would silently drop a
 * horse's grain on one that does not, and a ration nobody puts out is the
 * failure this section exists to prevent. The pets keep their own section, so
 * their bowls are the one thing filtered out: a cat fed twice because two
 * sections both named her is the same error in the other direction.
 *
 * Plans switched off are left out entirely. Out of season is not "feed this",
 * and a helper reading a retired ration has no way to know it is retired.
 */
export function guideFeedingPlans(
  plans: readonly FeedingPlan[],
  feeds: readonly FeedType[],
  animals: readonly Animal[],
  zones: readonly Zone[],
  assignments: readonly ZoneAssignment[],
  now: Date,
): GuideFeedingPlan[] {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  const fedBy = (plan: FeedingPlan): Animal[] =>
    animalsFedBy(plan)
      .map((animalId) => byId.get(animalId))
      .filter((animal): animal is Animal => animal !== undefined && isOnFarm(animal));

  // Not the dog. He has no pen (§5.8), so counting him against one turns
  // "West Pen — 3 head" into a line somebody puts out four cows' worth of hay
  // for. His own bowl is an animal plan, and the pets' own section has it.
  const placements = penAssignments(assignments, animals);

  const rank: Record<FeedingPlan["target"], number> = { group: 0, zone: 1, animal: 2 };

  return (
    plans
      .filter((plan) => plan.active)
      .filter((plan) => {
        if (plan.target !== "animal") return true;
        const fed = fedBy(plan);
        // Sold, dead or unknown: a guide is not where somebody should find out
        // an animal has gone, and putting feed out for her is worse still.
        if (fed.length === 0) return false;
        return !fed.every(isPet);
      })
      .map((plan) => {
        const fed = plan.target === "animal" ? fedBy(plan) : [];
        const heads =
          plan.target === "zone"
            ? occupantsOf(placements, plan.targetId, now).filter((animalId) => {
                const animal = byId.get(animalId);
                return animal !== undefined && isOnFarm(animal);
              }).length
            : fed.length;

        const who =
          plan.target === "group"
            ? "The whole herd"
            : plan.target === "zone"
              ? `${zones.find((zone) => zone.id === plan.targetId)?.name ?? "A pen"} — ${
                  heads === 0 ? "empty at the moment" : `${heads} head`
                }`
              : nameList(fed.map(displayName));

        /**
         * Said only where it changes what goes in the bunk. One animal on a
         * per-head plan needs no gloss; a pen of four does, and both ways round
         * are a real error — four times the hay, or a quarter of it.
         */
        const portion = isShared(plan)
          ? "The amounts below are for all of them between them, not each."
          : plan.target === "group" || heads > 1
            ? "The amounts below are what each one gets."
            : undefined;

        return {
          target: plan.target,
          composed: {
            id: plan.id,
            name: plan.name,
            who,
            portion,
            // Not passed the animals sharing it: `who` has already named them,
            // and repeating them on every line is a sentence nobody finishes.
            lines: plan.lines.map((line) => describePlanLine(line, feeds)),
            notes: plan.specialNotes,
          },
        };
      })
      // Widest first: the load that goes out to everything, then the pens, then
      // the one cow on her own ration — which is the order somebody walks it.
      .sort(
        (left, right) =>
          rank[left.target] - rank[right.target] ||
          left.composed.who.localeCompare(right.composed.who),
      )
      .map((entry) => entry.composed)
  );
}

export interface GuideChore {
  readonly id: Ulid;
  readonly title: string;
  readonly detail?: string | undefined;
  /** "Every day", "Every Monday, Thursday" — the rule in a sentence. */
  readonly when: string;
  readonly zoneName?: string | undefined;
}

/**
 * The routine, as a rule rather than as a day's tick-list.
 *
 * §5.10 asks for "today's/weekly chores", and a guide is read across a week —
 * so what belongs on it is the standing rule, not one morning's instances. The
 * `/sitter` view is where a day gets ticked off.
 *
 * One-off and seasonal templates are left out because `occursOn` never fires
 * them: printing a chore the app itself will never raise would send somebody
 * out to do something on a day nobody expected it.
 */
export function guideChores(
  templates: readonly ChoreTemplate[],
  zones: readonly Zone[],
): GuideChore[] {
  const zoneName = (id: Ulid | undefined) =>
    id === undefined ? undefined : zones.find((zone) => zone.id === id)?.name;

  return templates
    .filter((template) => template.active)
    .filter((template) => GENERATING_RECURRENCES.includes(template.recurrence))
    .map((template) => ({
      id: template.id,
      title: template.title,
      detail: template.detail,
      when: describeRecurrence(template),
      zoneName: zoneName(template.zoneId),
    }))
    .sort(
      (left, right) => left.when.localeCompare(right.when) || left.title.localeCompare(right.title),
    );
}

export interface GuideContact {
  readonly id: Ulid;
  readonly name: string;
  readonly company?: string | undefined;
  readonly phone?: string | undefined;
  readonly note?: string | undefined;
}

const asGuideContact = (contact: Contact): GuideContact => ({
  id: contact.id,
  name: contact.name,
  company: contact.company,
  phone: primaryPhone(contact),
  note: contact.notes,
});

/**
 * Who to ring, in the order somebody in trouble would want them.
 *
 * The emergency-tagged subset auto-populates the guide (§5.1) — nobody retypes
 * the vet's number into a document that then goes stale. Anyone tagged without
 * a number is still listed: "we have their name and not their number" is
 * information, and silently dropping them makes the omission invisible.
 */
export function guideEmergencyContacts(contacts: readonly Contact[]): GuideContact[] {
  return emergencyContacts(contacts)
    .map(asGuideContact)
    .sort((left, right) => Number(left.phone === undefined) - Number(right.phone === undefined));
}

export function guideVets(contacts: readonly Contact[]): GuideContact[] {
  return contacts.filter((contact) => contact.tags.includes("vet")).map(asGuideContact);
}

/**
 * Is there anything at all behind a section a guide says it includes?
 *
 * Used to warn while the guide is being built rather than after it is printed.
 * An empty section is a heading a helper reads, finds nothing under, and then
 * distrusts the rest of the page for.
 */
export function isSectionEmpty(counts: Readonly<Record<string, number>>, kind: string): boolean {
  return (counts[kind] ?? 0) === 0;
}
