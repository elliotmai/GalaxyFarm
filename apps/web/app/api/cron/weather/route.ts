import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  displayName,
  isWithinLead,
  WATCH_SIGNALS,
  type Animal,
  type Forecast,
  type Property,
  type Ulid,
  type WatchSettings,
} from "@galaxy-farm/core";
import { allTables, type Database } from "@galaxy-farm/infra-db";
import {
  calvingWatch,
  describeWatch,
  type BreedingRecord,
  type CalvingRecord,
  type CalvingWatchCard,
} from "@galaxy-farm/module-cattle";
import type { Crop, PlannedPlanting, Variety } from "@galaxy-farm/module-garden";

import { database } from "@/lib/credential-store";
import {
  frostAlerts,
  gardenDigest,
  plantingWindowAlerts,
  type GardenAlert,
} from "@/lib/garden-watch";
import { notifier } from "@/lib/notifier";
import { listUsers } from "@/lib/user-store";
import { weatherSnapshot } from "@/lib/weather-service";

/**
 * /api/cron/weather — the scheduled poll (spec §6).
 *
 * Runs on a schedule, reads the forecast for each property's coordinates, and
 * projects it — plus the garden's season plan — onto the calendar. Calendar
 * events rather than a push straight to a phone, deliberately: an event syncs
 * to every device (§4.2) and is there when somebody looks, whereas a
 * notification that arrives while a person is moving cattle is a notification
 * they will never see again.
 *
 * The garden also sends mail, because a planting window is the one thing here
 * that is useless found late — a calendar entry read on Sunday about a window
 * that opened on Tuesday is a fortnight of the season already gone.
 *
 * **Idempotent by construction.** The poll runs on a schedule nobody controls
 * to the minute and may run twice; each watch produces an event keyed to the
 * cow and the day, so a second run in the same day updates rather than adds. A
 * calendar with four copies of the same 2am warning is a calendar people stop
 * reading.
 *
 * Authorisation is a shared secret in a header rather than a session: the
 * caller is a scheduler, not a person. With no secret configured the route
 * refuses rather than running open — a cron endpoint that anybody can trigger
 * is a way to spend somebody else's API quota.
 */

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const expected = process.env["CRON_SECRET"];
  if (expected === undefined || expected === "") return false;

  const offered =
    request.headers.get("authorization")?.replace(/^Bearer /i, "") ??
    request.headers.get("x-cron-secret");
  return offered === expected;
}

/**
 * The calendar entry one watch card produces.
 *
 * The id is derived from the breeding record and the date rather than random,
 * which is the whole of the idempotency: the same cow on the same day is the
 * same event, whether this is the first poll of the day or the fourth.
 */
function watchEventId(card: CalvingWatchCard, day: string): string {
  return `watch-${card.breedingRecordId}-${day}`;
}

/** What one property's garden produced this run. */
interface GardenResult {
  readonly written: number;
  readonly emailed: number;
  readonly note?: string;
}

/**
 * The garden's half of the poll (spec §5.5, §6).
 *
 * Two triggers with different dependencies, which is why they are gathered
 * here and not in the calving loop below. A planting window comes out of the
 * season plan and needs no forecast at all — a property whose coordinates have
 * never been entered still has to be told to start its tomatoes — while a
 * frost warning obviously does. So the forecast is optional here, and only the
 * frost half is skipped when there is none.
 *
 * Both reach the calendar, and anything the calendar has not seen before also
 * reaches an inbox. Keying the event on what the alert is *about* is what
 * makes that safe: on the second poll of the day the row already exists, so
 * nothing is new, so no second email goes out.
 *
 * **These rows are what the unified calendar should read** (#31). They are
 * ordinary `CalendarEvent`s written the same way the calving watch writes its
 * own, under keys `windowKey` and `frostKey` mint — not a second projection
 * path built alongside the first. A calendar that re-derived planting windows
 * from `plannedPlantings` itself would draw every window twice, once from each
 * source, and the two would disagree the moment a plan was realised between
 * polls.
 */
