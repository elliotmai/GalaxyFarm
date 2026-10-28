"use client";

import { useState } from "react";

import { Select, TextInput } from "@galaxy-farm/ui";
import { displayName } from "@galaxy-farm/core";
import {
  weightRecordSchema,
  WEIGHT_CONTEXTS,
  type WeightContext,
  type WeightRecord,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";

import {
  atNoon,
  DetailsForm,
  errorText,
  forCount,
  todayValue,
  whoLine,
  type DetailsProps,
} from "./log-parts";

/**
 * Weights, one or a run of them (spec §5.2, issue #20).
 *
 * Weighing goes down a line of calves in a chute, so a run is one form with a
 * weight field per animal and the date and context shared. Each animal gets
 * its own `WeightRecord`, written through the weights screen's path and
 * schema. An animal left blank is skipped rather than weighed at nothing —
 * the one that would not go on the scale.
 */

export function WeightDetails({ propertyId, actorId, animals, onSaved }: DetailsProps) {
  const api = useMutations<WeightRecord>(
    "weightRecords",
    "weightRecords",
    weightRecordSchema,
    propertyId,
    actorId,
  );

  const [weights, setWeights] = useState<Readonly<Record<string, string>>>({});
  const [context, setContext] = useState<WeightContext>("other");
  const [date, setDate] = useState(todayValue);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const weighed = animals.filter((animal) => (weights[animal.id] ?? "").trim() !== "");

  async function submit() {
    setError(undefined);
    if (weighed.length === 0) {
      setError(animals.length === 1 ? "Enter the weight" : "Enter at least one weight");
      return;
    }

    setBusy(true);
    try {
      let saved = 0;
      for (const animal of weighed) {
        const result = await api.create({
          animalId: animal.id,
          date: atNoon(date),
          weightLb: Number(weights[animal.id]),
          context,
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
        } as never);

        if (!result.ok) {
          setError(
            `${displayName(animal)}: ${errorText(result.error)}${saved === 0 ? "" : ` (saved for ${forCount(saved)} before this)`}`,
          );
          // Keep what was not saved yet on screen to correct; drop the rest.
          setWeights((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) =>
                weighed.slice(saved).some((left) => left.id === id),
              ),
            ),
          );
          return;
        }
        saved += 1;
      }

      const skipped = animals.length - weighed.length;
      onSaved({
        headline: `Saved for ${forCount(saved)}`,
        detail:
          skipped === 0 ? "On each animal's history." : `${forCount(skipped)} left unweighed.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Weight"
      who={whoLine(animals)}
      onSubmit={() => void submit()}
      submitLabel={`Save for ${forCount(weighed.length === 0 ? animals.length : weighed.length)}`}
      busy={busy}
      error={error}
    >
      <div className="grid grid-cols-2 gap-density">
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <Select
          label="Context"
          value={context}
          onChange={(event) => setContext(event.target.value as WeightContext)}
          options={WEIGHT_CONTEXTS.map((value) => ({ value, label: value }))}
        />
      </div>

      {/* One field per animal, in the order they come up the chute. */}
      <ul
        aria-label="Weights"
        className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
      >
        {animals.map((animal) => (
          <li key={animal.id} className="flex items-center gap-3 px-3.5 py-2">
            <span className="min-w-0 flex-1 truncate font-medium text-ink">
              {displayName(animal)}
            </span>
            <span className="w-32 shrink-0">
              <TextInput
                label={`Weight of ${displayName(animal)} (lb)`}
                hideLabel
                placeholder="lb"
                type="number"
                inputMode="decimal"
                numeric
                value={weights[animal.id] ?? ""}
                onChange={(event) =>
                  setWeights((current) => ({ ...current, [animal.id]: event.target.value }))
                }
              />
            </span>
          </li>
        ))}
      </ul>

      <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
    </DetailsForm>
  );
}
