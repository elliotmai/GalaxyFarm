"use client";

import { useMemo } from "react";

import { PageBody } from "@galaxy-farm/ui";
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
import { KioskHeader, KioskQuiet, kioskDate } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useRecords } from "@/lib/local/use-records";
import { useWeatherChores } from "@/lib/use-weather-chores";
import type { PeopleNames } from "@/lib/people-names";

/**
 * Today's Chores (spec §4.4, §5.1) — the same day sheet the admin app and
 * `/sitter` derive, `choreDaySheet` run against what this device has already
 * pulled.
 *
 * Laid out by `ChoreBoard`, the same board the housesitter screen shows: the
 * parts of the day side by side, one big tick row per chore, and one green
 * panel once nothing is left. The header is the title and the date and
 * nothing else — the count lives on the board, beside the list it counts.
 */
export function ChoresBoardScreen({
  propertyId,
  names,
}: {
  readonly propertyId: Ulid;
  /** Who ticked what, resolved on the server; never rejects. */
  readonly names?: Promise<PeopleNames> | undefined;
}) {
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
  // The weather's chores, read the way Today reads them, so the board in the
  // barn asks for the covers on the same evenings the phone does.
  const weather = useWeatherChores(propertyId, today, today);
  const entries = useMemo(() => {
    const derived = feedingChoresFor(
      plans,
      feedingChoreText({ zones, feeds, propertyId }),
      today,
      today,
    );
    return choreDaySheet(
      { tasks, templates, derived: [...derived, ...weather.derived], weather: weather.weather },
      today,
      today,
    );
  }, [tasks, templates, plans, zones, feeds, propertyId, today, weather.derived, weather.weather]);

  return (
    <PageBody>
      <KioskHeader title="Today's Chores" fact={kioskDate(today)} />

      {loading || store === undefined ? (
        <KioskQuiet>Loading…</KioskQuiet>
      ) : (
        <ChoreBoard entries={entries} animals={animals} zones={zones} day={today} names={names} />
      )}
    </PageBody>
  );
}
