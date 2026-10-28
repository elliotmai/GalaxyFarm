"use client";

import { useState } from "react";

import { Select, TextInput, useToast, toOptions } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  startOfDay,
  taskSchema,
  type ChoreEntry,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import {
  CONSUMPTION_KINDS,
  feedConsumptionSchema,
  type ConsumptionKind,
  type FeedConsumption,
  type FeedType,
} from "@galaxy-farm/module-feed";

import { toggleChore } from "@/lib/chores";
import { feedingChoreText, feedingChoresFor } from "@/lib/feeding-chores";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { atNoon, DetailsForm, errorText, todayValue, type DetailsProps } from "./log-parts";

/**
 * Feeding: tick a trip off, or log an amount the plans do not know about.
 *
 * The ticks are the same feeding trips the Today list and the barn kiosk show
 * — derived from the plans by `feedingChoresFor`, merged by `choreDaySheet`
 * and ticked by `toggleChore` — so a feeding ticked here is ticked there.
 * They save on the tap, as they do everywhere else.
 *
 * Ordinary feeding is never logged as an amount (§5.3: demand is derived from
 * the plans). What is logged is what the plans do not know — an extra bale in
 * a cold snap, a torn bag — written as the feed screen's `feedConsumption`.
 */

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function FeedingDetails({ propertyId, actorId, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const tasksApi = useMutations<Task>("tasks", "tasks", taskSchema, propertyId, actorId);
  const usedApi = useMutations<FeedConsumption>(
    "feedConsumption",
    "feedConsumption",
    feedConsumptionSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const now = new Date();
  const today = startOfDay(now);
  const derived = feedingChoresFor(
    plans,
    feedingChoreText({ zones, feeds, propertyId }),
    today,
    now,
  );
  // Only the feeding half of the day sheet: derived trips, and the rows
  // ticked ones became (matched back by `sourceKey`).
  const sheet = choreDaySheet(
    {
      tasks: tasks.filter((task) => task.sourceKey !== undefined && task.templateId === undefined),
      templates: [],
      derived,
    },
    today,
    now,
  );

  const [ticking, setTicking] = useState<string | undefined>();
  const [feedTypeId, setFeedTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [kind, setKind] = useState<ConsumptionKind>("extra");
  const [usedOn, setUsedOn] = useState(todayValue);
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function tick(entry: ChoreEntry) {
    setTicking(entry.id);
    try {
      const result = await toggleChore(tasksApi, {
        entry,
        date: today,
        at: new Date(),
        actorId,
      });
      if (!result.ok) show({ message: "Could not tick that off", tone: "danger" });
    } finally {
      setTicking(undefined);
    }
  }

  async function submit() {
    setError(undefined);
    if (feedTypeId === "") {
      setError("Choose the feed");
      return;
    }

    setBusy(true);
    try {
      const result = await usedApi.create({
        feedTypeId: feedTypeId as Ulid,
        quantity: Number(quantity),
        kind,
        usedOn: atNoon(usedOn),
        zoneId: zoneId === "" ? undefined : (zoneId as Ulid),
      } as never);
      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }
      const feed = feeds.find((entry) => entry.id === feedTypeId);
      onSaved({
        headline: kind === "correction" ? "Count saved" : "Feed logged",
        detail:
          kind === "correction"
            ? "The run-out projection restarts from today."
            : `${quantity} of ${feed?.name ?? "that feed"} off the barn.`,
      });
    } finally {
      setBusy(false);
    }
  }

  const done = sheet.filter((entry) => entry.completedAt !== undefined).length;

  return (
    <DetailsForm
      title="Feeding"
      onSubmit={() => void submit()}
      submitLabel={kind === "correction" ? "Save count" : "Log feed"}
      busy={busy}
      error={error}
    >
      <section aria-labelledby="log-feedings" className="flex flex-col gap-2">
        <h2 id="log-feedings" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Today{sheet.length === 0 ? "" : ` · ${done} of ${sheet.length}`}
        </h2>
        {sheet.length === 0 ? (
          <p className="text-sm text-muted">No feedings planned today.</p>
        ) : (
          <ul className="divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
            {sheet.map((entry) => {
              const ticked = entry.completedAt !== undefined;
              return (
                <li key={entry.id}>
                  <label className="flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2 hover:bg-canvas">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ticked}
                      disabled={ticking === entry.id}
                      onChange={() => void tick(entry)}
                    />
                    <span
                      aria-hidden
                      className={[
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                        "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action",
                        ticked ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
                      ].join(" ")}
                    >
                      {ticked ? <Tick /> : null}
                    </span>
                    <span
                      className={[
                        "min-w-0 flex-1 text-density",
                        ticked ? "text-muted line-through" : "text-ink",
                      ].join(" ")}
                    >
                      {entry.title}
                    </span>
                    <span className="shrink-0 text-sm text-muted [font-variant-numeric:tabular-nums]">
                      {timeOf(entry.dueAt)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="log-extra" className="flex flex-col gap-density">
        <h2 id="log-extra" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Extra or a count
        </h2>
        <Select
          label="Feed"
          value={feedTypeId}
          placeholder="Choose a feed"
          options={feeds.map((feed) => ({ value: feed.id, label: feed.name }))}
          onChange={(event) => setFeedTypeId(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-density">
          <Select
            label="Kind"
            value={kind}
            options={toOptions(CONSUMPTION_KINDS)}
            onChange={(event) => setKind(event.target.value as ConsumptionKind)}
          />
          <TextInput
            label={kind === "correction" ? "On hand" : "Quantity"}
            type="number"
            inputMode="decimal"
            numeric
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        {/* The one easy mistake here, as on the feed screen. */}
        {kind === "correction" ? (
          <p className="-mt-2 text-sm text-muted">A count of the barn; the projection restarts.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-density">
          <TextInput
            label="When"
            type="date"
            value={usedOn}
            onChange={(event) => setUsedOn(event.target.value)}
          />
          <Select
            label="Pen"
            value={zoneId}
            options={[
              { value: "", label: "Not against a pen" },
              ...zones
                .filter((zone) => zone.active)
                .map((zone) => ({ value: zone.id, label: zone.name })),
            ]}
            onChange={(event) => setZoneId(event.target.value)}
          />
        </div>
      </section>
    </DetailsForm>
  );
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12l5 5 9-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
