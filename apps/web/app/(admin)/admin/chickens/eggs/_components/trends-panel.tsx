"use client";

import { useState } from "react";

import { Card, EmptyState, Meter, Pill, Section, Select, Stat, StatRow } from "@galaxy-farm/ui";
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
}: {
  readonly logs: readonly EggLog[];
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [flockId, setFlockId] = useState("all");

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

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Production"
        description="Straight off the collections — nothing here is stored, so correcting a row corrects the trend."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              label="Flock"
              hideLabel
              value={flockId}
              options={[
                { value: "all", label: "Every flock" },
                ...flocks.map((flock) => ({ value: flock.id, label: flock.name })),
              ]}
              onChange={(event) => setFlockId(event.target.value)}
            />
            <Select
              label="Period"
              hideLabel
              value={period}
              options={PERIODS.map((entry) => ({ value: entry.value, label: entry.label }))}
              onChange={(event) => setPeriod(event.target.value as Period)}
            />
          </div>
        }
      >
        {totals.length === 0 ? (
          <EmptyState
            title="Nothing to plot yet"
            detail="Log a few collections and the trend draws itself. One morning is a number; a fortnight is a trend."
          />
        ) : (
          <Card>
            <StatRow>
              <Stat
                label="Last 30 days"
                value={monthly}
                hint={`${collected} logged in total`}
                emphasis
              />
              <Stat
                label="Per bird per day"
                value={rate === undefined ? "—" : rate.toFixed(2)}
                hint={
                  birds === 0
                    ? "No birds counted for this flock"
                    : `${birds} bird${birds === 1 ? "" : "s"}, over 30 days`
                }
              />
              <Stat
                label="Best in this view"
                value={peak}
                hint={
                  period === "day" ? "In one day" : period === "week" ? "In a week" : "In a month"
                }
              />
            </StatRow>

            <ul className="mt-density flex flex-col gap-2">
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
          </Card>
        )}
      </Section>

      <Section
        title="Colour and size"
        description="From the collections that carried a breakdown. §5.4 keeps it optional, so this is a sample of the basket rather than all of it."
      >
        {withBreakdown.length === 0 ? (
          <EmptyState
            title="No breakdowns logged"
            detail="Add colour and size rows to a collection when it is worth knowing which hens are laying. The totals stand without them."
          />
        ) : (
          <Card>
            <p className="text-sm text-muted">
              {inBreakdown} of {collected} eggs broken down, across {withBreakdown.length}{" "}
              collection{withBreakdown.length === 1 ? "" : "s"}.
            </p>

            <div className="mt-density grid grid-cols-1 gap-density sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  By colour
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {[...byColour]
                    .sort(([, left], [, right]) => right - left)
                    .map(([colour, count]) => (
                      <li key={colour}>
                        <Pill tone="identity">
                          {count} {colour}
                        </Pill>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  By size
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {[...bySize]
                    .sort(([, left], [, right]) => right - left)
                    .map(([size, count]) => (
                      <li key={size}>
                        <Pill tone="action">
                          {count} {size.replace(/_/g, " ")}
                        </Pill>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </Card>
        )}
      </Section>

      {flocks.length < 2 ? null : (
        <Section title="Per flock" description="Who is actually laying, and how many are in there.">
          <Card>
            <ul className="flex flex-col gap-2">
              {flocks.map((flock) => {
                const theirs = logs.filter((log) => log.flockId === flock.id);
                const count = headCountOn(flock, adjustments, now);
                const theirRate = layRate(theirs, count, month);

                return (
                  <li
                    key={flock.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2 last:border-b-0"
                  >
                    <span className="text-ink">{flock.name}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      <Pill tone="neutral">
                        {count} bird{count === 1 ? "" : "s"}
                      </Pill>
                      <Pill tone="identity">
                        {theirs
                          .filter((log) => log.collectedOn >= month.from)
                          .reduce((sum, log) => sum + log.total, 0)}{" "}
                        in 30 days
                      </Pill>
                      <Pill tone={theirRate === undefined ? "neutral" : "action"}>
                        {theirRate === undefined ? "no rate" : `${theirRate.toFixed(2)}/bird/day`}
                      </Pill>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      )}
    </div>
  );
}
