"use client";

import Link from "next/link";
import { useMemo } from "react";

import { PageBody, PageHeader } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  choreProgress,
  type Animal,
  type ChoreTemplate,
  type Contact,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  currentTrip,
  type CareGuide,
  type GuideSection,
  type Trip,
} from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";

import { ChoreBoard } from "@/app/(kiosk)/kiosk/_components/chore-board";
import { HousesitterGuide } from "@/app/(kiosk)/kiosk/housesitter/housesitter-guide";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { guideForSitter } from "@/lib/care-guide-selection";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useRecords } from "@/lib/local/use-records";

/**
 * Housesitter Mode (spec §4.4, §5.10).
 *
 * The same composed guide the PDF and `/sitter` render, in this surface's own
 * dress — `HousesitterGuide` lays it out as one strip of tabs over a panel that
 * never outgrows the screen, rather than showing the admin's print preview.
 * Unlike `/sitter`, this device already holds every table the guide draws from
 * (a kiosk gets `records.read`, not the narrow `care.read` a housesitter's
 * phone is scoped to), so it is read entirely from the local store rather than
 * a server round trip.
 *
 * The day's chores are checkable right here rather than a link away: a sitter
 * standing at this screen is standing at the one place the whole day is laid
 * out, and sending them to a second board to tick what this one just described
 * is a tap that gets skipped. Feeding is derived from the plans (§2), merged
 * with everything else by part of the day.
 *
 * Travel is read from the `trips` table like everything else here. It was
 * briefly a constant in the source, which was wrong twice over: a barn screen
 * would have shown last September's flights forever, and no owner can edit a
 * deployment. `currentTrip` picks whoever is away now — the sitter is never
 * asked which trip they are sitting for.
 */
export function HousesitterBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, loading } = useHousesitterData(propertyId);

  const guide = guideForSitter(store.guides);
  const now = useMemo(() => new Date(), []);
  const trip = useMemo(() => currentTrip(store.trips, now), [store.trips, now]);
  const today = useMemo(() => {
    // Feeding rides the plans rather than a template written beside them —
    // the same derivation the admin day sheet makes, so the two agree.
    const derived = feedingChoresFor(
      store.plans,
      feedingChoreText({ zones: store.zones, feeds: store.feeds, propertyId }),
      now,
      now,
    );
    return choreDaySheet({ tasks: store.tasks, templates: store.templates, derived }, now, now);
  }, [store.tasks, store.templates, store.plans, store.zones, store.feeds, propertyId, now]);

  const progress = choreProgress(today);

  return (
    <PageBody>
      <PageHeader
        eyebrow={<Link href="/kiosk">← Kiosk</Link>}
        title="Housesitter Mode"
        subtitle="Everything a helper needs, read live from the farm's own records."
      />

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <HousesitterGuide
          guide={guide}
          sections={store.sections}
          zones={store.zones}
          assignments={store.assignments}
          animals={store.animals}
          contacts={store.contacts}
          templates={store.templates}
          plans={store.plans}
          feeds={store.feeds}
          health={store.health}
          trip={trip}
          choresLeft={progress.total - progress.done}
          today={
            <ChoreBoard entries={today} animals={store.animals} zones={store.zones} day={now} />
          }
          now={now}
        />
      )}
    </PageBody>
  );
}

function useHousesitterData(propertyId: Ulid) {
  const { store: local } = useSyncEngine();
  const query = useMemo(() => ({ propertyId }), [propertyId]);

  const guides = useRecords<CareGuide>("careGuides", query);
  const sections = useRecords<GuideSection>("guideSections", query);
  const zones = useRecords<Zone>("zones", query);
  const assignments = useRecords<ZoneAssignment>("zoneAssignments", query);
  const animals = useRecords<Animal>("animals", query);
  const contacts = useRecords<Contact>("contacts", query);
  const templates = useRecords<ChoreTemplate>("choreTemplates", query);
  const tasks = useRecords<Task>("tasks", query);
  const plans = useRecords<FeedingPlan>("feedingPlans", query);
  const feeds = useRecords<FeedType>("feedTypes", query);
  const health = useRecords<HealthRecord>("healthRecords", query);
  const trips = useRecords<Trip>("trips", query);

  return {
    loading:
      local === undefined ||
      [
        guides,
        sections,
        zones,
        assignments,
        animals,
        contacts,
        templates,
        tasks,
        plans,
        feeds,
        health,
        trips,
      ].some((r) => r.loading),
    store: {
      guides: guides.records,
      sections: sections.records,
      zones: zones.records,
      assignments: assignments.records,
      animals: animals.records,
      contacts: contacts.records,
      templates: templates.records,
      tasks: tasks.records,
      plans: plans.records,
      feeds: feeds.records,
      health: health.records,
      trips: trips.records,
    },
  };
}
