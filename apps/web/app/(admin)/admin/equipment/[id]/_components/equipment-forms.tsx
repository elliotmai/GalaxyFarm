"use client";

import { useState } from "react";

import { Button, Checkbox, Select, TextInput, useToast } from "@galaxy-farm/ui";
import { fromDollars, type Ulid } from "@galaxy-farm/core";
import {
  currentMeter,
  fuelLogSchema,
  maintenanceLogSchema,
  maintenanceRuleSchema,
  METER_KINDS,
  meterReadingSchema,
  type Equipment,
  type FuelLog,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterKind,
  type MeterReading,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";

import { KitFormPanel as FormPanel } from "../../_components/kit-controls";
import { atNoon, errorMessage, num, today } from "./equipment-format";

/**
 * The four ledger forms on one machine's page (spec §5.6).
 *
 * Each is a side panel — a bottom sheet on a phone — rather than a form at the
 * top of its tab, so reading the meter never pushes the readings down the page
 * and editing one never scrolls you away from the row you tapped. Each mounts
 * fresh when it opens, which is what lets its initialisers read the record
 * being edited, or the rule being recorded, exactly once.
 */

export interface Common {
  readonly machine: Equipment;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** Present when editing: closes the panel and asks to delete. */
  readonly onDelete?: (() => void) | undefined;
}

/* ----------------------------------------------------------------- meters */

export function MeterForm({
  machine,
  readings,
  editing,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly readings: readonly MeterReading[];
  readonly editing?: MeterReading | undefined;
}) {
  const api = useMutations<MeterReading>(
    "meterReadings",
    "meterReadings",
    meterReadingSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [kind, setKind] = useState<MeterKind>(editing?.kind ?? "hours");
  const [value, setValue] = useState(editing === undefined ? "" : String(editing.value));
  const [readOn, setReadOn] = useState(
    editing === undefined ? today() : editing.readOn.toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const latest = currentMeter(readings, machine.id, kind);
  // A meter does not run backwards on its own. It does when one is replaced,
  // which is worth a sentence rather than a rejection — the domain allows it
  // and the note is what makes the history readable a year later.
  const wentBackwards =
    latest !== undefined && value !== "" && Number(value) < latest && editing === undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        kind,
        value: Number(value),
        readOn: atNoon(readOn),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<MeterReading>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Meter read" : "Reading updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Read the meter" : "Edit this reading"}
      submitLabel={editing === undefined ? "Record reading" : "Save reading"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <Select
        label="Meter"
        value={kind}
        onChange={(event) => setKind(event.target.value as MeterKind)}
        options={METER_KINDS.map((option) => ({ value: option, label: option }))}
      />
      <TextInput
        label="Reading"
        type="number"
        inputMode="decimal"
        step="0.1"
        numeric
        value={value}
        onChange={(event) => setValue(event.target.value)}
        hint={latest === undefined ? "First reading" : `Last: ${num(latest, 1)}`}
        required
      />
      <TextInput
        label="Read on"
        type="date"
        value={readOn}
        onChange={(event) => setReadOn(event.target.value)}
        required
      />
      <TextInput label="Note" value={notes} onChange={(event) => setNotes(event.target.value)} />
      {wentBackwards ? (
        <p className="text-sm text-muted sm:col-span-2">
          Lower than the last {kind} reading. If the meter was replaced, say so in the note — every
          interval from here measures against it.
        </p>
      ) : null}
    </FormPanel>
  );
}

/* ------------------------------------------------------------ maintenance */

export function RuleForm({
  machine,
  editing,
  propertyId,
  actorId,
  onClose,
  onDelete,
  onRecord,
}: Common & {
  readonly editing?: MaintenanceRule | undefined;
  /** "Record this job" from inside the rule's own panel. */
  readonly onRecord?: (() => void) | undefined;
}) {
  const api = useMutations<MaintenanceRule>(
    "maintenanceRules",
    "maintenanceRules",
    maintenanceRuleSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [task, setTask] = useState(editing?.task ?? "");
  const [everyHours, setEveryHours] = useState(
    editing?.everyHours === undefined ? "" : String(editing.everyHours),
  );
  const [everyMiles, setEveryMiles] = useState(
    editing?.everyMiles === undefined ? "" : String(editing.everyMiles),
  );
  const [everyMonths, setEveryMonths] = useState(
    editing?.everyMonths === undefined ? "" : String(editing.everyMonths),
  );
  const [parts, setParts] = useState(editing?.parts ?? "");
  const [active, setActive] = useState(editing?.active ?? true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        task: task.trim(),
        everyHours: everyHours === "" ? undefined : Number(everyHours),
        everyMiles: everyMiles === "" ? undefined : Number(everyMiles),
        everyMonths: everyMonths === "" ? undefined : Number(everyMonths),
        parts: parts.trim() === "" ? undefined : parts.trim(),
        active,
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<MaintenanceRule>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Rule added" : "Rule updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Add a rule" : `Edit ${editing.task}`}
      // Said once, where the triggers are chosen: it is what keeps oil in an
      // engine that sits all winter.
      description="Hours, miles, months, or any mix. It comes due at whichever arrives first."
      submitLabel={editing === undefined ? "Add rule" : "Save rule"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <TextInput
        label="Job"
        className="sm:col-span-2"
        placeholder="Engine oil and filter"
        value={task}
        onChange={(event) => setTask(event.target.value)}
        required
      />
      <TextInput
        label="Every N hours"
        type="number"
        inputMode="decimal"
        numeric
        value={everyHours}
        onChange={(event) => setEveryHours(event.target.value)}
      />
      <TextInput
        label="Every N miles"
        type="number"
        inputMode="decimal"
        numeric
        value={everyMiles}
        onChange={(event) => setEveryMiles(event.target.value)}
      />
      <TextInput
        label="Every N months"
        type="number"
        inputMode="decimal"
        numeric
        value={everyMonths}
        onChange={(event) => setEveryMonths(event.target.value)}
      />
      <TextInput
        label="Parts"
        hint="The filter number, so nobody looks it up twice."
        value={parts}
        onChange={(event) => setParts(event.target.value)}
      />
      <Checkbox
        label="Still asking"
        hint="Off stops it coming due without losing what it recorded."
        checked={active}
        onChange={(event) => setActive(event.target.checked)}
      />
      {onRecord === undefined ? null : (
        <div className="sm:col-span-2">
          <Button onClick={onRecord}>Record this job</Button>
        </div>
      )}
    </FormPanel>
  );
}

/* ------------------------------------------------------------ service log */

export function ServiceForm({
  machine,
  rules,
  editing,
  prefill,
  hours,
  miles,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly rules: readonly MaintenanceRule[];
  readonly editing?: MaintenanceLog | undefined;
  /** The rule a "Record this job" came from, read once as the opening state. */
  readonly prefill?: MaintenanceRule | undefined;
  readonly hours: number | undefined;
  readonly miles: number | undefined;
}) {
  const api = useMutations<MaintenanceLog>(
    "maintenanceLogs",
    "maintenanceLogs",
    maintenanceLogSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [ruleId, setRuleId] = useState<string>(editing?.ruleId ?? prefill?.id ?? "");
  const [task, setTask] = useState(editing?.task ?? prefill?.task ?? "");
  const [performedOn, setPerformedOn] = useState(
    editing === undefined ? today() : editing.performedOn.toISOString().slice(0, 10),
  );
  const [cost, setCost] = useState(
    editing?.cost === undefined ? "" : (editing.cost.cents / 100).toFixed(2),
  );
  const [parts, setParts] = useState(editing?.parts ?? prefill?.parts ?? "");
  // Prefilled from the latest reading: the meter at the time of the work is
  // what the next interval measures from, and typing it again from memory is
  // how an interval ends up two hundred hours out.
  const initialHours = editing === undefined ? hours : editing.hours;
  const initialMiles = editing === undefined ? miles : editing.miles;
  const [atHours, setAtHours] = useState(initialHours === undefined ? "" : String(initialHours));
  const [atMiles, setAtMiles] = useState(initialMiles === undefined ? "" : String(initialMiles));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        ruleId: ruleId === "" ? undefined : (ruleId as Ulid),
        task: task.trim(),
        performedOn: atNoon(performedOn),
        cost: cost.trim() === "" ? undefined : fromDollars(Number(cost)),
        parts: parts.trim() === "" ? undefined : parts.trim(),
        hours: atHours === "" ? undefined : Number(atHours),
        miles: atMiles === "" ? undefined : Number(atMiles),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<MaintenanceLog>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({
        message:
          ruleId === "" ? "Service recorded" : "Service recorded — the rule counts from here now",
        tone: "success",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Record work done" : "Edit this entry"}
      // The one thing about this form that is easy to get wrong.
      description="Naming the rule is what resets its interval. Leave it blank for a repair."
      submitLabel={editing === undefined ? "Record service" : "Save entry"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <Select
        label="Against a rule"
        value={ruleId}
        placeholder="A one-off"
        onChange={(event) => {
          setRuleId(event.target.value);
          const rule = rules.find((entry) => entry.id === event.target.value);
          // The rule's own words, unless somebody has already typed
          // theirs — a job description overwritten mid-form is worse
          // than one that has to be typed.
          if (rule !== undefined && task.trim() === "") setTask(rule.task);
        }}
        options={rules.map((rule) => ({ value: rule.id, label: rule.task }))}
      />
      <TextInput
        label="Job"
        value={task}
        onChange={(event) => setTask(event.target.value)}
        required
      />
      <TextInput
        label="Done"
        type="date"
        value={performedOn}
        onChange={(event) => setPerformedOn(event.target.value)}
        required
      />
      <TextInput
        label="Hours at the time"
        hint="What the next interval counts from."
        type="number"
        inputMode="decimal"
        step="0.1"
        numeric
        value={atHours}
        onChange={(event) => setAtHours(event.target.value)}
      />
      <TextInput
        label="Miles at the time"
        type="number"
        inputMode="decimal"
        numeric
        value={atMiles}
        onChange={(event) => setAtMiles(event.target.value)}
      />
      <TextInput
        label="Cost ($)"
        type="number"
        inputMode="decimal"
        step="0.01"
        numeric
        value={cost}
        onChange={(event) => setCost(event.target.value)}
      />
      <TextInput label="Parts" value={parts} onChange={(event) => setParts(event.target.value)} />
      <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
    </FormPanel>
  );
}

/* ------------------------------------------------------------------- fuel */

export function FuelForm({
  machine,
  editing,
  hours,
  miles,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly editing?: FuelLog | undefined;
  readonly hours: number | undefined;
  readonly miles: number | undefined;
}) {
  const api = useMutations<FuelLog>("fuelLogs", "fuelLogs", fuelLogSchema, propertyId, actorId);
  const { show } = useToast();

  const [gallons, setGallons] = useState(editing === undefined ? "" : String(editing.gallons));
  const [cost, setCost] = useState(
    editing?.cost === undefined ? "" : (editing.cost.cents / 100).toFixed(2),
  );
  const [filledOn, setFilledOn] = useState(
    editing === undefined ? today() : editing.filledOn.toISOString().slice(0, 10),
  );
  const initialHours = editing === undefined ? hours : editing.hours;
  const initialMiles = editing === undefined ? miles : editing.miles;
  const [atHours, setAtHours] = useState(initialHours === undefined ? "" : String(initialHours));
  const [atMiles, setAtMiles] = useState(initialMiles === undefined ? "" : String(initialMiles));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        equipmentId: machine.id,
        gallons: Number(gallons),
        // Blank is "no receipt" — bulk-tank diesel — not a free tank.
        cost: cost.trim() === "" ? undefined : fromDollars(Number(cost)),
        filledOn: atNoon(filledOn),
        hours: atHours === "" ? undefined : Number(atHours),
        miles: atMiles === "" ? undefined : Number(atMiles),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FuelLog>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Fill recorded" : "Fill updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Record a fill" : "Edit this fill"}
      // Without the odometer this is only a record of what fuel cost.
      description="The odometer at the pump is what gives miles per gallon."
      submitLabel={editing === undefined ? "Record fill" : "Save fill"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <TextInput
        label="Gallons"
        type="number"
        inputMode="decimal"
        step="0.01"
        numeric
        value={gallons}
        onChange={(event) => setGallons(event.target.value)}
        required
      />
      <TextInput
        label="Cost ($)"
        hint="Blank for the farm tank."
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        numeric
        value={cost}
        onChange={(event) => setCost(event.target.value)}
      />
      <TextInput
        label="Filled"
        type="date"
        value={filledOn}
        onChange={(event) => setFilledOn(event.target.value)}
        required
      />
      <TextInput
        label="Miles at the pump"
        type="number"
        inputMode="decimal"
        numeric
        value={atMiles}
        onChange={(event) => setAtMiles(event.target.value)}
      />
      <TextInput
        label="Hours at the pump"
        type="number"
        inputMode="decimal"
        step="0.1"
        numeric
        value={atHours}
        onChange={(event) => setAtHours(event.target.value)}
      />
      <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
    </FormPanel>
  );
}
