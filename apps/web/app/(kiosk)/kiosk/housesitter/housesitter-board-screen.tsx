"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Button, Card, PageBody, PageHeader } from "@galaxy-farm/ui";
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
import type { CareGuide, GuideSection } from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";

import { GuidePreview } from "@/app/(admin)/admin/housesitter/_components/guide-preview";
import { useSync } from "@/app/_components/sync-provider";
import { guideForSitter } from "@/lib/care-guide-selection";
import { useRecords } from "@/lib/local/use-records";

/**
 * Housesitter Mode (spec §4.4, §5.10).
 *
 * The same composed guide the PDF and `/sitter` render — `GuidePreview`'s own
 * doc comment names this board as its third output. Unlike `/sitter`, this
 * device already holds every table the guide draws from (a kiosk gets
 * `records.read`, not the narrow `care.read` a housesitter's phone is scoped
 * to), so it is read entirely from the local store rather than a server round
 * trip. Ticking chores off is a separate board (§4.4 lists them apart) — this
 * links to it rather than duplicating its interactive list.
 */
export function HousesitterBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, loading } = useHousesitterData(propertyId);

  const guide = guideForSitter(store.guides);
  const now = useMemo(() => new Date(), []);
  const today = useMemo(
    () => choreDaySheet({ tasks: store.tasks, templates: store.templates }, now, now),
    [store.tasks, store.templates, now],
  );
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
        <div className="flex flex-col gap-density">
          <Card className="flex flex-row flex-wrap items-center justify-between gap-density">
            <span className="text-density text-ink">
              Today's chores: {progress.done} of {progress.total} done
              {progress.overdue > 0 ? `, ${progress.overdue} overdue` : ""}
            </span>
            <Link href="/kiosk/chores">
              <Button variant="primary">Open Today's Chores</Button>
            </Link>
          </Card>

          <GuidePreview
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
          />
        </div>
      )}
    </PageBody>
  );
}

function useHousesitterData(propertyId: Ulid) {
  const { store: local } = useSync();
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
    },
  };
}
