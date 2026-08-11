import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  displayName,
  isWithinLead,
  WATCH_SIGNALS,
  type Animal,
  type Ulid,
} from "@galaxy-farm/core";
import { allTables } from "@galaxy-farm/infra-db";
import {
  calvingWatch,
  describeWatch,
  type BreedingRecord,
  type CalvingWatchCard,
} from "@galaxy-farm/module-cattle";

import { database } from "@/lib/credential-store";
import { weatherSnapshot } from "@/lib/weather-service";

/**
 * /api/cron/weather — the scheduled poll (spec §6).
 *
 * Runs on a schedule, reads the forecast for each property's coordinates, and
 * projects it onto the calendar. Calendar events rather than a push straight to
 * a phone, deliberately: an event syncs to every device (§4.2) and is there
 * when somebody looks, whereas a notification that arrives while a person is
 * moving cattle is a notification they will never see again.
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

  const summary: { propertyId: string; watched: number; written: number; note?: string }[] = [];

  for (const property of properties) {
    const propertyId = property.id as Ulid;
    const snapshot = await weatherSnapshot(propertyId);

    if (snapshot.forecast === undefined) {
      // §6's last acceptance criterion, on the server side: an unreachable
      // forecast is reported and skipped, never retried into a rate limit.
      summary.push({
        propertyId,
        watched: 0,
        written: 0,
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

    const animals = (await db
      .select()
      .from(allTables.animals)
      .where(
        and(eq(allTables.animals.propertyId, propertyId), isNull(allTables.animals.deletedAt)),
      )) as unknown as Animal[];

    const byId = new Map(animals.map((animal) => [animal.id, animal]));
    const settings = snapshot.settings;

    const cards = calvingWatch(breedings, snapshot.forecast, now, {
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

    summary.push({ propertyId, watched: cards.length, written });
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
