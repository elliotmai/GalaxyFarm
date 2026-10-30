"use client";

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
 * Who gets what (Farm › Feed › Plan), listed by ration.
 *
 * One card a ration: what goes in the bucket first, and who it goes to as the
 * detail underneath — the animals it names, the pen and its head count, or
 * everybody. The list used to read as one card per animal, because a ration
 * written separately for three calves was three cards saying the same thing
 * under three names; the owner asked for the ration once.
 *
 * So identical rations are folded together. Two plans are the same ration when
 * they feed the same feeds, in the same amounts, at the same times, read the
 * same way (per head or shared), and are both on or both off. A folded card
 * lists everybody it feeds, and offers each plan behind it to adjust, because
 * they are still separate records and changing one must not silently change
 * the others. The cure for that is in the editor: one plan can feed several
 * animals (`alsoFeeds`), so the next one is written once.
 */

const FREQUENCY: Readonly<Record<string, string>> = {
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  every_other_day: "every other day",
  weekly: "weekly",
};

/** The part of a plan that makes it the same ration as another. */
export function rationKey(plan: FeedingPlan): string {
  const lines = plan.lines
    .map((entry) =>
      [
        entry.feedTypeId,
        entry.amount.amount,
        entry.amount.unit,
        entry.frequency,
        entry.timeOfDay,
      ].join("|"),
    )
    .sort();
  return [plan.active ? "on" : "off", isShared(plan) ? "shared" : "each", ...lines].join("/");
}

export interface RationGroup {
  readonly key: string;
  /** Every plan written with this ration, in name order. */
  readonly plans: readonly FeedingPlan[];
}

/**
 * Fold plans into rations, feeding first and then by name.
 *
 * One pass with a map, so a place with a ration per animal is linear in the
 * plans rather than comparing each with every other.
 */
export function groupRations(plans: readonly FeedingPlan[]): RationGroup[] {
  const groups = new Map<string, FeedingPlan[]>();
  for (const plan of plans) {
    const key = rationKey(plan);
    const held = groups.get(key);
    if (held === undefined) groups.set(key, [plan]);
    else held.push(plan);
  }

  return [...groups]
    .map(([key, held]) => ({
      key,
      plans: [...held].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => {
      const a = left.plans[0] as FeedingPlan;
      const b = right.plans[0] as FeedingPlan;
      return Number(b.active) - Number(a.active) || a.name.localeCompare(b.name);
    });
}

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
  // Head counts per pen, counted once rather than once per pen plan.
  const headByZone = new Map<Ulid, number>();
  for (const scope of scopes) {
    for (const zoneId of scope.zoneIds) headByZone.set(zoneId, (headByZone.get(zoneId) ?? 0) + 1);
  }

  /** Who one plan feeds, as the card's detail says it. */
  function who(plan: FeedingPlan): string {
    if (plan.target === "animal") {
      return animalsFedBy(plan)
        .map((id) => {
          const animal = animalById.get(id);
          return animal === undefined ? "an animal" : displayName(animal);
        })
        .join(", ");
    }
    if (plan.target === "zone") {
      return line(
        zoneById.get(plan.targetId)?.name ?? "a pen",
        `${headByZone.get(plan.targetId) ?? 0} head`,
      );
    }
    return "Everybody";
  }

  /** The card's title: the plans' shared name, else what is in the ration. */
  function title(group: RationGroup): string {
    const names = new Set(group.plans.map((plan) => plan.name.trim()));
    const first = group.plans[0] as FeedingPlan;
    if (names.size === 1) return first.name;
    const fed = [
      ...new Set(
        first.lines.map((entry) => feedById.get(entry.feedTypeId as Ulid)?.name ?? "feed"),
      ),
    ];
    return fed.join(" and ");
  }

  const groups = groupRations(plans);
  const feeding = plans.filter((plan) => plan.active).length;

  return (
    <div className="flex flex-col gap-density">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {line(
            `${groups.length} ration${groups.length === 1 ? "" : "s"}`,
            `${feeding} feeding`,
            plans.length > feeding && `${plans.length - feeding} off`,
          )}
        </p>
        <span className="hidden sm:block">
          <Button variant="primary" aria-haspopup="dialog" onClick={onAdd}>
            <span aria-hidden="true">+</span> Add plan
          </Button>
        </span>
      </div>

      {groups.map((group) => {
        const first = group.plans[0] as FeedingPlan;
        const name = title(group);
        const single = group.plans.length === 1;
        const notes = [
          ...new Set(group.plans.map((plan) => plan.specialNotes?.trim() ?? "")),
        ].filter((note) => note !== "");
        return (
          <section
            key={group.key}
            aria-label={name}
            className="overflow-hidden rounded-density border border-rule bg-panel"
          >
            <div className="flex min-h-[60px] items-center gap-3 bg-canvas py-2 pl-4 pr-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{name}</span>
                  {first.active ? null : <Pill tone="neutral">Off</Pill>}
                  {isShared(first) ? <Pill tone="neutral">shared</Pill> : null}
                </span>
                {/* Who it feeds, as the detail. A plan per line of it when the
                    ration was written more than once. */}
                <span className="text-sm text-muted">
                  {group.plans.map((plan) => who(plan)).join(" · ")}
                </span>
                {notes.length === 0 ? null : (
                  <span className="text-sm text-muted">{notes.join(" · ")}</span>
                )}
              </span>
              {single ? (
                <Button
                  aria-haspopup="dialog"
                  aria-label={`Adjust ${first.name}`}
                  onClick={() => onAdjust(first)}
                >
                  Adjust
                </Button>
              ) : null}
            </div>
            <ul aria-label={`${name} ration`} className="divide-y divide-rule border-t border-rule">
              {first.lines.map((entry, index) => (
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
            {single ? null : (
              // Still separate records: each is adjusted on its own, and the
              // editor can fold them into one by naming the others.
              <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-2">
                <span className="text-sm text-muted">
                  Written as {group.plans.length} plans. Adjust
                </span>
                {group.plans.map((plan) => (
                  <Button
                    key={plan.id}
                    variant="ghost"
                    aria-haspopup="dialog"
                    aria-label={`Adjust ${plan.name} (${who(plan)})`}
                    onClick={() => onAdjust(plan)}
                  >
                    {who(plan)}
                  </Button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
