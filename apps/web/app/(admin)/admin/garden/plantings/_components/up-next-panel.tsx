"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EmptyState, useToast } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  GARDEN_JOB_LABELS,
  gardenJobs,
  plantingSchema,
  type Crop,
  type FrostDates,
  type GardenJob,
  type PlannedPlanting,
  type Planting,
  type Variety,
} from "@galaxy-farm/module-garden";

import { formatDate } from "@/app/(admin)/admin/garden/_components/labels";
import { LandRow, RowAction, RowList } from "@/app/(admin)/admin/pastures/_components/land-kit";
import { useShareSummary } from "@/app/(admin)/_components/share-button";
import { varietyFacts, varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * Up next (spec §5.5): what the garden needs doing in the next fortnight.
 *
 * The first thing on the garden, because it is the question somebody opens it
 * with on a Saturday morning. Built from the season plan's windows, the
 * seedlings indoors, what is in the ground and the succession crops — and each
 * row's button does the thing, or opens where it is done, so nobody has to
 * work out which tab the answer is on.
 */
export function UpNextPanel({
  planned,
  plantings,
  varieties,
  crops,
  frost,
  propertyId,
  actorId,
  onOpenPlan,
  onPlantOut,
  onRecordSowing,
  now = new Date(),
}: {
  readonly planned: readonly PlannedPlanting[];
  readonly plantings: readonly Planting[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly frost: FrostDates | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** The plan, where a window is started or planted from. */
  readonly onOpenPlan: () => void;
  /** A hardened seedling with no bed yet: open it to choose one. */
  readonly onPlantOut: (planting: Planting) => void;
  /** The next row of a succession crop: open a new planting of it. */
  readonly onRecordSowing: (varietyId: Ulid) => void;
  readonly now?: Date;
}) {
  const api = useMutations<Planting>("plantings", "plantings", plantingSchema, propertyId, actorId);
  const { show } = useToast();

  const jobs = useMemo(
    () =>
      gardenJobs({
        planned,
        plantings,
        factsFor: (varietyId) => varietyFacts(varietyId, varieties, crops),
        frost,
        now,
      }),
    [planned, plantings, varieties, crops, frost, now],
  );

  const name = (varietyId: Ulid) =>
    varietyLabel(
      varieties.find((variety) => variety.id === varietyId),
      crops,
    );
  const plantingOf = (job: GardenJob) => plantings.find((held) => held.id === job.plantingId);

  async function startHardening(planting: Planting) {
    const result = await api.update(planting.id, {
      status: "hardening",
      hardenedOffOn: new Date(),
    } as Partial<Planting>);
    if (result.ok) show({ message: `${name(planting.varietyId)} hardening off`, tone: "success" });
  }

  async function plantOut(planting: Planting) {
    // Into a bed it already names; one with none opens so a bed can be chosen.
    if (planting.bedId === undefined) {
      onPlantOut(planting);
      return;
    }
    const result = await api.update(planting.id, {
      status: "growing",
      plantedOn: new Date(),
    } as Partial<Planting>);
    if (result.ok) show({ message: `${name(planting.varietyId)} planted out`, tone: "success" });
  }

  function action(job: GardenJob) {
    const planting = plantingOf(job);
    switch (job.kind) {
      case "start_indoors":
      case "sow":
      case "transplant":
        return (
          <RowAction label={`Open ${name(job.varietyId)} in the plan`} onClick={onOpenPlan}>
            {job.kind === "start_indoors" ? "Start it" : "Plant it"}
          </RowAction>
        );
      case "harden_off":
        return planting === undefined ? undefined : (
          <RowAction
            label={`${name(job.varietyId)} has gone out to harden off`}
            onClick={() => void startHardening(planting)}
          >
            Started
          </RowAction>
        );
      case "plant_out":
        return planting === undefined ? undefined : (
          <RowAction
            label={`${name(job.varietyId)} is planted out`}
            onClick={() => void plantOut(planting)}
          >
            Planted
          </RowAction>
        );
      case "pick":
        return (
          <Link
            href="/admin/garden/harvest"
            className="inline-flex min-h-target items-center whitespace-nowrap rounded-density px-3 text-sm font-semibold text-action hover:bg-raised"
          >
            Log a harvest
          </Link>
        );
      case "sow_again":
        return (
          <RowAction
            label={`Record a new sowing of ${name(job.varietyId)}`}
            onClick={() => onRecordSowing(job.varietyId)}
          >
            Sow
          </RowAction>
        );
    }
  }

  function when(job: GardenJob): string {
    if (job.overdue) return `overdue since ${formatDate(job.until ?? job.due)}`;
    const span =
      job.until === undefined || job.until.getTime() === job.due.getTime()
        ? formatDate(job.due)
        : `${formatDate(job.due)} – ${formatDate(job.until)}`;
    return job.due <= now ? `now · until ${formatDate(job.until ?? job.due)}` : span;
  }

  useShareSummary({
    title: "Garden — up next",
    lines:
      jobs.length === 0
        ? ["Nothing due in the next two weeks."]
        : jobs.map((job) => `${GARDEN_JOB_LABELS[job.kind]} ${name(job.varietyId)} — ${when(job)}`),
  });

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="Nothing due in the next two weeks"
        detail={
          frost === undefined
            ? "Set your growing zone or frost dates in Settings → Farm, and add crops to the season plan — the dates come from them."
            : "Add crops to the season plan, or check When to plant for what could go in now."
        }
      />
    );
  }

  const weekOut = new Date(now.getTime() + 7 * 86_400_000);
  const groups: { title: string; jobs: GardenJob[] }[] = [
    { title: "Overdue", jobs: jobs.filter((job) => job.overdue) },
    { title: "This week", jobs: jobs.filter((job) => !job.overdue && job.due <= weekOut) },
    { title: "Next week", jobs: jobs.filter((job) => !job.overdue && job.due > weekOut) },
  ];

  return (
    <div className="flex flex-col gap-density">
      {groups
        .filter((group) => group.jobs.length > 0)
        .map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
            <h2 className="gf-label">{group.title}</h2>
            <RowList label={group.title}>
              {group.jobs.map((job) => (
                <LandRow
                  key={job.id}
                  title={`${GARDEN_JOB_LABELS[job.kind]} ${name(job.varietyId)}`}
                  line={when(job)}
                  chip={job.overdue ? { tone: "danger", label: "Overdue" } : undefined}
                  action={action(job)}
                />
              ))}
            </RowList>
          </section>
        ))}
    </div>
  );
}
