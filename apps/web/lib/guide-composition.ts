import {
  displayName,
  emergencyContacts,
  isOnFarm,
  occupantsOf,
  primaryPhone,
  type Animal,
  type ChoreTemplate,
  type Contact,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type { GuideZone } from "@galaxy-farm/module-housesitting";

import { describeRecurrence, GENERATING_RECURRENCES } from "@/lib/chores";

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

  return zones
    .filter((zone) => zone.active)
    .map((zone) => {
      const occupants = occupantsOf(assignments, zone.id, now)
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
      };
    })
    .filter((zone) => zone.occupants.length > 0 || zone.customInstructions !== undefined);
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
