"use client";

import { useId, useState } from "react";
import Link from "next/link";

import {
  Button,
  EmptyState,
  Modal,
  PageBody,
  Pill,
  Select,
  TextInput,
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

import { AddFab, ChipRow, FilteredLine, KitHeader, KitList, KitRow } from "./kit-controls";

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
 * page to open: a row per machine with its next job on the muted line, and
 * one chip only when something is wrong. Adding a machine is a side panel, so
 * the form never pushes the fleet down the page.
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

const STATUS_OPTIONS = EQUIPMENT_STATUSES.map((value) => ({
  value,
  label: value.replace(/_/g, " "),
}));

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
  const [creating, setCreating] = useState(false);
  /** The machine whose status-and-delete panel is open. */
  const [managing, setManaging] = useState<Equipment | undefined>();
  /** The chip that is on: a status, "overdue", "gone", or "" for the lot. */
  const [view, setView] = useState("");
  const formId = useId();

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

  function startCreate() {
    reset();
    setCreating(true);
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
      setCreating(false);
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

  /** The one line under a name: what it is, what the meters read, what is next. */
  function lineFor(machine: Equipment): string {
    const hours = currentMeter(readings, machine.id, "hours");
    const miles = currentMeter(readings, machine.id, "miles");
    const next = (dueByEquipment.get(machine.id) ?? [])[0];
    return [
      describe(machine) === "" ? machine.category : describe(machine),
      hours === undefined ? undefined : `${num(hours, 1)} hrs`,
      miles === undefined ? undefined : `${num(miles)} mi`,
      next === undefined ? "No rules yet" : `${next.rule.task} ${dueWhen(next)}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" · ");
  }

  /**
   * The one chip: down before overdue before anything else, because a machine
   * that will not start is the news even when its oil is also late. A machine
   * in service with nothing late says nothing — a row of green is not read.
   */
  function chipFor(machine: Equipment) {
    const late = (dueByEquipment.get(machine.id) ?? []).filter((entry) => entry.overdue).length;
    if (machine.status === "down")
      return (
        <Pill tone="danger" dot>
          Down
        </Pill>
      );
    if (machine.status !== "in_service")
      return <Pill tone={STATUS_TONE[machine.status]}>{machine.status.replace(/_/g, " ")}</Pill>;
    if (late > 0)
      return (
        <Pill tone="danger" dot>
          {late} overdue
        </Pill>
      );
    return null;
  }

  const isOverdue = (machine: Equipment) =>
    (dueByEquipment.get(machine.id) ?? []).some((entry) => entry.overdue);

  const chips = [
    { key: "", label: "All", count: fleet.length },
    { key: "in_service", label: "In service", count: running.length },
    { key: "down", label: "Down", count: down.length },
    { key: "overdue", label: "Overdue", count: fleet.filter(isOverdue).length },
    {
      key: "gone",
      label: "Sold or retired",
      count: fleet.filter((machine) => machine.status === "sold" || machine.status === "retired")
        .length,
    },
  ].filter((chip) => chip.key === "" || chip.count > 0 || chip.key === view);

  const shown = [...fleet]
    .filter((machine) =>
      view === ""
        ? true
        : view === "overdue"
          ? isOverdue(machine)
          : view === "gone"
            ? machine.status === "sold" || machine.status === "retired"
            : machine.status === view,
    )
    .sort((left, right) => {
      // Whatever is down or overdue first — the rest is alphabetical,
      // because a fleet ordered by id is a fleet nobody can scan.
      const rank = (machine: Equipment) =>
        machine.status === "down" ? 0 : isOverdue(machine) ? 1 : 2;
      return rank(left) - rank(right) || left.name.localeCompare(right.name);
    });

  /** Facts beside the title — the old tiles, said once and only when not zero. */
  const facts = [
    `${fleet.length} machine${fleet.length === 1 ? "" : "s"}`,
    down.length > 0 ? `${down.length} down` : undefined,
    overdue.length > 0 ? `${overdue.length} overdue` : undefined,
    spend.cents > 0 ? `${formatMoney(spend)} fuel and service` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  const addButton = (
    <Button variant="primary" onClick={startCreate}>
      <span aria-hidden="true">+</span> Add machine
    </Button>
  );

  return (
    // Bottom clearance on a phone, so the floating add button and the tab bar
    // under it never sit on top of the last row.
    <PageBody>
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader
          eyebrow="Kit"
          title="Equipment"
          facts={loading ? undefined : facts}
          action={addButton}
        />

        {/*
          What is late, one line a job, each the way to the machine. The tiles
          and the callout this replaces said the same thing three times; the
          trigger that fired stays, because "overdue" with no reason is a badge
          people learn to scroll past.
        */}
        {overdue.length === 0 ? null : (
          <ul aria-label="Overdue service" className="flex flex-col text-sm">
            {overdue.slice(0, 4).map(({ equipmentId, entry }) => {
              const machine = fleet.find((item) => item.id === equipmentId);
              return (
                <li key={entry.rule.id}>
                  <Link
                    href={`/admin/equipment/${equipmentId}`}
                    className="inline-flex min-h-target items-center text-danger underline-offset-2 hover:underline"
                  >
                    {machine?.name ?? "A machine"} — {entry.rule.task} (on {entry.reason})
                  </Link>
                </li>
              );
            })}
            {overdue.length > 4 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setView("overdue")}
                  className="inline-flex min-h-target items-center font-semibold text-danger underline underline-offset-2"
                >
                  and {overdue.length - 4} more
                </button>
              </li>
            ) : null}
          </ul>
        )}

        {fleet.length === 0 ? null : (
          <ChipRow label="Filter the fleet" chips={chips} value={view} onChange={setView} />
        )}

        <FilteredLine
          shown={shown.length}
          total={fleet.length}
          parts={view === "" ? [] : [chips.find((chip) => chip.key === view)?.label ?? view]}
          onClear={() => setView("")}
        />

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : fleet.length === 0 ? (
          <EmptyState
            title="Nothing on the place yet"
            detail="Once a machine is here it can carry meter readings and maintenance rules, and the due dates follow from those."
            action={
              <Button variant="primary" onClick={startCreate}>
                Add the first machine
              </Button>
            }
          />
        ) : (
          <KitList label="The fleet">
            {shown.map((machine) => (
              <KitRow
                key={machine.id}
                title={machine.name}
                href={`/admin/equipment/${machine.id}`}
                line={lineFor(machine)}
                chip={chipFor(machine)}
                onEdit={() => setManaging(machine)}
                editLabel={`Status or delete ${machine.name}`}
              />
            ))}
          </KitList>
        )}

        <AddFab label="Add machine" onClick={startCreate} />
      </div>

      {creating ? (
        <Modal
          title="Add a machine"
          placement="side"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button type="submit" form={formId} variant="primary" busy={busy}>
                Add machine
              </Button>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-density sm:grid sm:grid-cols-2"
          >
            <TextInput
              label="Name"
              hint="What it is called in the barn, not its model number."
              className="sm:col-span-2"
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
              options={STATUS_OPTIONS}
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
              className="sm:col-span-2"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger sm:col-span-2">
                {error}
              </p>
            )}
          </form>
        </Modal>
      ) : null}

      {/*
        Status and delete, which used to sit on every card. A status change is
        the only edit the fleet list makes — everything else about a machine is
        on its own page — so the panel is small, and the delete closes it first
        so the typed confirmation is the only dialog on screen.
      */}
      {managing === undefined ? null : (
        <Modal
          title={managing.name}
          description={describe(managing) === "" ? managing.category : describe(managing)}
          placement="side"
          onClose={() => setManaging(undefined)}
          footer={
            <>
              <Button onClick={() => setManaging(undefined)}>Done</Button>
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  const machine = managing;
                  setManaging(undefined);
                  void remove(machine);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <Select
            label={`Status for ${managing.name}`}
            value={managing.status}
            onChange={(event) => {
              const status = event.target.value as EquipmentStatus;
              void setStatus(managing, status);
              setManaging({ ...managing, status });
            }}
            options={STATUS_OPTIONS}
          />
          <Link
            href={`/admin/equipment/${managing.id}`}
            className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
          >
            Meters, rules, service and fuel →
          </Link>
        </Modal>
      )}
    </PageBody>
  );
}

function dueWhen(entry: ReturnType<typeof maintenanceDue>[number]): string {
  return entry.reason === "months"
    ? `due ${formatDate(entry.dueAt)}`
    : entry.reason === "hours"
      ? `at ${num(entry.dueAtHours, 1)} hrs`
      : `at ${num(entry.dueAtMiles)} mi`;
}
