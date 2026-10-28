"use client";

import Link from "next/link";

import { Button, EmptyState, Pill } from "@galaxy-farm/ui";
import {
  animalsFedBy,
  displayName,
  isShared,
  type Animal,
  type FeedingPlan,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import { line, unitLabel } from "./feed-format";

/**
 * Who gets what (Farm › Feed › Plan).
 *
 * Every species' plans, one card each: who it feeds on the header, a line per
 * feed, and "Adjust" opening the same editor Cattle › Feed plans uses. The
 * exception is a shared bowl (`alsoFeeds`), which only the pets screen knows
 * how to write — the cattle editor would save it back as one animal's — so
 * that card's Adjust goes there instead.
 */

const FREQUENCY: Readonly<Record<string, string>> = {
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  every_other_day: "every other day",
  weekly: "weekly",
};

export function PlanView({
  plans,
  feeds,
  animals,
  zones,
  scopes,
  loading,
  onAdd,
  onAdjust,
}: {
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  /** Each live animal with the pens it stands in, for a pen plan's head count. */
  readonly scopes: readonly { id: Ulid; zoneIds: readonly Ulid[] }[];
  readonly loading: boolean;
  readonly onAdd: () => void;
  readonly onAdjust: (plan: FeedingPlan) => void;
}) {
  if (loading) return <p className="text-muted">Looking…</p>;

  if (plans.length === 0) {
    return (
      <EmptyState
        title="Nothing planned"
        detail="A plan says who gets what. Today's feedings and the shed's run-out dates follow from it."
        action={
          <Button variant="primary" onClick={onAdd}>
            Add a plan
          </Button>
        }
      />
    );
  }

  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  const animalById = new Map(animals.map((animal) => [animal.id, animal]));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));

  function who(plan: FeedingPlan): string {
    if (plan.target === "animal") {
      const names = animalsFedBy(plan).map((id) => {
        const animal = animalById.get(id);
        return animal === undefined ? "an animal" : displayName(animal);
      });
      return names.join(", ");
    }
    const shared = isShared(plan) ? "shared" : undefined;
    if (plan.target === "zone") {
      const head = scopes.filter((scope) => scope.zoneIds.includes(plan.targetId)).length;
      return line(
        zoneById.get(plan.targetId)?.name ?? "a pen",
        `${head} head`,
        shared,
        plan.specialNotes,
      );
    }
    return line("Everybody", shared, plan.specialNotes);
  }

  // Feeding first, then what is switched off for the season.
  const sorted = [...plans].sort(
    (left, right) =>
      Number(right.active) - Number(left.active) || left.name.localeCompare(right.name),
  );

  return (
    <div className="flex flex-col gap-density">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {line(
            `${plans.filter((plan) => plan.active).length} feeding`,
            plans.some((plan) => !plan.active) &&
              `${plans.filter((plan) => !plan.active).length} off`,
          )}
        </p>
        <span className="hidden sm:block">
          <Button variant="primary" aria-haspopup="dialog" onClick={onAdd}>
            <span aria-hidden="true">+</span> Add plan
          </Button>
        </span>
      </div>

      {sorted.map((plan) => {
        const sharedBowl = (plan.alsoFeeds ?? []).length > 0;
        return (
          <section
            key={plan.id}
            aria-label={plan.name}
            className="overflow-hidden rounded-density border border-rule bg-panel"
          >
            <div className="flex min-h-[60px] items-center gap-3 bg-canvas py-2 pl-4 pr-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{plan.name}</span>
                  {plan.active ? null : <Pill tone="neutral">Off</Pill>}
                </span>
                <span className="text-sm text-muted">{who(plan)}</span>
              </span>
              {sharedBowl ? (
                <Link
                  href="/admin/pets"
                  aria-label={`Adjust ${plan.name} on Pets`}
                  className="inline-flex min-h-target shrink-0 items-center rounded-density border border-action bg-panel px-3.5 text-sm font-semibold text-action hover:bg-canvas"
                >
                  Adjust
                </Link>
              ) : (
                <Button
                  aria-haspopup="dialog"
                  aria-label={`Adjust ${plan.name}`}
                  onClick={() => onAdjust(plan)}
                >
                  Adjust
                </Button>
              )}
            </div>
            <ul
              aria-label={`${plan.name} ration`}
              className="divide-y divide-rule border-t border-rule"
            >
              {plan.lines.map((entry, index) => (
                <li
                  key={`${entry.feedTypeId}-${entry.timeOfDay}-${index}`}
                  className="flex min-h-[46px] flex-wrap items-center justify-between gap-x-3 px-4 py-2"
                >
                  <span className="min-w-0 text-ink">
                    {feedById.get(entry.feedTypeId as Ulid)?.name ?? "feed"}
                  </span>
                  <span className="text-sm">
                    <span className="gf-numeric font-semibold text-ink">
                      {entry.amount.amount} {unitLabel(entry.amount.unit)}
                    </span>
                    <span className="text-muted">
                      {" · "}
                      {line(FREQUENCY[entry.frequency] ?? entry.frequency, entry.timeOfDay)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
