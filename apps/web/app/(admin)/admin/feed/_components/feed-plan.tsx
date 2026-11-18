"use client";

import { Button, EmptyState, Pill, PlusIcon } from "@galaxy-farm/ui";
import {
  animalsOf,
  audienceOf,
  flocksOf,
  isTotal,
  SPECIES,
  SPECIES_LABELS,
  type Animal,
  type FeedingPlan,
  type Species,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import {
  membersLabel,
  placeLabel,
  type PlanFlock,
} from "@/app/(admin)/_components/feeding-plan-editor";
import { amountWords, receptacleWords } from "@/lib/feed-lines";

import { line } from "./feed-format";

/**
 * Farm › Feed › Plan: every feeding plan on the place, by kind of animal
 * (spec §5.1, decision 49).
 *
 * A plan owns its animals, so a card can say exactly what a person putting
 * feed out needs: who, where, and each feed with how much, what it goes in,
 * how often and when. Livestock first, then the household — the order the
 * morning round is walked in.
 */

const FREQUENCY: Readonly<Record<string, string>> = {
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  every_other_day: "every other day",
  twice_weekly: "twice a week",
  weekly: "weekly",
};

const ORDER: readonly Species[] = [
  ...SPECIES.filter((species) => audienceOf(species) === "livestock"),
  ...SPECIES.filter((species) => audienceOf(species) === "pet"),
];

export function PlanView({
  plans,
  feeds,
  animals,
  flocks = [],
  zones,
  loading,
  onAdd,
  onAdjust,
}: {
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly animals: readonly Animal[];
  readonly flocks?: readonly PlanFlock[];
  readonly zones: readonly Zone[];
  /** Accepted for callers that still pass it; a plan names its own animals. */
  readonly scopes?: readonly { id: Ulid }[];
  readonly loading: boolean;
  readonly onAdd: () => void;
  readonly onAdjust: (plan: FeedingPlan) => void;
}) {
  if (loading) return <p className="text-muted">Looking…</p>;

  if (plans.length === 0) {
    return (
      <EmptyState
        title="Nothing planned"
        detail="A plan names who it feeds, where, and what goes in each bowl or bunk. Today's feedings and the shed's run-out dates follow from it."
        action={
          <Button variant="primary" onClick={onAdd}>
            Add feeding plan
          </Button>
        }
      />
    );
  }

  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  const feeding = plans.filter((plan) => plan.active).length;
  const bySpecies = ORDER.map((species) => ({
    species,
    plans: plans
      .filter((plan) => plan.species === species)
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) || left.name.localeCompare(right.name),
      ),
  })).filter((group) => group.plans.length > 0);

  return (
    <div className="flex flex-col gap-density">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {line(
            `${plans.length} plan${plans.length === 1 ? "" : "s"}`,
            `${feeding} feeding`,
            plans.length > feeding && `${plans.length - feeding} off`,
          )}
        </p>
        <span className="hidden sm:block">
          <Button variant="primary" aria-haspopup="dialog" onClick={onAdd}>
            <PlusIcon />
            Add feeding plan
          </Button>
        </span>
      </div>

      {bySpecies.map((group) => (
        <section
          key={group.species}
          aria-label={`${SPECIES_LABELS[group.species]} plans`}
          className="flex flex-col gap-2"
        >
          <h2 className="gf-label">{SPECIES_LABELS[group.species]}</h2>
          {group.plans.map((plan) => {
            const where = placeLabel(plan, zones);
            const together = isTotal(plan) && animalsOf(plan).length + flocksOf(plan).length > 1;
            return (
              <article
                key={plan.id}
                aria-label={plan.name}
                className="overflow-hidden rounded-density border border-rule bg-panel"
              >
                <div className="flex items-center gap-3 bg-canvas py-2 pl-4 pr-2">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{plan.name}</span>
                      {plan.active ? null : <Pill tone="neutral">Off</Pill>}
                      {together ? <Pill tone="action">Together</Pill> : null}
                    </span>
                    <span className="text-sm text-muted">
                      {line(membersLabel(plan, animals, flocks), where && `at ${where}`)}
                    </span>
                    {plan.specialNotes === undefined ? null : (
                      <span className="text-sm text-muted">{plan.specialNotes}</span>
                    )}
                  </span>
                  <Button
                    aria-haspopup="dialog"
                    aria-label={`Adjust ${plan.name}`}
                    onClick={() => onAdjust(plan)}
                  >
                    Adjust
                  </Button>
                </div>
                <ul
                  aria-label={`${plan.name} feeds`}
                  className="divide-y divide-rule border-t border-rule"
                >
                  {plan.lines.map((entry, index) => (
                    <li
                      key={`${entry.feedTypeId}-${entry.timeOfDay}-${index}`}
                      className="flex min-h-target flex-wrap items-center justify-between gap-x-3 px-4 py-2"
                    >
                      <span className="min-w-0 text-ink">
                        {feedById.get(entry.feedTypeId as Ulid)?.name ?? "feed"}
                        <span className="text-sm text-muted">
                          {receptacleWords(entry.receptacle)}
                          {entry.notes === undefined ? "" : ` — ${entry.notes}`}
                        </span>
                      </span>
                      <span className="text-sm">
                        <span className="gf-numeric font-semibold text-ink">
                          {amountWords(entry.amount.amount, entry.amount.unit)}
                          {together
                            ? ""
                            : animalsOf(plan).length + flocksOf(plan).length > 1
                              ? " each"
                              : ""}
                        </span>
                        <span className="text-muted">
                          {" · "}
                          {line(FREQUENCY[entry.frequency] ?? entry.frequency, entry.timeOfDay)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
