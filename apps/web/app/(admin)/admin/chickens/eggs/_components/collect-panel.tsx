"use client";

import { useState } from "react";

import { Button, Select, TextArea, TextInput, useToast } from "@galaxy-farm/ui";
import { type CrudError, type Ulid } from "@galaxy-farm/core";
import {
  eggLogSchema,
  type EggBreakdown,
  type EggLog,
  type Flock,
} from "@galaxy-farm/module-poultry";

import {
  BreakdownEditor,
  breakdownSum,
} from "@/app/(admin)/admin/chickens/eggs/_components/breakdown-editor";
import { useMutations } from "@/lib/local/mutations";

/**
 * Collecting (spec §5.4, §8).
 *
 * §5.4 describes the kiosk form of this as "tap +1 buttons at the coop", and
 * §8 makes it a rule: every frequent action reachable in two taps with smart
 * defaults. So the date is already today, the flock is already the only one
 * there is, and the buttons add rather than asking anybody to type a number
 * while holding a bucket.
 *
 * The same form is here on the admin screen rather than only on the kiosk
 * because the kiosk is a device in the barn and the phone in a pocket is not
 * one — and both are used to log the same basket.
 */

const STEPS = [1, 2, 6, 12] as const;

function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CollectPanel({
  flocks,
  logs,
  propertyId,
  actorId,
}: {
  readonly flocks: readonly Flock[];
  readonly logs: readonly EggLog[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<EggLog>("eggLogs", "eggLogs", eggLogSchema, propertyId, actorId);
  const { show } = useToast();

  const live = flocks.filter((flock) => flock.active);

  const [flockId, setFlockId] = useState<string>("");
  const [collectedOn, setCollectedOn] = useState(todayValue);
  const [tally, setTally] = useState(0);
  const [rows, setRows] = useState<readonly EggBreakdown[]>([]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  /**
   * Which flock this basket came from.
   *
   * The flocks arrive from a live query, so the first render has none of them.
   * With one flock there is no question to ask and the select answers itself;
   * with several, the last one used stays chosen between baskets.
   */
  const chosen = live.some((flock) => flock.id === flockId)
    ? flockId
    : live.length === 1
      ? (live[0]?.id ?? "")
      : flockId;

  const chosenFlock = live.find((flock) => flock.id === chosen);

  // Once a breakdown exists it *is* the total. The schema refuses a breakdown
  // that does not add up, and the surest way nobody meets that error is to
  // stop asking for the same number twice.
  const total = rows.length === 0 ? tally : breakdownSum(rows);

  const alreadyToday = logs
    .filter(
      (log) =>
        log.collectedOn.toISOString().slice(0, 10) === collectedOn &&
        (chosen === "" || log.flockId === chosen),
    )
    .reduce((sum, log) => sum + log.total, 0);

  function startOver() {
    setTally(0);
    setRows([]);
    setNotes("");
    setErrors({});
  }

  async function log(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setBusy(true);

    try {
      const result = await mutations.create({
        flockId: chosen === "" ? undefined : (chosen as Ulid),
        // The coop comes off the flock rather than being asked for twice. A
        // log keeps the zone it was collected at even if the flock moves later.
        zoneId: chosenFlock?.zoneId,
        collectedOn: new Date(`${collectedOn}T12:00:00`),
        total,
        breakdown: [...rows],
        notes: notes.trim() === "" ? undefined : notes.trim(),
      } as never);

      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      // No undo on this toast, deliberately. Undoing a create means deleting
      // the record, and §4.5 clause 3 does not have an exception for a delete
      // somebody meant — it is one tap away on the Log tab, with a dialog.
      show({
        message: `${total} egg${total === 1 ? "" : "s"} logged${chosenFlock === undefined ? "" : ` — ${chosenFlock.name}`}`,
        tone: "success",
      });
      startOver();
      // The date stays. Entering yesterday's basket is usually followed by
      // entering yesterday's second basket.
    } finally {
      setBusy(false);
    }
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { total: "Could not save that. Check the fields and try again." },
    );
  }

  return (
    <div className="flex flex-col gap-density">
      {flocks.length === 0 ? (
        // One quiet line rather than a callout: logging works without a
        // flock, and a flock is only what turns these into eggs per bird.
        <p className="text-sm text-muted">No flocks yet — a total is all this needs.</p>
      ) : null}

      {/*
        Tap it in. The date is already today and the count is already zero,
        which is the whole of the fast path §8 asks for.
      */}
      <form
        onSubmit={(event) => void log(event)}
        aria-label="This basket"
        className="flex flex-col gap-density rounded-density border border-rule bg-panel p-density"
      >
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
          {live.length <= 1 ? null : (
            <Select
              label="Flock"
              value={chosen}
              placeholder="Whole place"
              options={[
                { value: "", label: "Whole place" },
                ...live.map((flock) => ({ value: flock.id, label: flock.name })),
              ]}
              error={errors["flockId"]}
              onChange={(event) => setFlockId(event.target.value)}
            />
          )}
          <TextInput
            label="Collected"
            type="date"
            required
            value={collectedOn}
            error={errors["collectedOn"]}
            onChange={(event) => setCollectedOn(event.target.value)}
          />
          <TextInput
            label="Total"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            numeric
            disabled={rows.length > 0}
            hint={rows.length > 0 ? "Counted from the breakdown." : undefined}
            value={String(total)}
            error={errors["total"]}
            onChange={(event) => setTally(Math.max(0, Math.trunc(Number(event.target.value))))}
          />
        </div>

        {rows.length > 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {STEPS.map((step) => (
              <Button
                key={step}
                variant="primary"
                onClick={() => setTally(tally + step)}
                aria-label={`Add ${step}`}
              >
                +{step}
              </Button>
            ))}
            <Button
              onClick={() => setTally(Math.max(0, tally - 1))}
              disabled={tally === 0}
              aria-label="Take one off"
            >
              −1
            </Button>
            <Button variant="ghost" onClick={startOver} disabled={tally === 0}>
              Start over
            </Button>
          </div>
        )}

        {/*
          The breakdown and the note, folded. §5.4 makes the breakdown optional
          and §8 says logging must be fast, so whoever is carrying a bucket in
          from the rain never has to scroll past them. Open whenever there is
          something in them, so nothing typed is ever hidden.
        */}
        <details
          className="rounded-density border border-rule"
          open={rows.length > 0 || notes !== "" ? true : undefined}
        >
          <summary className="flex min-h-target cursor-pointer items-center px-3 text-sm font-medium text-ink">
            Breakdown and note
            {rows.length === 0 ? "" : ` · ${rows.length} row${rows.length === 1 ? "" : "s"}`}
          </summary>
          <div className="flex flex-col gap-density border-t border-rule p-density">
            <BreakdownEditor rows={rows} onChange={setRows} error={errors["breakdown"]} />
            <TextArea
              label="Note"
              rows={2}
              hint="A cracked one, a nest found under the barn."
              value={notes}
              error={errors["notes"]}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy} disabled={total === 0}>
            Log {total} egg{total === 1 ? "" : "s"}
          </Button>
          {/* Adds rather than replaces — said, so a second basket is not
              mistaken for a correction of the first. */}
          {alreadyToday === 0 ? null : (
            <span className="text-sm text-muted">
              {alreadyToday} already logged that day
              {chosenFlock === undefined ? "" : ` from ${chosenFlock.name}`}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
