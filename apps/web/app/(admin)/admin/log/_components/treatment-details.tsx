"use client";

import { useMemo, useState } from "react";

import { Select, TextInput } from "@galaxy-farm/ui";
import { type Ulid } from "@galaxy-farm/core";
import {
  drawDose,
  healthRecordSchema,
  HEALTH_RECORD_TYPES,
  medInventorySchema,
  ROUTES,
  type AdministrationRoute,
  type HealthRecord,
  type HealthRecordType,
  type MedInventory,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

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
 * A treatment for one animal or a run of them (spec §5.2, issue #17).
 *
 * The same two writes the health screen makes — the health record, and the
 * dose drawn out of the fridge — through the same mutation paths and schemas.
 * A round of blackleg is forty calves and one bottle, so one form writes one
 * record per animal and draws forty doses.
 *
 * Withdrawal days are copied off the product, never linked, for the reason
 * the health screen gives: a label change next year must not move a date
 * somebody has already sold an animal against.
 */

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function TreatmentDetails({ propertyId, actorId, animals, onSaved }: DetailsProps) {
  const query = { propertyId };
  const { records } = useRecords<HealthRecord>("healthRecords", query);
  const { records: meds } = useRecords<MedInventory>("medInventory", query);

  const api = useMutations<HealthRecord>(
    "healthRecords",
    "healthRecords",
    healthRecordSchema,
    propertyId,
    actorId,
  );
  const fridge = useMutations<MedInventory>(
    "medInventory",
    "medInventory",
    medInventorySchema,
    propertyId,
    actorId,
  );

  // Defaulting to the last product used, as the health screen does: nearly
  // every treatment here is the same bottle as the one before it.
  const lastUsed = useMemo(
    () => [...records].sort((left, right) => right.date.getTime() - left.date.getTime())[0],
    [records],
  );

  const [type, setType] = useState<HealthRecordType>("vaccination");
  const [medId, setMedId] = useState(lastUsed?.medInventoryId ?? "");
  const [product, setProduct] = useState(lastUsed?.product ?? "");
  const [route, setRoute] = useState<AdministrationRoute>(lastUsed?.route ?? "subcutaneous");
  const [date, setDate] = useState(todayValue);
  const [withdrawal, setWithdrawal] = useState("");
  const [dose, setDose] = useState("");
  const [by, setBy] = useState("");
  const [booster, setBooster] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const chosenMed = meds.find((entry) => entry.id === medId);

  function chooseMed(id: string) {
    setMedId(id);
    const med = meds.find((entry) => entry.id === id);
    if (med === undefined) return;
    setProduct(med.product);
    if (med.defaultWithdrawalDays !== undefined) setWithdrawal(String(med.defaultWithdrawalDays));
  }

  // Shown before saving: the clearance date is the point of the record, and a
  // mistyped withdrawal is invisible until somebody tries to sell her.
  const clears =
    withdrawal === "" || date === ""
      ? undefined
      : new Date(atNoon(date).getTime() + Number(withdrawal) * 86_400_000);

  async function submit() {
    setError(undefined);

    /*
     * The whole run's doses are checked before anything is written. `drawDose`
     * refuses to go negative (§4.5 clause 2), and finding out on the
     * thirty-first calf that the bottle ran dry would leave thirty records
     * and a count nobody can trust.
     */
    let drawn: MedInventory | undefined;
    if (chosenMed !== undefined && dose.trim() !== "") {
      const result = drawDose(
        chosenMed,
        { amount: Number(dose) * animals.length, unit: chosenMed.onHand.unit },
        new Date(),
      );
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      drawn = result.item;
    }

    setBusy(true);
    try {
      let saved = 0;
      for (const animal of animals) {
        const result = await api.create({
          animalId: animal.id,
          type,
          date: atNoon(date),
          product: product.trim() === "" ? undefined : product.trim(),
          medInventoryId: medId === "" ? undefined : (medId as Ulid),
          route,
          administeredBy: by.trim() === "" ? undefined : by.trim(),
          withdrawalDays: withdrawal === "" ? undefined : Number(withdrawal),
          boosterDueOn: booster === "" ? undefined : atNoon(booster),
          notes: notes.trim() === "" ? undefined : notes.trim(),
        } as never);

        if (!result.ok) {
          // The first record that fails is the same failure for all of them —
          // the fields are shared — so it stops here rather than repeating it.
          setError(
            saved === 0
              ? errorText(result.error)
              : `Saved for ${forCount(saved)}, then: ${errorText(result.error)}`,
          );
          break;
        }
        saved += 1;
      }

      if (drawn !== undefined && chosenMed !== undefined && saved > 0) {
        // Only the doses actually given come off the count.
        const given =
          saved === animals.length
            ? drawn
            : drawDose(
                chosenMed,
                { amount: Number(dose) * saved, unit: chosenMed.onHand.unit },
                new Date(),
              );
        const item = "ok" in given ? (given.ok ? given.item : undefined) : given;
        if (item !== undefined) {
          await fridge.update(item.id, { onHand: item.onHand } as Partial<MedInventory>);
        }
      }

      if (saved < animals.length) return;

      const details = [
        clears === undefined ? "No withdrawal" : `Not clear for sale until ${formatDate(clears)}`,
        drawn === undefined
          ? undefined
          : `${drawn.onHand.amount} ${drawn.onHand.unit} of ${drawn.product} left`,
        booster === "" ? undefined : `Booster due ${formatDate(atNoon(booster))}`,
      ].filter((part): part is string => part !== undefined);

      onSaved({ headline: `Saved for ${forCount(saved)}`, detail: `${details.join(" · ")}.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailsForm
      title="Treatment"
      who={whoLine(animals)}
      onSubmit={() => void submit()}
      submitLabel={`Save for ${forCount(animals.length)}`}
      busy={busy}
      error={error}
    >
      <Select
        label="From the fridge"
        value={medId}
        onChange={(event) => chooseMed(event.target.value)}
        placeholder="Not from stock"
        options={meds.map((med) => ({
          value: med.id,
          label: `${med.product} · ${med.onHand.amount} ${med.onHand.unit}`,
        }))}
      />
      <TextInput
        label="Product"
        value={product}
        onChange={(event) => setProduct(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-density">
        <TextInput
          label={chosenMed === undefined ? "Dose (each)" : `Dose (${chosenMed.onHand.unit} each)`}
          type="number"
          inputMode="decimal"
          numeric
          value={dose}
          onChange={(event) => setDose(event.target.value)}
        />
        <Select
          label="Route"
          value={route}
          onChange={(event) => setRoute(event.target.value as AdministrationRoute)}
          options={ROUTES.map((value) => ({ value, label: value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-density">
        <Select
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as HealthRecordType)}
          options={HEALTH_RECORD_TYPES.map((value) => ({ value, label: value }))}
        />
        <TextInput
          label="When"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-density">
        <TextInput
          label="Withdrawal (days)"
          hint="Blank means none."
          type="number"
          inputMode="numeric"
          value={withdrawal}
          onChange={(event) => setWithdrawal(event.target.value)}
        />
        <TextInput
          label="Booster due"
          type="date"
          value={booster}
          onChange={(event) => setBooster(event.target.value)}
        />
      </div>
      <TextInput label="Given by" value={by} onChange={(event) => setBy(event.target.value)} />
      <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />

      <p
        className={[
          "rounded-density px-3.5 py-2.5 text-sm",
          clears === undefined ? "bg-calm/15 text-calm" : "bg-danger/10 text-danger",
        ].join(" ")}
      >
        {clears === undefined ? "No withdrawal" : `Not clear for sale until ${formatDate(clears)}`}
        {chosenMed === undefined || dose.trim() === ""
          ? ""
          : ` · ${Number(dose) * animals.length} ${chosenMed.onHand.unit} of ${chosenMed.onHand.amount} on hand`}
      </p>
    </DetailsForm>
  );
}
