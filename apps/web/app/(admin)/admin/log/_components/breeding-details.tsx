"use client";

import { useMemo, useState } from "react";

import { SearchSelect, Select, TextInput } from "@galaxy-farm/ui";
import { type Animal } from "@galaxy-farm/core";
import {
  BREEDING_METHODS,
  breedingRecordSchema,
  DEFAULT_GESTATION_DAYS,
  drawStraw,
  HEAT_INTENSITIES,
  heatRecordSchema,
  inferAncestorSexes,
  projectedDueDate,
  semenInventorySchema,
  type BreedingMethod,
  type BreedingRecord,
  type CattleProfile,
  type ExternalAnimal,
  type HeatIntensity,
  type HeatRecord,
  type SemenInventory,
} from "@galaxy-farm/module-cattle";

import { fromDateInput, todayInput } from "@/lib/date-input";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";
import { breedingSire, bullOptions, parseSire, strawOptions, type SireLookup } from "@/lib/sires";

import {
  DetailsForm,
  errorText,
  forCount,
  KindSwitch,
  whoLine,
  type DetailsProps,
} from "./log-parts";

/**
 * Heats and services — one tile, because they are one trip to the cow.
 *
 * A breeding goes through the breeding screen's path: the same schema, the
 * same sire list out of `lib/sires` (a straw, a bull, an ancestor, or a name
 * typed in), and the same straw drawn off the tank for AI. A heat writes a
 * `HeatRecord` through the standard mutation path with its module schema.
 *
 * Several cows are one record each — a bull turned in with a group, or a
 * morning's heats seen across a pen.
 */

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const SWITCH = [
  { kind: "heat", label: "Heat" },
  { kind: "breeding", label: "Breeding" },
] as const;

export function BreedingDetails(props: DetailsProps) {
  return props.kind === "heat" ? <HeatForm {...props} /> : <ServiceForm {...props} />;
}

