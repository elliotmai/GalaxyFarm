"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Meter, Pill, RecordCard } from "@galaxy-farm/ui";
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
  awaitingCalving,
  calvingWatch,
  daysBred,
  describeWatch,
  projectedDueDate,
  type BreedingRecord,
  type CalvingWatchCard as WatchCard,
  type CalvingRecord,
} from "@galaxy-farm/module-cattle";

import { useRecords } from "@/lib/local/use-records";

/**
 * The calving watch, on the dashboard (spec §6, issue #14).
 *
 * Split in two for the Today screen: `useCalvingWatch` works out who is in her
 * window and whether tonight matters, which is all the "Needs you" row shows,
 * and `CalvingWatchDetail` is the full watch that row opens onto.
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

export interface CalvingWatch {
  /** One entry per cow in her window, soonest first as the domain orders them. */
  readonly cards: readonly WatchCard[];
  readonly byId: ReadonlyMap<Ulid, Animal>;
  readonly settings: WatchSettings;
  /** Why there is no forecast, when there is none. */
  readonly unavailable?: string | undefined;
  /** The forecast itself, so the Today header can say one fact about the weather. */
  readonly forecast?: Forecast | undefined;
  /** The forecast has been asked for, whichever way it answered. */
  readonly asked: boolean;
  /** Something in the forecast is worth acting on tonight. */
  readonly urgent: boolean;
  readonly now: Date;
}

/** The dam's name, or a stand-in when her record has not synced yet. */
export function damName(watch: CalvingWatch, card: WatchCard): string {
  const dam = watch.byId.get(card.damId);
  return dam === undefined ? "A cow" : displayName(dam);
}

export function useCalvingWatch(propertyId: Ulid): CalvingWatch {
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", { propertyId });
  // The other half of the watch: a cow with a calf at side is off it.
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", { propertyId });
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
        // Offline is the ordinary case in a barn, not an error state. The watch
        // still knows every day count.
        setSnapshot({
          settings: DEFAULT_WATCH_SETTINGS,
          unavailable: "No forecast right now — day counts are still current.",
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
  const options = {
    defaultGestationDays: settings.gestationDays,
    windowDays: settings.calvingWindowDays,
  };

  const cards: readonly WatchCard[] =
    snapshot.forecast === undefined
      ? // No forecast, so no signals — but the day counts are entirely local.
        awaitingCalving(breedings, calvings, now, options).map((record) => ({
          damId: record.damId,
          breedingRecordId: record.id,
          dueOn: projectedDueDate(record, settings.gestationDays),
          dayOfGestation: daysBred(record, now),
          signals: [],
          urgent: false,
        }))
      : calvingWatch(breedings, calvings, snapshot.forecast, now, {
          ...options,
          calfChillF: settings.calfChillF,
          pressureFallHpa: settings.pressureFallHpa,
          fullMoonDays: settings.fullMoonDays,
        });

  return {
    cards,
    byId,
    settings,
    unavailable: snapshot.unavailable,
    forecast: snapshot.forecast,
    asked,
    urgent: cards.some((card) => card.urgent),
    now,
  };
}

/**
 * Every cow in her window, with the bar and the signals.
 *
 * What the "Needs you" row opens onto. The row says who and when; this is for
 * the night somebody is deciding whether to sleep in the barn.
 */
export function CalvingWatchDetail({ watch }: { readonly watch: CalvingWatch }) {
  const { settings, now } = watch;
  // Computed, never fetched — §6's first acceptance criterion. The phase is
  // right on a phone in a barn with the radio off.
  const phase = moonPhase(now).replace(/_/g, " ");
  const lit = Math.round(illumination(now) * 100);

  return (
    <div className="flex flex-col gap-density">
      {watch.cards.map((card) => {
        const dam = watch.byId.get(card.damId);
        const name = damName(watch, card);
        const total = settings.gestationDays;
        const window = settings.calvingWindowDays;

        return (
          <RecordCard
            key={card.breedingRecordId}
            tone={card.urgent ? "danger" : "identity"}
            title={
              dam === undefined ? (
                name
              ) : (
                <Link
                  href={`/admin/cattle/calving?dam=${dam.id}`}
                  className="underline decoration-edge underline-offset-4 hover:decoration-action"
                >
                  {name}
                </Link>
              )
            }
            subtitle={describeWatch(card, name)}
            actions={
              <Pill tone={card.urgent ? "danger" : "identity"} dot={card.urgent}>
                Day {card.dayOfGestation}
              </Pill>
            }
            meta={card.signals.map((signal) => (
              <Pill key={signal.signal} tone={signal.signal === "full_moon" ? "neutral" : "danger"}>
                {signal.signal.replace(/_/g, " ")}
              </Pill>
            ))}
          >
            {/*
              The bar is the point of the card. "Day 279" means something to
              somebody who already knows the number is 283; the bar means
              "nearly" to anybody. The marker is where the window opened, so
              you can see at a glance whether she is early in it or late.
            */}
            <Meter
              value={card.dayOfGestation / total}
              tone={card.urgent ? "danger" : "identity"}
              label="Gestation"
              marker={(total - window) / total}
              detail={`day ${card.dayOfGestation} of ${total} · due ${card.dueOn.toLocaleDateString(
                undefined,
                { day: "numeric", month: "short" },
              )}`}
            />
          </RecordCard>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span className="capitalize">
          {phase} moon, {lit}% lit
          {isNearFullMoon(now, settings.fullMoonDays) ? " — near full" : ""}
        </span>
        {watch.unavailable === undefined ? (
          <Link href="/admin/cattle/calving" className="text-action underline underline-offset-2">
            Record a calving
          </Link>
        ) : (
          <span className="flex items-center gap-2">
            {watch.unavailable}
            {watch.asked ? (
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Try again
              </Button>
            ) : null}
          </span>
        )}
      </div>
    </div>
  );
}
