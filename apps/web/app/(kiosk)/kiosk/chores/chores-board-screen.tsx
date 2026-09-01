"use client";

import Link from "next/link";
import { useMemo } from "react";

import { PageBody, PageHeader } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  type Animal,
  type ChoreTemplate,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import { ChoreBoard } from "@/app/(kiosk)/kiosk/_components/chore-board";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useRecords } from "@/lib/local/use-records";

/**
 * Today's Chores (spec §4.4, §5.1) — the same day sheet the admin app and
 * `/sitter` derive, `choreDaySheet` run against what this device has already
 * pulled.
 *
 * Laid out by `ChoreBoard`, the same compact board the housesitter screen
 * shows: the parts of the day side by side, one row per chore. A card and a
 * full-width button each read well on their own, but a real day is a dozen
 * chores and the feeding rounds, and at that length the button that was easy
 * to hit was three screens below the one somebody was looking for. A 44px row
 * is still honest to a gloved hand, and it puts the whole day in one glance.
 */
export function ChoresBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store } = useSyncEngine();

  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records: tasks, loading } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  // Named on the row the same way the housesitter board names them, so a
  // chore about one calf says which calf rather than only which pen.
  const { records: animals } = useRecords<Animal>("animals", query);
  // Feeding is derived from the plans (§2), here as on every other surface —
  // a barn board missing the feeding rounds would disagree with the admin app.
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);

  const today = useMemo(() => new Date(), []);
  const entries = useMemo(() => {
    const derived = feedingChoresFor(
      plans,
      feedingChoreText({ zones, feeds, propertyId }),
      today,
      today,
    );
    return choreDaySheet({ tasks, templates, derived }, today, today);
  }, [tasks, templates, plans, zones, feeds, propertyId, today]);

  return (
    <PageBody>
      <PageHeader
        eyebrow={<Link href="/kiosk">← Kiosk</Link>}
        title="Today's Chores"
        subtitle="Tick each one off as it happens."
      />

      {loading || store === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <ChoreBoard entries={entries} animals={animals} zones={zones} day={today} />
      )}
    </PageBody>
  );
}
