"use client";

import { useState } from "react";

import { EmptyState, Meter, StatRow, Tile } from "@galaxy-farm/ui";
import { addCalendarDays, endOfDay, startOfDay } from "@galaxy-farm/core";
import {
  breakdownTotals,
  eggTotalsByPeriod,
  headCountOn,
  layRate,
  totalBirdsOn,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import { ChipRow } from "@/app/(admin)/admin/horses/_components/list-row";

/**
 * Egg production trends (spec §6, §7 — "logs + trends").
 *
 * §6 asks for production "by coop/colour/size", and the number that actually
 * says how the flock is doing is none of those three: it is eggs per bird per
 * day. Twenty eggs from forty hens is a problem and twenty from twenty-two is
 * a good week, and only the rate tells them apart — which is why the headcount
 * log next door is what makes this screen worth reading.
 *
 * The colour and size totals count only the collections that carried a
 * breakdown, and say so. §5.4 makes the breakdown optional, so a total drawn
 * from it is a sample and presenting it as the whole would be a quiet lie.
 */

const PERIODS = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
] as const;

type Period = (typeof PERIODS)[number]["value"];

/** How many buckets to draw. A year of days is a wall, not a trend. */
const BUCKETS = 14;

function label(key: string, period: Period): string {
  if (period === "month") {
    const [year, month] = key.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
  }
  if (period === "week") return key.replace("-W", " week ");

  const [year, month, day] = key.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function TrendsPanel({
  logs,
  flocks,
  adjustments,
  initialFlockId,
}: {
  readonly logs: readonly EggLog[];
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
  /** The flock to open on — a flock's page links here with its own id. */
  readonly initialFlockId?: string;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [flockId, setFlockId] = useState(initialFlockId ?? "all");

  const chosen = flocks.find((flock) => flock.id === flockId);
  const shown = flockId === "all" ? logs : logs.filter((log) => log.flockId === flockId);

  // End of today, and whole days below: a collection carries a date, stored at
  // midday, so an "as of now" asked in the morning would drop this morning.
  const now = endOfDay(new Date());
  const totals = [...eggTotalsByPeriod(shown, period)].slice(-BUCKETS);
  const peak = totals.reduce((most, [, count]) => Math.max(most, count), 0);
  const { byColour, bySize } = breakdownTotals(shown);

  const collected = shown.reduce((sum, log) => sum + log.total, 0);
  const withBreakdown = shown.filter((log) => log.breakdown.length > 0);
  const inBreakdown = withBreakdown.reduce((sum, log) => sum + log.total, 0);

  const birds =
    chosen === undefined
      ? totalBirdsOn(flocks, adjustments, now)
      : headCountOn(chosen, adjustments, now);

  const month = { from: startOfDay(addCalendarDays(now, -29)), to: now };
  const rate = layRate(shown, birds, month);
  const monthly = shown
    .filter((log) => log.collectedOn >= month.from && log.collectedOn <= month.to)
    .reduce((sum, log) => sum + log.total, 0);

  const flockChips = [
    { key: "all", label: "Every flock" },
    ...flocks.map((flock) => ({ key: flock.id as string, label: flock.name })),
  ];

  return (
    <div className="flex flex-col gap-density">
      {/*
        Straight off the collections — nothing here is stored, so correcting a
        row corrects the trend. The period and the flock as chips: both are a
        handful of choices, and each is one press.
      */}
      <div className="flex flex-col gap-1">
        <ChipRow
          label="Period"
          chips={PERIODS.map((entry) => ({ key: entry.value, label: entry.label }))}
          value={period}
          onChange={setPeriod}
        />
        {flocks.length < 2 ? null : (
          <ChipRow label="Flock" chips={flockChips} value={flockId} onChange={setFlockId} />
        )}
      </div>

      {totals.length === 0 ? (
        <EmptyState
          title="Nothing to plot yet"
          detail="Log a few collections and the trend draws itself."
        />
      ) : (
        <>
          <StatRow>
            <Tile
              label="Last 30 days"
              value={monthly}
              hint={`${collected} logged in total`}
              emphasis
            />
            <Tile
              label="Per bird per day"
              value={rate === undefined ? "—" : rate.toFixed(2)}
              hint={
                birds === 0
                  ? "No birds counted"
                  : `${birds} bird${birds === 1 ? "" : "s"}, over 30 days`
              }
            />
            <Tile
              label="Best in this view"
              value={peak}
              hint={
                period === "day" ? "In one day" : period === "week" ? "In a week" : "In a month"
              }
            />
          </StatRow>

          <ul
            aria-label="Production"
            className="flex flex-col gap-2 rounded-density border border-rule bg-panel p-density"
          >
            {totals.map(([key, count]) => (
              <li key={key}>
                <Meter
                  // Against the tallest bucket rather than a fixed ceiling:
                  // eighteen hens and eighty hens are different farms, and
                  // both want the shape of their own fortnight.
                  value={peak === 0 ? 0 : count / peak}
                  tone={count === peak ? "calm" : "action"}
                  label={label(key, period)}
                  detail={count}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/*
        From the collections that carried a breakdown, and the line says how
        many — §5.4 keeps it optional, so this is a sample, not the basket.
      */}
      <section aria-labelledby="eggs-breakdown" className="flex flex-col gap-2.5">
        <h2
          id="eggs-breakdown"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Colour and size
        </h2>
        {withBreakdown.length === 0 ? (
          <p className="text-sm text-muted">No breakdowns logged yet.</p>
        ) : (
          <div className="flex flex-col gap-1 rounded-density border border-rule bg-panel p-density text-sm">
            <p className="text-muted">
              {inBreakdown} of {collected} eggs, across {withBreakdown.length} collection
              {withBreakdown.length === 1 ? "" : "s"}
            </p>
            <p className="text-ink">
              {[...byColour]
                .sort(([, left], [, right]) => right - left)
                .map(([colour, count]) => `${count} ${colour}`)
                .join(" · ")}
            </p>
            <p className="text-ink">
              {[...bySize]
                .sort(([, left], [, right]) => right - left)
                .map(([size, count]) => `${count} ${size.replace(/_/g, " ")}`)
                .join(" · ")}
            </p>
          </div>
        )}
      </section>

      {/* Who is actually laying, and how many are in there. */}
      {flocks.length < 2 ? null : (
        <section aria-labelledby="eggs-per-flock" className="flex flex-col gap-2.5">
          <h2
            id="eggs-per-flock"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Per flock
          </h2>
          <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
            {flocks.map((flock) => {
              const theirs = logs.filter((log) => log.flockId === flock.id);
              const count = headCountOn(flock, adjustments, now);
              const theirRate = layRate(theirs, count, month);
              const inMonth = theirs
                .filter((log) => log.collectedOn >= month.from)
                .reduce((sum, log) => sum + log.total, 0);

              return (
                <li
                  key={flock.id}
                  className="flex min-h-[64px] flex-col justify-center gap-0.5 px-4 py-2"
                >
                  <span className="truncate font-semibold text-ink">{flock.name}</span>
                  <span className="truncate text-sm text-muted">
                    {[
                      `${count} bird${count === 1 ? "" : "s"}`,
                      `${inMonth} in 30 days`,
                      theirRate === undefined
                        ? "no rate"
                        : `${theirRate.toFixed(2)} per bird a day`,
                    ].join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
