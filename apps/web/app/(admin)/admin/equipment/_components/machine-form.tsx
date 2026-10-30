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

import { KitFormPanel as FormPanel } from "./kit-controls";

/**
 * What a machine is — name, make, serial, what it cost — in a side panel.
 *
 * One panel for adding a machine and for editing one, opened from the fleet's
 * add button, a fleet row's pencil, and the machine page's Edit. It used to be
 * three: a create form inline in the fleet screen, a status-and-delete panel
 * on the fleet row, and this edit form on the machine page — so renaming a
 * machine from the fleet meant opening its page first, and deleting one from
 * its own page was not possible at all.
 *
 * Its draft lives here rather than in the screen that opens it, so typing in a
 * field re-renders the panel and nothing behind it: the fleet recomputing what
 * is due on every keystroke was the slowest thing about adding a machine.
 *
 * Only the name is required. The serial, the price and the notes are what a
 * parts counter or a buyer asks for, and none of them should stand between
 * somebody and writing down that the place has a new trailer.
 */
export function MachineForm({
  machine,
  propertyId,
  actorId,
  onClose,
  onDelete,
  onCreated,
}: {
  /** Absent to add a machine. */
  readonly machine?: Equipment | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** Present when editing: closes the panel and asks to delete. */
  readonly onDelete?: (() => void) | undefined;
  /** After a new machine is written — the fleet uses it to offer the way in. */
  readonly onCreated?: ((created: Equipment) => void) | undefined;
}) {
  const api = useMutations<Equipment>(
    "equipment",
    "equipment",
    equipmentSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [name, setName] = useState(machine?.name ?? "");
  const [category, setCategory] = useState<EquipmentCategory>(machine?.category ?? "implement");
  const [status, setStatus] = useState<EquipmentStatus>(machine?.status ?? "in_service");
  const [make, setMake] = useState(machine?.make ?? "");
  const [model, setModel] = useState(machine?.model ?? "");
  const [year, setYear] = useState(machine?.year === undefined ? "" : String(machine.year));
  const [vin, setVin] = useState(machine?.vin ?? "");
  const [purchasedOn, setPurchasedOn] = useState(
    machine?.purchasedOn === undefined ? "" : machine.purchasedOn.toISOString().slice(0, 10),
  );
  const [price, setPrice] = useState(
    machine?.purchasePrice === undefined ? "" : (machine.purchasePrice.cents / 100).toFixed(2),
  );
  const [notes, setNotes] = useState(machine?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        name: name.trim(),
        category,
        status,
        make: make.trim() === "" ? undefined : make.trim(),
        model: model.trim() === "" ? undefined : model.trim(),
        year: year === "" ? undefined : Number(year),
        vin: vin.trim() === "" ? undefined : vin.trim(),
        purchasedOn: purchasedOn === "" ? undefined : new Date(`${purchasedOn}T12:00:00`),
        // Blank is "not recorded", not a machine that cost nothing.
        purchasePrice: price.trim() === "" ? undefined : fromDollars(Number(price)),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        machine === undefined
          ? await api.create({ ...payload, photoKeys: [] } as never)
          : await api.update(machine.id, payload as Partial<Equipment>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      if (machine === undefined) {
        if (onCreated === undefined) show({ message: `${payload.name} added` });
        else onCreated(result.value);
      } else {
        show({ message: "Machine updated" });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={machine === undefined ? "Add a machine" : `Edit ${machine.name}`}
      submitLabel={machine === undefined ? "Add machine" : "Save machine"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <TextInput
        label="Name"
        hint="What it is called in the barn, not its model number."
        className="sm:col-span-2"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <Select
        label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value as EquipmentCategory)}
        options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: optionLabel(value) }))}
      />
      <Select
        label="Status"
        value={status}
        onChange={(event) => setStatus(event.target.value as EquipmentStatus)}
        options={EQUIPMENT_STATUSES.map((value) => ({ value, label: optionLabel(value) }))}
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
        min="0"
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
