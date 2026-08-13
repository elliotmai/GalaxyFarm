import {
  diff,
  encodeUlid,
  isOnFarm,
  occursOn,
  systemClock,
  taskFromTemplate,
  type Animal,
  type ChoreTemplate,
  type Contact,
  type FeedingPlan,
  type FieldValue,
  type Task,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { applyPush, repositoryFor, type Database } from "@galaxy-farm/infra-db";
import type { CareGuide, GuideSection, GuideSectionKind } from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { isPet } from "@galaxy-farm/module-pets";

import { database } from "@/lib/credential-store";

/**
 * What a housesitter's browser is allowed to be given (spec §4.3, §5.10).
 *
 * `/sitter` is the one signed-in surface that does **not** read from the
 * device, and the reason is the same one that keeps `users` off devices: a
 * sync pull is scoped to a property, not to a capability, so a housesitter
 * running the sync engine would end up holding the whole farm in IndexedDB —
 * every sale price, every contact, every treatment — on a phone that goes home
 * with them at the end of the week. `care.read` is not `records.read`, and the
 * difference has to be real somewhere.
 *
 * So the reads happen here, on the server, per request, and they are narrow by
 * construction: seven tables out of thirty-five, two of them filtered further.
 * Nothing about sales, breeding, purchases, the medicine fridge or the roadmap
 * is fetched at all.
 *
 * The cost is that this surface needs signal, where the rest of the app does
 * not. That is the trade §5.10 already makes: the offline copy of the guide is
 * the printed one, which is why the PDF is first in its list of three outputs.
 */

export interface SitterView {
  /** The guide in use. More than one may exist; only a live one is served. */
  readonly guide: CareGuide | undefined;
  readonly sections: readonly GuideSection[];
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly assignments: readonly ZoneAssignment[];
  /** Emergency and vet only — the rest of the CRM is none of their business. */
  readonly contacts: readonly Contact[];
  readonly templates: readonly ChoreTemplate[];
  readonly tasks: readonly Task[];
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  /** Pets only. A herd's treatment history is not care information. */
  readonly petHealth: readonly HealthRecord[];
}

export const EMPTY_SITTER_VIEW: SitterView = {
  guide: undefined,
  sections: [],
  zones: [],
  animals: [],
  assignments: [],
  contacts: [],
  templates: [],
  tasks: [],
  plans: [],
  feeds: [],
  petHealth: [],
};

/**
 * Which contacts reach the guide.
 *
 * §5.1 says the emergency-tagged subset auto-populates it, and §5.10 asks for
 * vet info beside it. Everything else in the CRM — what a buyer is like to
 * deal with, what the hauler charges — is not care information and does not
 * travel.
 */
export function visibleToSitter(contact: Pick<Contact, "tags">): boolean {
  return contact.tags.includes("emergency") || contact.tags.includes("vet");
}

/**
 * Which guide a sitter is shown.
 *
 * The oldest live one, so adding a second guide for a longer trip does not
 * silently move the person already reading the first. A retired guide is never
 * served: switching one off is how somebody takes it out of use.
 */
export function guideForSitter(guides: readonly CareGuide[]): CareGuide | undefined {
  return [...guides]
    .filter((guide) => guide.active)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
}

/** Everything the sitter surface renders, in one round trip's worth of reads. */
export async function sitterView(propertyId: Ulid, db: Database = database()): Promise<SitterView> {
  const query = { propertyId };

  const [guides, sections, zones, animals, assignments, contacts, templates, tasks, plans, feeds] =
    await Promise.all([
      repositoryFor<CareGuide>(db, "careGuides").list(query),
      repositoryFor<GuideSection>(db, "guideSections").list(query),
      repositoryFor<Zone>(db, "zones").list(query),
      repositoryFor<Animal>(db, "animals").list(query),
      repositoryFor<ZoneAssignment>(db, "zoneAssignments").list(query),
      repositoryFor<Contact>(db, "contacts").list(query),
      repositoryFor<ChoreTemplate>(db, "choreTemplates").list(query),
      repositoryFor<Task>(db, "tasks").list(query),
      repositoryFor<FeedingPlan>(db, "feedingPlans").list(query),
      repositoryFor<FeedType>(db, "feedTypes").list(query),
    ]);

  const guide = guideForSitter(guides);
  const petIds = new Set(
    animals.filter((animal) => isPet(animal) && isOnFarm(animal)).map((a) => a.id),
  );

  // Read whole and narrowed here rather than left to the component: a filter
  // in the markup is one somebody removes while tidying, and this one is the
  // difference between a care guide and the farm's books.
  const petHealth =
    petIds.size === 0
      ? []
      : (await repositoryFor<HealthRecord>(db, "healthRecords").list(query)).filter((record) =>
          petIds.has(record.animalId),
        );

  return {
    guide,
    sections:
      guide === undefined
        ? []
        : sections
            .filter((section) => section.careGuideId === guide.id)
            .sort((left, right) => left.order - right.order),
    zones,
    animals,
    assignments,
    contacts: contacts.filter(visibleToSitter),
    templates,
    tasks,
    plans,
    feeds,
    petHealth,
  };
}

/**
 * Is this auto-section on the guide the owner published?
 *
 * A guide with no record at all is treated as including nothing, so a sitter
 * arriving before anybody wrote one sees an honest "nothing here yet" rather
 * than a document assembled by default that nobody has read.
 */
export function guideIncludes(guide: CareGuide | undefined, kind: GuideSectionKind): boolean {
  return guide !== undefined && guide.includes.includes(kind);
}

export interface TickInput {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** The stored row, when the chore already has one. */
  readonly taskId?: Ulid | undefined;
  /**
   * The template behind a chore nobody has touched yet.
   *
   * An id rather than the record: this arrives from a browser, and a template
   * handed over by the caller is a title, a zone and an animal the caller
   * chose. The row is read here and checked against the property.
   */
  readonly templateId?: Ulid | undefined;
  /** The day being ticked, which is not always today. */
  readonly date: Date;
  readonly at: Date;
  readonly done: boolean;
}

export type TickOutcome =
  { readonly ok: true; readonly taskId: Ulid } | { readonly ok: false; readonly reason: string };

/**
 * A sitter ticking a chore off (spec §5.10, §4.3 `chores.complete`).
 *
 * The write goes through `applyPush` rather than straight at the repository,
 * which matters more than it looks: the push path is the one place that
 * records per-field write times and an audit entry. A row saved around it
 * would have no field metadata, so the next device to edit that task would win
 * or lose the merge by accident rather than by timestamp — and a chore
 * silently un-ticking itself on the owner's phone is exactly the class of bug
 * §4.2 is built to prevent.
 *
 * Everything an admin device would do afterwards happens by itself: the row is
 * in Postgres, so the next pull carries it to every screen on the farm.
 */
export async function tickChore(input: TickInput, db: Database = database()): Promise<TickOutcome> {
  const { propertyId, actorId, date, at, done } = input;

  const clock = systemClock();
  const ids = { next: () => encodeUlid(at.getTime()) };
  const deviceId = `sitter:${actorId}`;

  /**
   * A projected occurrence has no row yet, and finishing it writes one
   * *already complete* rather than writing an empty one and updating it. One
   * patch instead of two, and no window in which a crash leaves a chore that
   * exists and was never done.
   */
  if (input.taskId === undefined) {
    if (input.templateId === undefined) {
      return { ok: false, reason: "That chore is not on today's list any more." };
    }
    if (!done) {
      // Nothing to un-tick: an occurrence with no row was never finished.
      return { ok: false, reason: "That chore had not been ticked." };
    }

    const template = await repositoryFor<ChoreTemplate>(db, "choreTemplates").findById(
      input.templateId,
    );
    if (template === undefined || template.propertyId !== propertyId) {
      return { ok: false, reason: "That chore is not on this property." };
    }
    // The template has to actually fire on the day being ticked. Without this
    // the day is whatever the request said it was, and a chore could be
    // written onto a date the rule never produced.
    if (!occursOn(template, date)) {
      return { ok: false, reason: "That chore is not on that day's list." };
    }

    const now = at;
    const record: Task = {
      id: encodeUlid(now.getTime()),
      propertyId,
      createdAt: now,
      updatedAt: now,
      ...taskFromTemplate(template, date),
      completedAt: now,
      completedBy: actorId,
    };

    const changes = diff({}, record as unknown as Record<string, FieldValue>, {
      at: now,
      deviceId,
    });

    const result = await applyPush(
      db,
      [
        {
          id: ids.next(),
          operation: "create",
          patch: { entity: "tasks", recordId: record.id, changes },
          queuedAt: now,
          deviceId,
          attempts: 0,
        },
      ],
      { propertyId, clock, ids },
    );

    return result.rejected.length === 0
      ? { ok: true, taskId: record.id }
      : { ok: false, reason: result.rejected[0]?.reason ?? "The farm refused that change." };
  }

  const existing = await repositoryFor<Task>(db, "tasks").findById(input.taskId);
  if (existing === undefined || existing.propertyId !== propertyId) {
    return { ok: false, reason: "That chore is not on this property." };
  }

  // Named explicitly, both ways. A patch carries the fields that changed, and
  // a key that is merely absent is not a change — dropping them would leave
  // the chore reading as done on every other device on the farm.
  const after = done
    ? { ...existing, completedAt: at, completedBy: actorId, updatedAt: at }
    : { ...existing, completedAt: undefined, completedBy: undefined, updatedAt: at };

  const changes = diff(
    existing as unknown as Record<string, FieldValue>,
    after as unknown as Record<string, FieldValue>,
    { at, deviceId },
  );

  if (changes.length === 0) return { ok: true, taskId: input.taskId };

  const result = await applyPush(
    db,
    [
      {
        id: ids.next(),
        operation: "update",
        patch: { entity: "tasks", recordId: input.taskId, changes },
        queuedAt: at,
        deviceId,
        attempts: 0,
      },
    ],
    { propertyId, clock, ids },
  );

  return result.rejected.length === 0
    ? { ok: true, taskId: input.taskId }
    : { ok: false, reason: result.rejected[0]?.reason ?? "The farm refused that change." };
}
