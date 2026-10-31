"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, EmptyState, PageBody, Pill, useToast } from "@galaxy-farm/ui";
import { formatMoney, type Money, type Ulid } from "@galaxy-farm/core";
import {
  latestReadings,
  maintenanceDue,
  meterKey,
  type Equipment,
  type EquipmentStatus,
  type FuelLog,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "@galaxy-farm/module-equipment";

import { useRecords } from "@/lib/local/use-records";

import { AddFab, ChipRow, FilteredLine, KitHeader, KitList, KitRow } from "./kit-controls";
import { MachineForm } from "./machine-form";
import { useMachineRemoval } from "./machine-removal";

/**
 * One formatter, built once. `toLocaleDateString` with options builds a new
 * `Intl.DateTimeFormat` on every call — about a tenth of a millisecond each,
 * which on a list of a few hundred rows, dated twice a row, was most of the
 * time a save spent re-rendering the list behind its panel.
 */
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

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
 * one chip only when something is wrong. Adding a machine, and the pencil on a
 * row, open the same side panel (`machine-form.tsx`) — every field, the status,
 * and Delete — so the form never pushes the fleet down the page and nothing
 * about a machine needs its page opened first to change.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined ? "—" : DAY.format(value);
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

  const router = useRouter();
  const { show } = useToast();

  /** Which side panel is open: adding a machine, or editing one. */
  const [panel, setPanel] = useState<
    { readonly kind: "add" } | { readonly kind: "edit"; readonly machine: Equipment } | undefined
  >();
  /** The chip that is on: a status, "overdue", "gone", or "" for the lot. */
  const [view, setView] = useState("");

  // Asks first — the typed confirmation lives in the hook — then cascades.
  const confirmRemoveMachine = useMachineRemoval({
    propertyId,
    actorId,
    ledgers: { readings, rules, logs, fuel },
  });

  const now = new Date();

  /**
   * What is due, per machine, and what each meter last read.
   *
   * Computed over the whole fleet in one pass and grouped afterwards rather
   * than per row: `maintenanceDue` indexes the meter history once for every
   * rule it is given, and asking per machine would index it per machine. The
   * meters are indexed once here too, for the muted lines, instead of each row
   * filtering and sorting the whole reading history for its own two numbers.
   *
   * Memoised on the ledgers, with the day as part of the key — "due" is a
   * date comparison, so it has to move at midnight but not on every render.
   * Typing in the add panel no longer re-renders this screen at all, since the
   * panel keeps its own draft.
   */
  const day = now.toDateString();
  const dueByEquipment = useMemo(() => {
    const grouped = new Map<Ulid, ReturnType<typeof maintenanceDue>>();
    for (const entry of maintenanceDue(rules, logs, readings, new Date())) {
      const held = grouped.get(entry.rule.equipmentId);
      if (held === undefined) grouped.set(entry.rule.equipmentId, [entry]);
      else held.push(entry);
    }
    return grouped;
    // `day` is the clock's part in this: recompute when the date turns over.
  }, [rules, logs, readings, day]);
  const meters = useMemo(() => latestReadings(readings), [readings]);

  const overdue = [...dueByEquipment.entries()].flatMap(([equipmentId, entries]) =>
    entries.filter((entry) => entry.overdue).map((entry) => ({ equipmentId, entry })),
  );

  const running = fleet.filter((machine) => machine.status === "in_service");
  const down = fleet.filter((machine) => machine.status === "down");

  // Fuel and service across every machine still on the books — one pass over
  // each ledger rather than `costOfOwnership` once per machine, which walked
  // both ledgers end to end for every row.
  const spend: Money = useMemo(() => {
    const live = new Set(fleet.map((machine) => machine.id));
    let cents = 0;
    for (const log of logs) if (live.has(log.equipmentId)) cents += log.cost?.cents ?? 0;
    for (const log of fuel) if (live.has(log.equipmentId)) cents += log.cost?.cents ?? 0;
    return { cents };
  }, [fleet, logs, fuel]);

  const startCreate = () => setPanel({ kind: "add" });

  /** The one line under a name: what it is, what the meters read, what is next. */
  function lineFor(machine: Equipment): string {
    const hours = meters.get(meterKey(machine.id, "hours"))?.value;
    const miles = meters.get(meterKey(machine.id, "miles"))?.value;
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
          eyebrow="Farm"
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
                onEdit={() => setPanel({ kind: "edit", machine })}
                editLabel={`Edit ${machine.name}`}
              />
            ))}
          </KitList>
        )}

        <AddFab label="Add machine" onClick={startCreate} />
      </div>

      {panel?.kind === "add" ? (
        <MachineForm
          key="new"
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setPanel(undefined)}
          onCreated={(created) =>
            show({
              message: `${created.name} added`,
              action: {
                label: "Open it",
                onAct: () => router.push(`/admin/equipment/${created.id}`),
              },
            })
          }
        />
      ) : panel?.kind === "edit" ? (
        <MachineForm
          key={panel.machine.id}
          machine={panel.machine}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setPanel(undefined)}
          // The panel closes first, so the typed confirmation is the only
          // dialog on screen.
          onDelete={() => {
            const machine = panel.machine;
            setPanel(undefined);
            void confirmRemoveMachine(machine);
          }}
        />
      ) : null}
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
