"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Button, Card, EmptyState } from "@galaxy-farm/ui";
import {
  DEFAULT_WATCH_SETTINGS,
  displayName,
  illumination,
  isNearFullMoon,
  moonPhase,
  resolveWatchSettings,
  type Animal,
  type Forecast,
  type Ulid,
  type WatchSettings,
} from "@galaxy-farm/core";
import {
  calvingWatch,
  describeWatch,
  isInCalvingWindow,
  projectedDueDate,
  daysBred,
  type BreedingRecord,
} from "@galaxy-farm/module-cattle";

import { useRecords } from "@/lib/local/use-records";

/**
 * The calving watch, on the dashboard (spec §6, issue #14).
 *
 * "Front arriving Thursday night + full moon Friday — Dolly is at day 279."
 * That sentence is the feature, and the order of the two halves is the point:
 * the weather is the reason to look, the cow and her day are what to do about
 * it.
 *
 * **The card works with no forecast.** Which cows are being watched, what day
 * of gestation each is at, and when she is due are all derived from the
 * breeding record on the device (§4.2) — none of it waits on the network. The
 * forecast adds the signals when it arrives and says so plainly when it does
 * not. §6's last acceptance criterion is exactly this, and it is the one that
 * matters at 2am in a barn with one bar of signal.
 */

interface Snapshot {
  readonly forecast?: Forecast;
  readonly settings: WatchSettings;
  readonly unavailable?: string;
}

/**
 * Dates arrive from JSON as strings.
 *
 * Revived here rather than trusted, because every derivation downstream does
 * date arithmetic and a string that looks like a date silently produces `NaN`
 * days rather than an error anybody would notice.
 */
function reviveForecast(raw: unknown): Forecast | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = raw as Forecast;

  return {
    ...value,
    retrievedAt: new Date(value.retrievedAt),
    hourly: (value.hourly ?? []).map((hour) => ({ ...hour, at: new Date(hour.at) })),
    daily: (value.daily ?? []).map((day) => ({ ...day, date: new Date(day.date) })),
  };
}

export function CalvingWatchCard({ propertyId }: { readonly propertyId: Ulid }) {
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", { propertyId });
  const { records: animals } = useRecords<Animal>("animals", { propertyId });

  const [snapshot, setSnapshot] = useState<Snapshot>({
    settings: DEFAULT_WATCH_SETTINGS,
  });
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const response = await fetch("/api/weather");
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as Record<string, unknown>;
        if (!live) return;

        setSnapshot({
          ...(reviveForecast(body["forecast"]) === undefined
            ? {}
            : { forecast: reviveForecast(body["forecast"]) }),
          settings: resolveWatchSettings(body["settings"]),
          ...(typeof body["unavailable"] === "string" ? { unavailable: body["unavailable"] } : {}),
        });
      } catch {
        if (!live) return;
        // Offline is the ordinary case in a barn, not an error state. The card
        // below still knows every day count.
        setSnapshot({
          settings: DEFAULT_WATCH_SETTINGS,
          unavailable: "No forecast right now — day counts below are still current.",
        });
      } finally {
        if (live) setAsked(true);
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  const now = new Date();
  const settings = snapshot.settings;
  const byId = new Map(animals.map((animal) => [animal.id, animal]));

  const watched = breedings.filter((record) =>
    isInCalvingWindow(record, now, {
      defaultGestationDays: settings.gestationDays,
      windowDays: settings.calvingWindowDays,
    }),
  );

  if (watched.length === 0) {
    // Nothing is due. Say what the next thing is rather than showing an empty
    // box — a dashboard card that is blank half the year gets scrolled past
    // the other half.
    const next = breedings
      .map((record) => ({ record, due: projectedDueDate(record, settings.gestationDays) }))
      .filter((entry) => entry.due >= now && entry.record.pregCheck?.result !== "open")
      .sort((left, right) => left.due.getTime() - right.due.getTime())[0];

    return (
      <Card title="Calving watch">
        <EmptyState
          title="Nobody is due"
          detail={
            next === undefined
              ? "No open breedings on file. Record one and the watch opens a fortnight before she is due."
              : `Next is ${displayName(byId.get(next.record.damId) ?? ({ name: "a cow" } as Animal))}, due ${next.due.toLocaleDateString(undefined, { day: "numeric", month: "long" })}. The watch opens a fortnight before.`
          }
          action={
            <Link
              href="/admin/cattle/breeding"
              className="text-action underline underline-offset-2"
            >
              Breeding records
            </Link>
          }
        />
      </Card>
    );
  }

  const cards =
    snapshot.forecast === undefined
      ? // No forecast, so no signals — but the day counts are entirely local.
        watched.map((record) => ({
          damId: record.damId,
          breedingRecordId: record.id,
          dueOn: projectedDueDate(record, settings.gestationDays),
          dayOfGestation: daysBred(record, now),
          signals: [],
          urgent: false,
        }))
      : calvingWatch(breedings, snapshot.forecast, now, {
          defaultGestationDays: settings.gestationDays,
          windowDays: settings.calvingWindowDays,
          calfChillF: settings.calfChillF,
          pressureFallHpa: settings.pressureFallHpa,
          fullMoonDays: settings.fullMoonDays,
        });

  const urgent = cards.some((card) => card.urgent);
  // Computed, never fetched — §6's first acceptance criterion. The phase is
  // right on a phone in a barn with the radio off.
  const phase = moonPhase(now).replace(/_/g, " ");
  const lit = Math.round(illumination(now) * 100);

  return (
    <Card
      title="Calving watch"
      actions={
        urgent ? (
          <Badge tone="danger">Watch tonight</Badge>
        ) : (
          <Badge tone="action">
            {cards.length} in {cards.length === 1 ? "her window" : "their windows"}
          </Badge>
        )
      }
    >
      <ul className="flex flex-col gap-density">
        {cards.map((card) => {
          const dam = byId.get(card.damId);
          const name = dam === undefined ? "A cow" : displayName(dam);

          return (
            <li key={card.breedingRecordId} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                {dam === undefined ? (
                  <span className="font-medium text-ink">{name}</span>
                ) : (
                  <Link
                    href={`/admin/cattle/calving?dam=${dam.id}`}
                    className="font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
                  >
                    {name}
                  </Link>
                )}
                <Badge tone={card.urgent ? "danger" : "neutral"}>Day {card.dayOfGestation}</Badge>
                <span className="text-sm text-muted [font-variant-numeric:tabular-nums]">
                  due {card.dueOn.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
              </span>
              <span className="text-sm text-muted">{describeWatch(card, name)}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-density flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-density text-sm text-muted">
        <span className="capitalize">
          {phase} moon, {lit}% lit
          {isNearFullMoon(now, settings.fullMoonDays) ? " — near full" : ""}
        </span>
        {snapshot.unavailable === undefined ? (
          <Link href="/admin/cattle/calving" className="text-action underline underline-offset-2">
            Record a calving
          </Link>
        ) : (
          <span className="flex items-center gap-2">
            {snapshot.unavailable}
            {asked ? (
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Try again
              </Button>
            ) : null}
          </span>
        )}
      </div>
    </Card>
  );
}
