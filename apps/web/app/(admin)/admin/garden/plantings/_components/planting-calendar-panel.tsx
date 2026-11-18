"use client";

import { useMemo, useState } from "react";

import { Checkbox, EmptyState, SEGMENT_TRACK_CLASS, segmentClass } from "@galaxy-farm/ui";
import {
  cropGrowing,
  FROST_TOLERANCE_LABELS,
  GARDEN_CROPS,
  growingFor,
  MILESTONE_LABELS,
  plantingSchedule,
  type Crop,
  type FrostDates,
  type Milestone,
} from "@galaxy-farm/module-garden";

import { formatDate } from "@/app/(admin)/admin/garden/_components/labels";
import { LandRow, RowList } from "@/app/(admin)/admin/pastures/_components/land-kit";

/**
 * The planting calendar (spec §5.5): every crop's year, worked out from the
 * farm's frost dates.
 *
 * Browseable on purpose. The season plan is what the garden is committed to
 * and the only thing that raises a notification; this is the page somebody
 * reads in January to decide what goes in the plan — "what can I still start
 * this month?" is the question it answers first.
 *
 * Your crops by default, every crop the garden knows behind one switch: the
 * catalogue is short in a new garden, and a calendar of three crops answers
 * nothing about what else could go in.
 */

type Range = "month" | "next" | "year";

const RANGES: readonly { readonly id: Range; readonly label: string }[] = [
  { id: "month", label: "This month" },
  { id: "next", label: "Next month" },
  { id: "year", label: "Next 12 months" },
];

interface Row {
  readonly name: string;
  readonly milestones: readonly Milestone[];
  readonly tolerance?: string | undefined;
}

function overlaps(milestone: Milestone, from: Date, to: Date): boolean {
  return milestone.from <= to && milestone.to >= from;
}

export function PlantingCalendarPanel({
  crops,
  frostFor,
  now = new Date(),
}: {
  readonly crops: readonly Crop[];
  /** The farm's frost dates for a year. */
  readonly frostFor: (year: number) => FrostDates | undefined;
  readonly now?: Date;
}) {
  const frost = frostFor(now.getFullYear());
  const nextFrost = frostFor(now.getFullYear() + 1);
  const [range, setRange] = useState<Range>("month");
  const [everything, setEverything] = useState(crops.length === 0);

  const rows = useMemo<Row[]>(() => {
    const source = everything
      ? GARDEN_CROPS.map((entry) => ({ name: entry.name, facts: growingFor(entry.name) }))
      : crops.map((crop) => ({ name: crop.name, facts: cropGrowing(crop) }));
    return source
      .map(({ name, facts }) => ({
        name,
        // Harvest is what you get, not what you do; the calendar is for doing.
        // A rolling year: this season's dates still ahead, then next season's,
        // so in November the calendar is already about February, not empty.
        milestones: [...plantingSchedule(facts, frost), ...plantingSchedule(facts, nextFrost)]
          .filter((step) => step.kind !== "harvest")
          .filter((step) => step.to >= new Date(now.getFullYear(), now.getMonth(), 1))
          .filter((step) => step.from <= new Date(now.getTime() + 366 * 86_400_000)),
        tolerance:
          facts?.frostTolerance === undefined
            ? undefined
            : FROST_TOLERANCE_LABELS[facts.frostTolerance].split(" — ")[0],
      }))
      .filter((row) => row.milestones.length > 0);
  }, [crops, frost, nextFrost, everything, now]);

  if (frost === undefined) {
    return (
      <EmptyState
        title="No frost dates yet"
        detail="Set the growing zone, or your own frost dates, in Settings → Farm. Every planting date is worked out from them."
      />
    );
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth() + (range === "next" ? 1 : 0), 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59);
  const shown = rows
    .map((row) => ({
      ...row,
      milestones:
        range === "year"
          ? row.milestones
          : row.milestones.filter((step) => overlaps(step, monthStart, monthEnd)),
    }))
    .filter((row) => row.milestones.length > 0)
    .sort(
      (left, right) =>
        (left.milestones[0]?.from.getTime() ?? 0) - (right.milestones[0]?.from.getTime() ?? 0) ||
        left.name.localeCompare(right.name),
    );

  return (
    <div className="flex flex-col gap-density">
      <p className="text-sm text-muted">
        {now > frost.firstFallFrost && nextFrost !== undefined
          ? `Next season: last frost ${formatDate(nextFrost.lastSpringFrost)}, first frost ${formatDate(nextFrost.firstFallFrost)}.`
          : `Last frost ${formatDate(frost.lastSpringFrost)} · first frost ${formatDate(frost.firstFallFrost)}.`}{" "}
        Change them in Settings → Farm.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Show" className={SEGMENT_TRACK_CLASS}>
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={range === option.id}
              onClick={() => setRange(option.id)}
              className={segmentClass(range === option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Checkbox
          label="Every crop the garden knows"
          checked={everything}
          onChange={(event) => setEverything(event.target.checked)}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={range === "year" ? "Nothing to schedule" : "Nothing to start in this stretch"}
          detail={
            everything || crops.length === 0
              ? "Try another month."
              : "Try another month, or tick “Every crop the garden knows”."
          }
        />
      ) : (
        <RowList label="Planting calendar">
          {shown.map((row) => {
            const live = row.milestones.some((step) => overlaps(step, now, now));
            return (
              <LandRow
                key={row.name}
                title={row.name}
                line={[
                  ...row.milestones.map((step) =>
                    step.from.getTime() === step.to.getTime()
                      ? `${MILESTONE_LABELS[step.kind]} ${formatDate(step.from)}`
                      : `${MILESTONE_LABELS[step.kind]} ${formatDate(step.from)} – ${formatDate(step.to)}`,
                  ),
                  row.tolerance,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                chip={live ? { tone: "action", label: "Now" } : undefined}
              />
            );
          })}
        </RowList>
      )}
      {/* Kept quiet: the plan is where a crop becomes a commitment. */}
      <p className="text-sm text-muted">
        To be reminded, add it to the season plan — the calendar itself never sends anything.
      </p>
    </div>
  );
}
