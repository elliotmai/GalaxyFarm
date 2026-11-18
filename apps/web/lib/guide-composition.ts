import {
  ancestorsOf,
  animalsOf,
  audienceOf,
  displayName,
  emergencyContacts,
  flocksOf,
  isOnFarm,
  isTotal,
  occupantsOf,
  SPECIES_LABELS,
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
import { penAssignments } from "@galaxy-farm/module-pets";

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
  /** "Dolly and Rosie", "12 cattle", "Layers — 14 birds". */
  readonly who: string;
  /** Where they are fed: "West Pen", "the barn aisle". */
  readonly where?: string | undefined;
  /** Whether the amounts are each animal's or the lot's, said in words. */
  readonly portion?: string | undefined;
  readonly lines: readonly string[];
  readonly notes?: string | undefined;
}

/**
 * The livestock rations, as their own section of the guide (§5.10).
 *
 * A plan names its animals and where they are fed, so the guide can say
 * exactly that: who, where, how much, in what. Pets keep their own section,
 * so a pet plan is the one thing filtered out — a cat fed twice because two
 * sections both named her is the error in the other direction.
 *
 * Plans switched off are left out entirely, and so are plans with nobody left
 * on them: a guide is not where somebody should find out an animal has gone,
 * and putting feed out for her is worse.
 */
export function guideFeedingPlans(
  plans: readonly FeedingPlan[],
  feeds: readonly FeedType[],
  animals: readonly Animal[],
  zones: readonly Zone[],
  // Kept for callers: flock headcounts come in through `flocks` below.
  _assignments: readonly ZoneAssignment[],
  _now: Date,
  flocks: readonly { readonly id: Ulid; readonly name: string; readonly heads: number }[] = [],
): GuideFeedingPlan[] {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  const flockById = new Map(flocks.map((flock) => [flock.id, flock]));

  return plans
    .filter((plan) => plan.active && audienceOf(plan.species) === "livestock")
    .map((plan) => {
      const fed = animalsOf(plan)
        .map((animalId) => byId.get(animalId))
        .filter((animal): animal is Animal => animal !== undefined && isOnFarm(animal));
      const birds = flocksOf(plan)
        .map((flockId) => flockById.get(flockId))
        .filter((flock): flock is NonNullable<typeof flock> => flock !== undefined);
      // A caller that has not loaded the flocks still gets the plan: the coop
      // is fed whether or not this page knows how many hens are in it.
      const flockUnknown = flocksOf(plan).length > 0 && birds.length === 0;
      const heads = fed.length + birds.reduce((sum, flock) => sum + flock.heads, 0);
      if (heads === 0 && !flockUnknown) return undefined;

      // Named when there are few enough to read; counted when it is a herd.
      const who = flockUnknown
        ? `The ${SPECIES_LABELS[plan.species].toLowerCase()}`
        : birds.length > 0
          ? nameList(birds.map((flock) => `${flock.name} — ${flock.heads} birds`))
          : fed.length <= 4
            ? nameList(fed.map(displayName))
            : `${fed.length} ${SPECIES_LABELS[plan.species].toLowerCase()}`;

      const zone = zones.find((candidate) => candidate.id === plan.placeZoneId)?.name;
      const label = plan.placeLabel?.trim();
      const where = [zone, label === "" ? undefined : label].filter(Boolean).join(", ");

      /**
       * Said only where it changes what goes in the bunk. One animal needs no
       * gloss; a pen of four does, and both ways round are a real error —
       * four times the hay, or a quarter of it.
       */
      const portion =
        heads <= 1 && !flockUnknown
          ? undefined
          : isTotal(plan)
            ? "The amounts below are for all of them together, not each."
            : "The amounts below are what each one gets.";

      return {
        id: plan.id,
        name: plan.name,
        who,
        ...(where === "" ? {} : { where }),
        portion,
        lines: plan.lines.map((line) => describePlanLine(line, feeds)),
        notes: plan.specialNotes,
      } satisfies GuideFeedingPlan;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort(
      (left, right) =>
        (left.where ?? "").localeCompare(right.where ?? "") || left.who.localeCompare(right.who),
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
