"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button, Checkbox, Select, TextInput, useToast, toOptions } from "@galaxy-farm/ui";
import { animalSchema, displayName, type Animal, type SafetyLevel } from "@galaxy-farm/core";
import {
  CALF_VIGOUR,
  CALVING_EASE,
  describeGestation,
  serviceFor,
  suggestedCalfTag,
  type BreedingRecord,
  type CalfVigour,
  type CalvingEase,
  type CalvingRecord,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { useRecordCalving, type CalvingOutcome } from "@/lib/calving-flow";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { atNoon, DetailsForm, todayValue, whoLine, type DetailsProps } from "./log-parts";

/**
 * A calving, for one cow (spec §5.2, issue #13).
 *
 * Every write goes through `useRecordCalving` — the flow the calving screen
 * uses, which creates the calf, wires its pedigree to the dam and the service
 * sire, files the birth weight and announces `CalvingRecorded`. This form only
 * gathers the same fields; nothing here decides anything the flow does not.
 *
 * Afterwards, step 4 carries the one follow-up §5.1 asks somebody to decide:
 * the dam's suggested safety level with a calf at side.
 */

const EASE_LABELS: Readonly<Record<CalvingEase, string>> = {
  1: "1 — unassisted",
  2: "2 — easy pull",
  3: "3 — hard pull",
  4: "4 — malpresentation",
  5: "5 — caesarean",
};

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function CalvingDetails({ propertyId, actorId, animals, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records: everyone } = useRecords<Animal>("animals", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const record = useRecordCalving(propertyId, actorId);
  const animalsApi = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const { show } = useToast();

  // Step 2 allows one cow for a calving; the flow never hands this more.
  const dam = animals[0];
  // Memoised so the tag suggestion below does not re-run on every keystroke.
  const tagsInUse = useMemo(() => everyone.map((animal) => animal.tagNumber), [everyone]);

  const [date, setDate] = useState(todayValue);
  const [ease, setEase] = useState<CalvingEase>(1);
  const [vigour, setVigour] = useState<CalfVigour>("vigorous");
  const [calfSex, setCalfSex] = useState<"male" | "female" | "unknown">("unknown");
  const [birthWeight, setBirthWeight] = useState("");
  const [assisted, setAssisted] = useState(false);
  const [assistDetail, setAssistDetail] = useState("");
  const [notes, setNotes] = useState("");
  const [tagTouched, setTagTouched] = useState(false);
  const [calfTag, setCalfTag] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const service =
    dam === undefined ? undefined : serviceFor(breedings, dam.id, atNoon(date), calvings);

  // Prefilled, not imposed — the same rule as the calving screen: the tag
  // follows the date until somebody types in it.
  useEffect(() => {
    if (tagTouched) return;
    setCalfTag(suggestedCalfTag(tagsInUse, atNoon(date)));
  }, [tagsInUse, date, tagTouched]);

  async function submit() {
    setError(undefined);
    if (dam === undefined) {
      setError("Choose the cow that calved");
      return;
    }
    const liveCalf = vigour !== "stillborn";
    if (liveCalf && calfTag.trim() === "") {
      setError("Give the calf a tag — an animal with no tag and no name cannot be found later");
      return;
    }
    if (assisted && ease === 1) {
      setError("An assisted calving cannot be ease 1");
      return;
    }

    setBusy(true);
    try {
      const result = await record(
        {
          damId: dam.id,
          date: atNoon(date),
          calvingEase: ease,
          vigour,
          ...(liveCalf ? { calfSex } : {}),
          ...(birthWeight === "" ? {} : { birthWeightLb: Number(birthWeight) }),
          assisted,
          ...(assistDetail.trim() === "" ? {} : { assistDetail: assistDetail.trim() }),
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
          calfTag: calfTag.trim(),
        },
        { dam, breedings, calvings },
      );

      if (!result.ok) {
        setError(result.message);
        return;
      }

      onSaved({
        headline: "Saved for 1 animal",
        detail: result.message,
        followUp: (
          <AfterCalving
            outcome={result}
            dam={dam}
            onDamLevel={async (level) => {
              await animalsApi.update(dam.id, {
                safetyLevel: level,
                safetyNotes: `Calf at side since ${formatDate(new Date())} — protective. Clear this when the calf is weaned.`,
              } as Partial<Animal>);
              show({ message: `${displayName(dam)} raised to level ${level}` });
            }}
          />
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Calving"
      who={whoLine(animals)}
      onSubmit={() => void submit()}
      submitLabel="Save calving"
      busy={busy}
      error={error}
    >
      {/* Where the calf's sire will come from, said before it is saved. */}
      {dam === undefined ? null : (
        <p className="-mt-2 text-sm text-muted">
          {service === undefined
            ? "No service on file — the sire stays blank, not guessed."
            : `Sire from the ${service.method} service on ${formatDate(service.date)}. ` +
              describeGestation(service, atNoon(date))}
        </p>
      )}
      <TextInput
        label="Date calved"
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        required
      />
      <div className="grid grid-cols-2 gap-density">
        <Select
          label="Calving ease"
          value={String(ease)}
          onChange={(event) => setEase(Number(event.target.value) as CalvingEase)}
          options={CALVING_EASE.map((value) => ({
            value: String(value),
            label: EASE_LABELS[value],
          }))}
        />
        <Select
          label="Vigour"
          value={vigour}
          onChange={(event) => setVigour(event.target.value as CalfVigour)}
          options={toOptions(CALF_VIGOUR)}
        />
        {vigour === "stillborn" ? null : (
          <>
            <Select
              label="Calf sex"
              value={calfSex}
              onChange={(event) => setCalfSex(event.target.value as "male" | "female" | "unknown")}
              options={[
                { value: "unknown", label: "unknown" },
                { value: "female", label: "heifer" },
                { value: "male", label: "bull" },
              ]}
            />
            <TextInput
              label="Calf tag"
              value={calfTag}
              onChange={(event) => {
                setTagTouched(true);
                setCalfTag(event.target.value);
              }}
              required
            />
          </>
        )}
        <TextInput
          label="Birth weight (lb)"
          type="number"
          inputMode="decimal"
          numeric
          value={birthWeight}
          onChange={(event) => setBirthWeight(event.target.value)}
        />
        <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <Checkbox
        label="Assisted"
        checked={assisted}
        onChange={(event) => setAssisted(event.target.checked)}
      />
      {assisted ? (
        <TextInput
          label="What was done"
          value={assistDetail}
          onChange={(event) => setAssistDetail(event.target.value)}
        />
      ) : null}
    </DetailsForm>
  );
}

/**
 * The dam's suggested level after calving (§5.1) — suggested, never applied,
 * for the reason the calving screen gives: a badge that changes without
 * anybody deciding is a badge people stop believing.
 */
function AfterCalving({
  outcome,
  dam,
  onDamLevel,
}: {
  readonly outcome: CalvingOutcome;
  readonly dam: Animal;
  readonly onDamLevel: (level: SafetyLevel) => Promise<void>;
}) {
  const [done, setDone] = useState(false);
  const suggested = outcome.suggestedDamLevel;

  return (
    <div className="flex w-full flex-col gap-3 text-left">
      {outcome.calf === undefined ? null : (
        <Link
          href={animalHref(outcome.calf)}
          className="inline-flex min-h-target items-center justify-center font-medium text-action underline-offset-2 hover:underline"
        >
          Open {displayName(outcome.calf)}
        </Link>
      )}
      {suggested === undefined || suggested <= dam.safetyLevel || done ? null : (
        <div className="flex flex-col gap-3 rounded-density bg-raised p-density">
          <p className="text-sm text-ink">
            {displayName(dam)} is at level {dam.safetyLevel}. With a calf at side, §5.1 suggests
            level {suggested} until weaning.
          </p>
          <span className="flex flex-wrap gap-2">
            <Button onClick={() => void onDamLevel(suggested).then(() => setDone(true))}>
              Raise her to level {suggested}
            </Button>
            <Button variant="ghost" onClick={() => setDone(true)}>
              Leave her at {dam.safetyLevel}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
