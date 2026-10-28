"use client";

import { useState } from "react";

import { Select, TextInput, useToast, optionLabel } from "@galaxy-farm/ui";
import { fromDollars, type Ulid } from "@galaxy-farm/core";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  equipmentSchema,
  type Equipment,
  type EquipmentCategory,
  type EquipmentStatus,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";

import { KitFormPanel as FormPanel } from "../../_components/kit-controls";
import { atNoon, errorMessage } from "./equipment-format";

/**
 * What the machine is — name, make, serial, what it cost — in a side panel.
 *
 * Opened from the Edit button in the header and from the Details tab. It used
 * to replace the Details tab with itself, which put the facts and the form for
 * them in the same place and meant reading a VIN while editing was impossible.
 */
export function MachineForm({
  machine,
  propertyId,
  actorId,
  onClose,
}: {
  readonly machine: Equipment;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
}) {
  const api = useMutations<Equipment>(
    "equipment",
    "equipment",
    equipmentSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [name, setName] = useState(machine.name);
  const [category, setCategory] = useState<EquipmentCategory>(machine.category);
  const [status, setStatus] = useState<EquipmentStatus>(machine.status);
  const [make, setMake] = useState(machine.make ?? "");
  const [model, setModel] = useState(machine.model ?? "");
  const [year, setYear] = useState(machine.year === undefined ? "" : String(machine.year));
  const [vin, setVin] = useState(machine.vin ?? "");
  const [purchasedOn, setPurchasedOn] = useState(
    machine.purchasedOn === undefined ? "" : machine.purchasedOn.toISOString().slice(0, 10),
  );
  const [price, setPrice] = useState(
    machine.purchasePrice === undefined ? "" : (machine.purchasePrice.cents / 100).toFixed(2),
  );
  const [notes, setNotes] = useState(machine.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const result = await api.update(machine.id, {
        name: name.trim(),
        category,
        status,
        make: make.trim() === "" ? undefined : make.trim(),
        model: model.trim() === "" ? undefined : model.trim(),
        year: year === "" ? undefined : Number(year),
        vin: vin.trim() === "" ? undefined : vin.trim(),
        purchasedOn: purchasedOn === "" ? undefined : atNoon(purchasedOn),
        purchasePrice: price === "" ? undefined : fromDollars(Number(price)),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      } as Partial<Equipment>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: "Machine updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={`Edit ${machine.name}`}
      submitLabel="Save machine"
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
    >
      <TextInput
        label="Name"
        className="sm:col-span-2"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <Select
        label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value as EquipmentCategory)}
        options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: value }))}
      />
      <Select
        label="Status"
        value={status}
        onChange={(event) => setStatus(event.target.value as EquipmentStatus)}
        options={EQUIPMENT_STATUSES.map((value) => ({
          value,
          label: optionLabel(value),
        }))}
      />
      <TextInput label="Make" value={make} onChange={(event) => setMake(event.target.value)} />
      <TextInput label="Model" value={model} onChange={(event) => setModel(event.target.value)} />
      <TextInput
        label="Year"
        type="number"
        inputMode="numeric"
        numeric
        value={year}
        onChange={(event) => setYear(event.target.value)}
      />
      <TextInput
        label="VIN or serial"
        value={vin}
        onChange={(event) => setVin(event.target.value)}
      />
      <TextInput
        label="Bought"
        type="date"
        value={purchasedOn}
        onChange={(event) => setPurchasedOn(event.target.value)}
      />
      <TextInput
        label="Paid ($)"
        type="number"
        inputMode="decimal"
        step="0.01"
        numeric
        value={price}
        onChange={(event) => setPrice(event.target.value)}
      />
      <TextInput
        label="Notes"
        className="sm:col-span-2"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormPanel>
  );
}
