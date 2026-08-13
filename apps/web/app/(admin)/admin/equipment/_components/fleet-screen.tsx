"use client";

import { useState } from "react";
import Link from "next/link";

import {
  Button,
  Callout,
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Select,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { formatMoney, fromDollars, type Money, type Ulid } from "@galaxy-farm/core";
import {
  costOfOwnership,
  currentMeter,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  equipmentSchema,
  fuelLogSchema,
  maintenanceDue,
  maintenanceLogSchema,
  maintenanceRuleSchema,
  meterReadingSchema,
  type Equipment,
  type EquipmentCategory,
  type EquipmentStatus,
  type FuelLog,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The fleet (spec §5.6, §7's `/admin/equipment`).
 *
 * What this screen is for is one question — **is anything due** — and it is
 * asked about machines that mostly sit still. §5.6 allows a rule to trigger on
 * hours, miles or months in any combination, so the answer is never a single
 * date: a tractor that sat all winter is due on months, and the same tractor
 * after a fortnight of baling is due on hours. `maintenanceDue` returns which
 * trigger fired, and this screen shows it, because "overdue" with no
 * explanation is a badge people learn to scroll past.
 *
 * Everything about one machine — its meters, its rules, its service and its
 * fuel — lives on its own page. This one holds what you need to decide which
 * page to open.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Hours read to a tenth; miles do not. */
function num(value: number | undefined, decimals = 0): string {
  return value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function describe(machine: Equipment): string {
  return [machine.year, machine.make, machine.model].filter(Boolean).join(" ");
}

const STATUS_TONE: Record<EquipmentStatus, "calm" | "danger" | "neutral"> = {
  in_service: "calm",
  down: "danger",
  sold: "neutral",
  retired: "neutral",
};

interface Draft {
  readonly name: string;
  readonly category: EquipmentCategory;
  readonly make: string;
  readonly model: string;
  readonly year: string;
  readonly vin: string;
  readonly status: EquipmentStatus;
  readonly purchasedOn: string;
  readonly purchasePrice: string;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  category: "implement",
  make: "",
  model: "",
  year: "",
  vin: "",
  status: "in_service",
  purchasedOn: "",
  purchasePrice: "",
  notes: "",
};

export function FleetScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: fleet, loading } = useRecords<Equipment>("equipment", query);
  const { records: readings } = useRecords<MeterReading>("meterReadings", query);
  const { records: rules } = useRecords<MaintenanceRule>("maintenanceRules", query);
  const { records: logs } = useRecords<MaintenanceLog>("maintenanceLogs", query);
  const { records: fuel } = useRecords<FuelLog>("fuelLogs", query);

  const api = useMutations<Equipment>(
    "equipment",
    "equipment",
    equipmentSchema,
    propertyId,
    actorId,
  );
  // The ledgers hanging off a machine, so deleting one can take them with it.
  const readingsApi = useMutations<MeterReading>(
    "meterReadings",
    "meterReadings",
    meterReadingSchema,
    propertyId,
    actorId,
  );
  const rulesApi = useMutations<MaintenanceRule>(
    "maintenanceRules",
    "maintenanceRules",
    maintenanceRuleSchema,
    propertyId,
    actorId,
  );
  const logsApi = useMutations<MaintenanceLog>(
    "maintenanceLogs",
    "maintenanceLogs",
    maintenanceLogSchema,
    propertyId,
    actorId,
  );
  const fuelApi = useMutations<FuelLog>("fuelLogs", "fuelLogs", fuelLogSchema, propertyId, actorId);

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const now = new Date();

  /**
   * What is due, per machine.
   *
   * Computed over the whole fleet in one pass and grouped afterwards rather
   * than per card: `maintenanceDue` reads the meter history for every rule it
   * is given, and calling it once per machine would walk the same readings
   * once per machine.
   *
   * Not memoised. It depends on `now`, which is a new object every render, so
   * a memo would recompute anyway while looking as though it did not — this is
   * a handful of machines over a few hundred readings.
   */
  const dueByEquipment = new Map<Ulid, ReturnType<typeof maintenanceDue>>();
  for (const entry of maintenanceDue(rules, logs, readings, now)) {
    dueByEquipment.set(entry.rule.equipmentId, [
      ...(dueByEquipment.get(entry.rule.equipmentId) ?? []),
      entry,
    ]);
  }

  const overdue = [...dueByEquipment.entries()].flatMap(([equipmentId, entries]) =>
    entries.filter((entry) => entry.overdue).map((entry) => ({ equipmentId, entry })),
  );

  const running = fleet.filter((machine) => machine.status === "in_service");
  const down = fleet.filter((machine) => machine.status === "down");

  const spend: Money = {
    cents: fleet.reduce(
      (total, machine) => total + costOfOwnership(machine.id, logs, fuel).cents,
      0,
    ),
  };

  function reset() {
    setDraft(BLANK);
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        name: draft.name.trim(),
        category: draft.category,
        make: draft.make.trim() === "" ? undefined : draft.make.trim(),
        model: draft.model.trim() === "" ? undefined : draft.model.trim(),
        year: draft.year === "" ? undefined : Number(draft.year),
        vin: draft.vin.trim() === "" ? undefined : draft.vin.trim(),
        status: draft.status,
        purchasedOn:
          draft.purchasedOn === "" ? undefined : new Date(`${draft.purchasedOn}T12:00:00`),
        purchasePrice:
          draft.purchasePrice === "" ? undefined : fromDollars(Number(draft.purchasePrice)),
        photoKeys: [],
        notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
      };

      const result = await api.create(payload as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: `${payload.name} added` });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(machine: Equipment, status: EquipmentStatus) {
    await api.update(machine.id, { status } as Partial<Equipment>);
    show({
      message: `${machine.name} · ${status.replace(/_/g, " ")}`,
      tone: status === "down" ? "warning" : "success",
    });
  }

  /**
   * Cascade, not restrict (§4.5).
   *
   * A meter reading, a service entry and a tank of diesel are facts about one
   * machine and about nothing else — leaving them behind would put a fuel log
   * on the cost-of-ownership figure for a truck that is no longer in the app.
   * Every one of them is a tombstone, so the undo puts the whole machine back,
   * ledgers and all, and that is the only reason cascading here is honest.
   */
  async function remove(machine: Equipment) {
    const mine = <T extends { readonly equipmentId: Ulid }>(entries: readonly T[]) =>
      entries.filter((entry) => entry.equipmentId === machine.id);

    // Each child paired with the store that owns it, so the delete and the
    // undo both walk one list rather than four repeated filters.
    const children = [
      ...mine(readings).map((entry) => ({
        api: readingsApi,
        id: entry.id,
        entity: "Meter reading",
        label: `${num(entry.value, 1)} ${entry.kind}`,
      })),
      ...mine(rules).map((entry) => ({
        api: rulesApi,
        id: entry.id,
        entity: "Maintenance rule",
        label: entry.task,
      })),
      ...mine(logs).map((entry) => ({
        api: logsApi,
        id: entry.id,
        entity: "Service entry",
        label: `${entry.task}, ${formatDate(entry.performedOn)}`,
      })),
      ...mine(fuel).map((entry) => ({
        api: fuelApi,
        id: entry.id,
        entity: "Fuel log",
        label: `${num(entry.gallons, 1)} gal, ${formatDate(entry.filledOn)}`,
      })),
    ];

    const confirmed = await confirmDelete({
      tier: "typed",
      recordName: machine.name,
      entity: "machine",
      dependents: children.map((child) => ({
        entity: child.entity,
        label: child.label,
        effect: "deleted" as const,
      })),
      consequence:
        "Its meters, rules, service history and fuel go to Trash with it, and come back together if you restore it.",
    });
    if (!confirmed) return;

    const reason = `Deleted with ${machine.name}`;
    for (const child of children) await child.api.remove(child.id, reason);
    await api.remove(machine.id, "Removed from the fleet");

    show({
      message: `${machine.name} deleted`,
      tone: "danger",
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(machine.id);
            for (const child of children) await child.api.restoreRecord(child.id);
          })();
        },
      },
    });
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Kit"
        title="Equipment"
        subtitle="The fleet, what the meters read, and what each rule says is due. A rule with two triggers comes due at whichever arrives first."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="In service" value={running.length} tone="calm" />
        <Tile
          label="Down"
          value={down.length}
          tone={down.length > 0 ? "danger" : "neutral"}
          emphasis={down.length > 0}
          hint={down.length > 0 ? down.map((machine) => machine.name).join(", ") : undefined}
        />
        <Tile
          label="Service overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "danger" : "calm"}
          emphasis={overdue.length > 0}
        />
        <Tile
          label="Fuel and service"
          value={formatMoney(spend)}
          hint="Cost of ownership to date"
        />
      </div>

      {overdue.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${overdue.length} job${overdue.length === 1 ? "" : "s"} overdue`}
        >
          {overdue
            .map(({ equipmentId, entry }) => {
              const machine = fleet.find((item) => item.id === equipmentId);
              return `${machine?.name ?? "A machine"} — ${entry.rule.task} (on ${entry.reason})`;
            })
            .join("; ")}
          .
        </Callout>
      )}

      <Section
        title="Add a machine"
        description="Everything else about one — its meters, its rules, its service and its fuel — lives on its own page."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="Name"
              hint="What it is called in the barn — &ldquo;the gooseneck&rdquo;, not its model number."
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
            />
            <Select
              label="Category"
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value as EquipmentCategory })
              }
              options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: value }))}
            />
            <Select
              label="Status"
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as EquipmentStatus })
              }
              options={EQUIPMENT_STATUSES.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
            <TextInput
              label="Make"
              value={draft.make}
              onChange={(event) => setDraft({ ...draft, make: event.target.value })}
            />
            <TextInput
              label="Model"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <TextInput
              label="Year"
              type="number"
              inputMode="numeric"
              numeric
              value={draft.year}
              onChange={(event) => setDraft({ ...draft, year: event.target.value })}
            />
            <TextInput
              label="VIN or serial"
              hint="What a parts counter asks for."
              value={draft.vin}
              onChange={(event) => setDraft({ ...draft, vin: event.target.value })}
            />
            <TextInput
              label="Bought"
              type="date"
              value={draft.purchasedOn}
              onChange={(event) => setDraft({ ...draft, purchasedOn: event.target.value })}
            />
            <TextInput
              label="Paid ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={draft.purchasePrice}
              onChange={(event) => setDraft({ ...draft, purchasePrice: event.target.value })}
            />
            <TextInput
              label="Notes"
              hint="The quirk somebody else needs to know."
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              Add machine
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title="The fleet"
        description="Open a machine for its meters, its maintenance rules, its service history and its fuel."
      >
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : fleet.length === 0 ? (
          <EmptyState
            title="Nothing on the place yet"
            detail="Add the trailer and the bale buggy above. Once a machine is here it can carry meter readings and maintenance rules, and the due dates follow from those."
          />
        ) : (
          <CardGrid columns={3}>
            {[...fleet]
              .sort((left, right) => {
                // Whatever is down or overdue first — the rest is alphabetical,
                // because a fleet ordered by id is a fleet nobody can scan.
                const rank = (machine: Equipment) =>
                  machine.status === "down"
                    ? 0
                    : (dueByEquipment.get(machine.id) ?? []).some((entry) => entry.overdue)
                      ? 1
                      : 2;
                return rank(left) - rank(right) || left.name.localeCompare(right.name);
              })
              .map((machine) => {
                const hours = currentMeter(readings, machine.id, "hours");
                const miles = currentMeter(readings, machine.id, "miles");
                const due = dueByEquipment.get(machine.id) ?? [];
                const machineOverdue = due.filter((entry) => entry.overdue);

                return (
                  <RecordCard
                    key={machine.id}
                    tone={
                      machine.status === "down"
                        ? "danger"
                        : machineOverdue.length > 0
                          ? "action"
                          : machine.status === "in_service"
                            ? "calm"
                            : "neutral"
                    }
                    title={
                      <Link
                        href={`/admin/equipment/${machine.id}`}
                        className="text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
                      >
                        {machine.name}
                      </Link>
                    }
                    subtitle={describe(machine) === "" ? machine.category : describe(machine)}
                    actions={
                      <Pill tone={STATUS_TONE[machine.status]} dot={machine.status === "down"}>
                        {machine.status.replace(/_/g, " ")}
                      </Pill>
                    }
                    meta={
                      <>
                        <Pill tone="identity">{machine.category}</Pill>
                        {hours === undefined ? null : <Pill>{num(hours, 1)} hrs</Pill>}
                        {miles === undefined ? null : <Pill>{num(miles)} mi</Pill>}
                        {machineOverdue.length === 0 ? null : (
                          <Pill tone="danger" dot>
                            {machineOverdue.length} overdue
                          </Pill>
                        )}
                      </>
                    }
                  >
                    {due.length === 0 ? (
                      <p className="text-sm text-muted">
                        No maintenance rules yet. Open it to say what it needs and how often.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-sm">
                        {due.slice(0, 3).map((entry) => (
                          <li key={entry.rule.id} className="flex flex-wrap items-baseline gap-2">
                            <span className={entry.overdue ? "text-danger" : "text-ink"}>
                              {entry.rule.task}
                            </span>
                            <span className="text-muted">
                              {entry.reason === "months"
                                ? `due ${formatDate(entry.dueAt)}`
                                : entry.reason === "hours"
                                  ? `at ${num(entry.dueAtHours, 1)} hrs`
                                  : `at ${num(entry.dueAtMiles)} mi`}
                            </span>
                          </li>
                        ))}
                        {due.length > 3 ? (
                          <li className="text-muted">and {due.length - 3} more</li>
                        ) : null}
                      </ul>
                    )}

                    <div className="flex flex-wrap items-end gap-2">
                      <Select
                        label={`Status for ${machine.name}`}
                        hideLabel
                        value={machine.status}
                        onChange={(event) =>
                          void setStatus(machine, event.target.value as EquipmentStatus)
                        }
                        options={EQUIPMENT_STATUSES.map((value) => ({
                          value,
                          label: value.replace(/_/g, " "),
                        }))}
                      />
                      <Button variant="ghost" onClick={() => void remove(machine)}>
                        Delete
                      </Button>
                    </div>
                  </RecordCard>
                );
              })}
          </CardGrid>
        )}
      </Section>
    </PageBody>
  );
}
