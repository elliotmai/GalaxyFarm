"use client";

import { useState } from "react";

import { Button, Select, TextArea, TextInput } from "@galaxy-farm/ui";
import { type Ulid } from "@galaxy-farm/core";
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
import { useRecords } from "@/lib/local/use-records";

import { atNoon, DetailsForm, errorText, todayValue, type DetailsProps } from "./log-parts";

/**
 * Today's basket (spec §5.4, §8).
 *
 * The collect panel's fields and write — `eggLogs` through `eggLogSchema`,
 * the coop taken off the flock — laid out for a phone held in one hand: the
 * date is already today, the only flock is already chosen, and the count is
 * tapped in rather than typed.
 */

const STEPS = [1, 6, 12] as const;

export function EggsDetails({ propertyId, actorId, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records: flocks } = useRecords<Flock>("flocks", query);
  const { records: logs } = useRecords<EggLog>("eggLogs", query);
  const mutations = useMutations<EggLog>("eggLogs", "eggLogs", eggLogSchema, propertyId, actorId);

  const live = flocks.filter((flock) => flock.active);

  const [flockId, setFlockId] = useState("");
  const [collectedOn, setCollectedOn] = useState(todayValue);
  const [tally, setTally] = useState(0);
  const [rows, setRows] = useState<readonly EggBreakdown[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // With one flock there is no question to ask, as on the collect panel.
  const chosen = live.some((flock) => flock.id === flockId)
    ? flockId
    : live.length === 1
      ? (live[0]?.id ?? "")
      : flockId;
  const chosenFlock = live.find((flock) => flock.id === chosen);

  // Once a breakdown exists it *is* the total — never asked for twice.
  const total = rows.length === 0 ? tally : breakdownSum(rows);

  const alreadyThatDay = logs
    .filter(
      (log) =>
        log.collectedOn.toISOString().slice(0, 10) === collectedOn &&
        (chosen === "" || log.flockId === chosen),
    )
    .reduce((sum, log) => sum + log.total, 0);

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      const result = await mutations.create({
        flockId: chosen === "" ? undefined : (chosen as Ulid),
        zoneId: chosenFlock?.zoneId,
        collectedOn: atNoon(collectedOn),
        total,
        breakdown: [...rows],
        notes: notes.trim() === "" ? undefined : notes.trim(),
      } as never);

      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }

      onSaved({
        headline: `${total} egg${total === 1 ? "" : "s"} saved`,
        detail: `${chosenFlock === undefined ? "Whole place" : chosenFlock.name} · ${alreadyThatDay + total} that day.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Eggs"
      onSubmit={() => void submit()}
      submitLabel={`Save ${total} egg${total === 1 ? "" : "s"}`}
      submitDisabled={total === 0}
      busy={busy}
      error={error}
    >
      <div className="grid grid-cols-2 gap-density">
        {live.length <= 1 ? null : (
          <Select
            label="Flock"
            value={chosen}
            options={[
              { value: "", label: "Whole place" },
              ...live.map((flock) => ({ value: flock.id, label: flock.name })),
            ]}
            onChange={(event) => setFlockId(event.target.value)}
          />
        )}
        <TextInput
          label="Collected"
          type="date"
          required
          value={collectedOn}
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
          value={String(total)}
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
        </div>
      )}

      {alreadyThatDay === 0 ? null : (
        <p className="text-sm text-muted">
          {alreadyThatDay} already logged that day — this adds to it.
        </p>
      )}

      <details
        className="rounded-density border border-rule bg-panel"
        open={rows.length > 0 || notes !== "" ? true : undefined}
      >
        <summary className="flex min-h-target cursor-pointer items-center px-3 text-sm font-medium text-ink">
          Breakdown and note
        </summary>
        <div className="flex flex-col gap-density border-t border-rule p-density">
          <BreakdownEditor rows={rows} onChange={setRows} />
          <TextArea
            label="Note"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </details>
    </DetailsForm>
  );
}