async function runGardenWatch(
  db: Database,
  property: Property,
  forecast: Forecast | undefined,
  settings: WatchSettings,
  now: Date,
): Promise<GardenResult> {
  const propertyId = property.id;

  const planned = (await db
    .select()
    .from(allTables.plannedPlantings)
    .where(
      and(
        eq(allTables.plannedPlantings.propertyId, propertyId),
        isNull(allTables.plannedPlantings.deletedAt),
      ),
    )) as unknown as PlannedPlanting[];

  const varieties = (await db
    .select()
    .from(allTables.varieties)
    .where(
      and(eq(allTables.varieties.propertyId, propertyId), isNull(allTables.varieties.deletedAt)),
    )) as unknown as Variety[];

  const crops = (await db
    .select()
    .from(allTables.crops)
    .where(
      and(eq(allTables.crops.propertyId, propertyId), isNull(allTables.crops.deletedAt)),
    )) as unknown as Crop[];

  const alerts: GardenAlert[] = [
    ...plantingWindowAlerts(planned, varieties, crops, now),
    ...(forecast === undefined ? [] : frostAlerts(forecast.daily, property.growingZone, settings)),
  ];

  if (alerts.length === 0) return { written: 0, emailed: 0 };

  // Which of these the calendar has already seen. Asked before the upsert,
  // because after it the answer is always "all of them".
  const existing = await db
    .select({ id: allTables.calendarEvents.id })
    .from(allTables.calendarEvents)
    .where(
      inArray(
        allTables.calendarEvents.id,
        alerts.map((alert) => alert.key),
      ),
    );
  const seen = new Set(existing.map((row) => row.id));

  for (const alert of alerts) {
    const row = {
      id: alert.key,
      propertyId,
      createdAt: now,
      updatedAt: now,
      title: alert.title,
      detail: alert.detail,
      at: alert.at,
      allDay: true,
    };

    await db
      .insert(allTables.calendarEvents)
      .values(row as never)
      .onConflictDoUpdate({
        target: allTables.calendarEvents.id,
        set: { title: row.title, detail: row.detail, at: row.at, updatedAt: now },
      });
  }

  const digest = gardenDigest(alerts.filter((alert) => !seen.has(alert.key)));
  if (digest === undefined) return { written: alerts.length, emailed: 0 };

  const send = notifier();
  if (send === undefined) {
    // §6 treats an unreachable third party as something to report and skip.
    // The calendar entries are written either way, which is the half that
    // syncs to every device.
    return { written: alerts.length, emailed: 0, note: "Email is not configured" };
  }

  // Owners and members. A housesitter is not being emailed about next
  // February's tomatoes, and a customer never sees the garden at all (§4.3).
  const recipients = (await listUsers(propertyId, now, db))
    .filter((managed) => managed.state === "active")
    .filter((managed) => managed.user.role === "owner" || managed.user.role === "member")
    .map((managed) => managed.user.email);

  let emailed = 0;
  for (const to of recipients) {
    try {
      await send.send({ to, subject: digest.subject, body: digest.body });
      emailed += 1;
    } catch (error) {
      // One bad address must not cost the others their mail, and it must not
      // take the calving watch down with it either.
      console.error("Garden digest failed", to, error);
    }
  }

  return { written: alerts.length, emailed };
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const db = database();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);

  const properties = await db
    .select()
    .from(allTables.properties)
    .where(isNull(allTables.properties.deletedAt));

  const summary: {
    propertyId: string;
    watched: number;
    written: number;
    garden: GardenResult;
    note?: string;
  }[] = [];

  for (const property of properties) {
    const propertyId = property.id as Ulid;
    const snapshot = await weatherSnapshot(propertyId);
    const settings = snapshot.settings;

    // Before the forecast check, deliberately: the season plan's windows are a
    // calendar fact, not a weather one, and a property without coordinates
    // still has tomatoes to start.
    const garden = await runGardenWatch(
      db,
      property as unknown as Property,
      snapshot.forecast,
      settings,
      now,
    );

    if (snapshot.forecast === undefined) {
      // §6's last acceptance criterion, on the server side: an unreachable
      // forecast is reported and skipped, never retried into a rate limit.
      summary.push({
        propertyId,
        watched: 0,
        written: 0,
        garden,
        note: snapshot.unavailable ?? "No forecast",
      });
      continue;
    }

    const breedings = (await db
      .select()
      .from(allTables.breedingRecords)
      .where(
        and(
          eq(allTables.breedingRecords.propertyId, propertyId),
          isNull(allTables.breedingRecords.deletedAt),
        ),
      )) as unknown as BreedingRecord[];

    // What has already happened. A cow that calved on Tuesday is not somebody
    // to wake up for on Wednesday, and until this was read the alert went out
    // anyway — every night until her window closed.
    const calvings = (await db
      .select()
      .from(allTables.calvingRecords)
      .where(
        and(
          eq(allTables.calvingRecords.propertyId, propertyId),
          isNull(allTables.calvingRecords.deletedAt),
        ),
      )) as unknown as CalvingRecord[];

    const animals = (await db
      .select()
      .from(allTables.animals)
      .where(
        and(eq(allTables.animals.propertyId, propertyId), isNull(allTables.animals.deletedAt)),
      )) as unknown as Animal[];

    const byId = new Map(animals.map((animal) => [animal.id, animal]));

    const cards = calvingWatch(breedings, calvings, snapshot.forecast, now, {
      defaultGestationDays: settings.gestationDays,
      windowDays: settings.calvingWindowDays,
      calfChillF: settings.calfChillF,
      pressureFallHpa: settings.pressureFallHpa,
      fullMoonDays: settings.fullMoonDays,
    });

    let written = 0;

    for (const card of cards) {
      // Per-trigger opt-out and lead time, per §6. A signal switched off never
      // reaches the calendar, and one outside its lead is not news yet.
      const due = card.signals.filter(
        (signal) =>
          WATCH_SIGNALS.includes(signal.signal) &&
          isWithinLead(settings, signal.signal, signal.at, now),
      );

      const dam = byId.get(card.damId);
      const name = dam === undefined ? "A cow" : displayName(dam);
      const id = watchEventId(card, day);

      const row = {
        id,
        propertyId,
        createdAt: now,
        updatedAt: now,
        title:
          due.length === 0
            ? `${name} — day ${card.dayOfGestation}`
            : `Calving watch: ${name}, day ${card.dayOfGestation}`,
        detail: describeWatch({ ...card, signals: due }, name),
        at: now,
        allDay: true,
        animalId: card.damId,
      };

      // Upsert on the derived id. Two polls in one day update one row.
      await db
        .insert(allTables.calendarEvents)
        .values(row as never)
        .onConflictDoUpdate({
          target: allTables.calendarEvents.id,
          set: { title: row.title, detail: row.detail, updatedAt: now },
        });

      written += 1;
    }

    summary.push({ propertyId, watched: cards.length, written, garden });
  }

  return NextResponse.json({ ranAt: now.toISOString(), properties: summary });
}

/**
 * GET runs the same poll.
 *
 * Some schedulers only issue GETs. The secret is still required, so this is
 * not a weaker door.
 */
export async function GET(request: Request) {
  return POST(request);
}
