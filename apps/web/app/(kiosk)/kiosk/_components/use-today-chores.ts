"use client";

import { useMemo } from "react";

import {
  choreDaySheet,
  type Animal,
  type ChoreEntry,
  type ChoreTemplate,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useRecords } from "@/lib/local/use-records";

/**
 * Today's chores as this device's own store sees them.
 *
 * One derivation for the chores board and the home screen's count, so the
 * number on the tile is the number on the board behind it.
 */
export function useTodayChores(propertyId: Ulid): {
  readonly entries: readonly ChoreEntry[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly today: Date;
  readonly loading: boolean;
} {
  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records: tasks, loading } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  // Feeding is derived from the plans (§2), here as on every other surface.
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

  return { entries, animals, zones, today, loading };
}
