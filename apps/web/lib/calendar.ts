import {
  choreCalendarEntries,
  openAssignments,
  type Animal,
  type CalendarEntry,
  type CalendarModule,
  type ChoreTemplate,
  type FeedingPlan,
  type PurchaseCandidate,
  type Task,
  type Ulid,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  cattleCalendarEntries,
  type BreedingRecord,
  type HealthRecord,
  type MedInventory,
  type SyncProtocol,
} from "@galaxy-farm/module-cattle";
import {
  equipmentCalendarEntries,
  type Equipment,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "@galaxy-farm/module-equipment";
import {
  feedCalendarEntries,
  herdDemand,
  type FeedConsumption,
  type FeedPurchase,
  type FeedType,
} from "@galaxy-farm/module-feed";

/**
 * The projected half of the unified calendar, assembled (spec §6, §4.1).
 *
 * Every row below is computed by the module that owns the records behind it —
 * cattle projects its own windows, feed its own run-outs, the kernel its own
 * chores. This file is the composition root doing what §4.1 says only
 * `apps/web` may do: importing all of them at once and handing the results to
 * `projectEvents`, which merges, windows and filters them without knowing what
 * any of them are.
 *
 * Nothing here is stored. §4.5 puts the projected half on the derived
 * read-model exception list, so there is no CRUD to write and no row to keep
 * in step — correcting the breeding record moves its calving window the next
 * time this runs, which on a live query is immediately.
 *
 * **Two modules are missing on purpose.** Garden and business project their
 * own rows too — `gardenCalendarEntries` and `businessCalendarEntries`, both
 * tested — but the season plans and program enrollments they read are not yet
 * among the entities a device holds (`LOCAL_STORES`), and they arrive with
 * §5.5's and §5.7's own phases. They light up here the day their stores do,
 * which is one import each.
 */

export interface CalendarSources {
  readonly propertyId: Ulid;
  readonly animals: readonly Animal[];
  readonly breedings: readonly BreedingRecord[];
  readonly protocols: readonly SyncProtocol[];
  readonly health: readonly HealthRecord[];
  readonly meds: readonly MedInventory[];
  readonly candidates: readonly PurchaseCandidate[];
  readonly feeds: readonly FeedType[];
  readonly purchases: readonly FeedPurchase[];
  readonly consumption: readonly FeedConsumption[];
  readonly plans: readonly FeedingPlan[];
  readonly assignments: readonly ZoneAssignment[];
  readonly equipment: readonly Equipment[];
  readonly maintenanceRules: readonly MaintenanceRule[];
  readonly maintenanceLogs: readonly MaintenanceLog[];
  readonly meterReadings: readonly MeterReading[];
  readonly tasks: readonly Task[];
  readonly choreTemplates: readonly ChoreTemplate[];
}

export interface CalendarHorizon {
  /** Local midnight of the first day the caller is showing. */
  readonly from: Date;
  /** How many days it is showing, which is what the chore rows are walked over. */
  readonly days: number;
  readonly now: Date;
}

/**
 * Every projected row the device can produce, unordered and unwindowed.
 *
 * Windowing is left to `projectEvents` rather than done per module, so "does
 * this fall in March" is answered one way for a calving window and a chore
 * alike.
 */
export function projectedCalendarEntries(
  sources: CalendarSources,
  horizon: CalendarHorizon,
): CalendarEntry[] {
  return [
    ...cattleCalendarEntries({
      animals: sources.animals,
      breedings: sources.breedings,
      protocols: sources.protocols,
      health: sources.health,
      meds: sources.meds,
      candidates: sources.candidates,
    }),
    ...feedCalendarEntries(
      {
        feedTypes: sources.feeds,
        purchases: sources.purchases,
        consumption: sources.consumption,
        demandByFeedType: dailyDemand(sources),
      },
      horizon.now,
    ),
    ...equipmentCalendarEntries({
      equipment: sources.equipment,
      rules: sources.maintenanceRules,
      logs: sources.maintenanceLogs,
      readings: sources.meterReadings,
    }),
    ...choreCalendarEntries(
      { tasks: sources.tasks, templates: sources.choreTemplates },
      horizon.from,
      horizon.days,
      horizon.now,
    ),
  ];
}

/**
 * What the herd eats in a day, per feed type.
 *
 * The same resolution the feed screen does, and for the same reason it lives
 * in `herdDemand` rather than in either screen: the run-out date on the
 * calendar and the run-out date on `/admin/feed` have to be the same date, and
 * two sums over feeding plans would eventually disagree.
 */
function dailyDemand(sources: CalendarSources): ReadonlyMap<Ulid, number> {
  const scopes = sources.animals
    .filter((animal) => animal.status === "active")
    .map((animal) => ({
      id: animal.id,
      zoneIds: openAssignments(sources.assignments, animal.id).map((entry) => entry.zoneId),
    }));

  return herdDemand({
    plans: sources.plans.filter((plan) => plan.active),
    feeds: sources.feeds,
    animals: scopes,
    propertyId: sources.propertyId,
  }).perDay;
}

/**
 * The modules that actually have something to show, in §6's own order.
 *
 * Offering the full list would put a "poultry" chip on a farm whose poultry
 * module projects nothing yet — a filter that can only ever empty the screen,
 * which reads as the calendar being broken rather than the module being
 * unbuilt.
 */
export function modulesPresent(entries: readonly CalendarEntry[]): CalendarModule[] {
  const present = new Set(entries.map((entry) => entry.module));
  return [...present].sort();
}