function HeatForm({ propertyId, actorId, kind, onKind, animals, onSaved }: DetailsProps) {
  const api = useMutations<HeatRecord>(
    "heatRecords",
    "heatRecords",
    heatRecordSchema,
    propertyId,
    actorId,
  );

  const [intensity, setIntensity] = useState<HeatIntensity>("standing");
  const [date, setDate] = useState(() => todayInput());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [by, setBy] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(undefined);
    // A heat is about the hour as much as the day: AM/PM is how the AI
    // window is worked out, so the time is kept rather than noon.
    const observedAt = new Date(`${date}T${time === "" ? "12:00" : time}:00`);
    if (Number.isNaN(observedAt.getTime())) {
      setError("Say when she was seen");
      return;
    }

    setBusy(true);
    try {
      let saved = 0;
      for (const animal of animals) {
        const result = await api.create({
          animalId: animal.id,
          observedAt,
          intensity,
          ...(by.trim() === "" ? {} : { observedBy: by.trim() }),
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
        } as never);
        if (!result.ok) {
          setError(errorText(result.error));
          return;
        }
        saved += 1;
      }
      onSaved({
        headline: `Saved for ${forCount(saved)}`,
        detail: "Next heat expected in about 21 days.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Heat"
      who={whoLine(animals)}
      switcher={<KindSwitch kind={kind} options={SWITCH} onKind={onKind} />}
      onSubmit={() => void submit()}
      submitLabel={`Save for ${forCount(animals.length)}`}
      busy={busy}
      error={error}
    >
      <Select
        label="How strong"
        value={intensity}
        onChange={(event) => setIntensity(event.target.value as HeatIntensity)}
        options={HEAT_INTENSITIES.map((value) => ({ value, label: value }))}
      />
      <div className="grid grid-cols-2 gap-density">
        <TextInput
          label="Seen"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextInput
          label="At"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </div>
      <TextInput
        label="Seen by"
        hint="A person, or a patch."
        value={by}
        onChange={(event) => setBy(event.target.value)}
      />
      <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
    </DetailsForm>
  );
}

function ServiceForm({ propertyId, actorId, kind, onKind, animals, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records: everyone } = useRecords<Animal>("animals", query);
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);
  const { records: straws } = useRecords<SemenInventory>("semenInventory", query);

  const api = useMutations<BreedingRecord>(
    "breedingRecords",
    "breedingRecords",
    breedingRecordSchema,
    propertyId,
    actorId,
  );
  const strawsApi = useMutations<SemenInventory>(
    "semenInventory",
    "semenInventory",
    semenInventorySchema,
    propertyId,
    actorId,
  );

  const [method, setMethod] = useState<BreedingMethod>("AI");
  const [sire, setSire] = useState("");
  const [date, setDate] = useState(() => todayInput());
  const [gestation, setGestation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );
  const lookup: SireLookup = useMemo(
    () => ({ animals: everyone, outsiders, straws }),
    [everyone, outsiders, straws],
  );
  // The tank belongs to AI and only to AI, as on the breeding screen.
  const options = useMemo(
    () => [...(method === "AI" ? strawOptions(straws) : []), ...bullOptions(lookup, sexes)],
    [method, straws, lookup, sexes],
  );
  const choice = useMemo(() => parseSire(sire), [sire]);
  const chosenStraw =
    choice?.kind === "straw" ? straws.find((entry) => entry.id === choice.id) : undefined;

  const bredOn = fromDateInput(date);
  const due =
    bredOn === undefined
      ? undefined
      : projectedDueDate(
          { date: bredOn, gestationDays: gestation === "" ? undefined : Number(gestation) },
          DEFAULT_GESTATION_DAYS,
        );

  async function submit() {
    setError(undefined);
    if (bredOn === undefined) {
      setError("Say what day she was bred");
      return;
    }
    if (choice === undefined && method !== "ET") {
      setError("Say who the bull was — pick a straw or a bull, or type his name");
      return;
    }

    setBusy(true);
    try {
      let saved = 0;
      // The straw as it stands after each draw, so forty cows draw forty
      // straws off one count rather than one straw forty times.
      let straw = chosenStraw;
      let tankNote = "";
      for (const animal of animals) {
        const result = await api.create({
          damId: animal.id,
          method,
          date: bredOn,
          ...(choice === undefined ? {} : breedingSire(choice, lookup)),
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
          ...(gestation === "" ? {} : { gestationDays: Number(gestation) }),
        } as never);
        if (!result.ok) {
          setError(
            saved === 0
              ? errorText(result.error)
              : `Saved for ${forCount(saved)}, then: ${errorText(result.error)}`,
          );
          break;
        }
        saved += 1;

        // After the breeding, never blocking it — the breeding screen's rule:
        // a service entered against an empty cane is still her service.
        if (straw !== undefined) {
          const drawn = drawStraw(straw, new Date());
          if (!drawn.ok) {
            tankNote = ` · tank left alone — ${straw.sireName} shows none on hand`;
          } else {
            straw = drawn.item;
          }
        }
      }

      if (chosenStraw !== undefined && straw !== undefined && straw !== chosenStraw) {
        const updated = await strawsApi.update(straw.id, {
          strawsOnHand: straw.strawsOnHand,
        } as Partial<SemenInventory>);
        tankNote = updated.ok
          ? `${straw.strawsOnHand} straw${straw.strawsOnHand === 1 ? "" : "s"} of ${straw.sireName} left${tankNote}`
          : "The tank count could not be updated";
      }

      if (saved < animals.length) return;
      onSaved({
        headline: `Saved for ${forCount(saved)}`,
        detail: [due === undefined ? undefined : `Due ${formatDate(due)}`, tankNote || undefined]
          .filter(Boolean)
          .join(" · "),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Breeding"
      who={whoLine(animals)}
      switcher={<KindSwitch kind={kind} options={SWITCH} onKind={onKind} />}
      onSubmit={() => void submit()}
      submitLabel={`Save for ${forCount(animals.length)}`}
      busy={busy}
      error={error}
    >
      <Select
        label="Method"
        value={method}
        onChange={(event) => setMethod(event.target.value as BreedingMethod)}
        options={BREEDING_METHODS.map((value) => ({ value, label: value }))}
      />
      <SearchSelect
        label={method === "natural" ? "Bull" : method === "ET" ? "Sire of the embryo" : "Sire"}
        value={sire}
        placeholder={
          method === "natural" ? "Choose or type a bull" : "Choose a straw, or type a bull"
        }
        options={options}
        allowCustom={(typed) => `Use "${typed}" — not on file`}
        onChange={setSire}
        {...(method === "ET" ? {} : { required: true })}
        clearLabel={method === "ET" ? "Not recorded" : undefined}
      />
      {chosenStraw === undefined ? null : (
        <p className="-mt-2 text-sm text-muted">
          {chosenStraw.strawsOnHand === 0
            ? `${chosenStraw.sireName} shows none on hand — the tank count stays put.`
            : `Draws ${forCount(animals.length).replace("animal", "straw")}; ${Math.max(0, chosenStraw.strawsOnHand - animals.length)} would be left.`}
        </p>
      )}
      <div className="grid grid-cols-2 gap-density">
        <TextInput
          label="Date bred"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextInput
          label="Gestation days"
          hint={`Blank = ${DEFAULT_GESTATION_DAYS}`}
          type="number"
          value={gestation}
          onChange={(event) => setGestation(event.target.value)}
        />
      </div>
      {due === undefined ? null : (
        <p className="-mt-2 text-sm text-muted">
          Due <span className="font-medium text-ink">{formatDate(due)}</span>
        </p>
      )}
      <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
    </DetailsForm>
  );
}
