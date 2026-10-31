"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Tabs,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { formatMoney, type Ulid } from "@galaxy-farm/core";
import {
  costOfOwnership,
  currentMeter,
  fuelEfficiency,
  fuelLogSchema,
  maintenanceDue,
  maintenanceLogSchema,
  maintenanceRuleSchema,
  meterReadingSchema,
  type Equipment,
  type FuelLog,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { formatDate, line, meterAt, num } from "./equipment-format";
import { MachineForm } from "../../_components/machine-form";
import { useMachineRemoval } from "../../_components/machine-removal";
import { FuelForm, MeterForm, RuleForm, ServiceForm } from "./equipment-forms";
import { DetailsTab, FuelTab, MaintenanceTab, MetersTab, ServiceTab } from "./equipment-ledgers";

/**
 * One machine (spec §5.6, §7's `/admin/equipment/[id]`).
 *
 * Four ledgers and a record. The meters are the ones that matter, because
 * everything else derives from them: a rule that triggers on hours cannot come
 * due until somebody writes down what the hour meter says, so a machine with
 * rules and no readings is a machine with no maintenance schedule at all. The
 * meter tab says so rather than showing an empty table.
 *
 * Cost of ownership is fuel plus service, per §6, and is deliberately *not*
 * the purchase price plus those. What a truck cost to buy is a fact about the
 * year you bought it; what it costs to run is the number that decides whether
 * to keep running it.
 *
 * This file is the frame: the header, what is overdue, the tabs, and which
 * side panel is open. The tabs are lists (`equipment-ledgers.tsx`) and every
 * add and edit is a panel (`equipment-forms.tsx`, and the fleet's own
 * `machine-form.tsx` for the machine itself, Delete included), so no form ever
 * pushes the ledger it writes to down the page.
 */

const TABS = [
  { id: "meters", label: "Meters" },
  { id: "maintenance", label: "Maintenance" },
  { id: "service", label: "Service log" },
  { id: "fuel", label: "Fuel" },
  { id: "details", label: "Details" },
] as const;

/** Which side panel is open, and on what. One at a time, by construction. */
type Panel =
  | { readonly kind: "meter"; readonly editing?: MeterReading }
  | { readonly kind: "rule"; readonly editing?: MaintenanceRule }
  | {
      readonly kind: "service";
      readonly editing?: MaintenanceLog;
      /** Set by "Record this job" on a rule, read once by the form. */
      readonly prefill?: MaintenanceRule;
    }
  | { readonly kind: "fuel"; readonly editing?: FuelLog }
  | { readonly kind: "machine" };

export function EquipmentScreen({
  equipmentId,
  propertyId,
  actorId,
}: {
  readonly equipmentId: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: fleet, loading } = useRecords<Equipment>("equipment", query);
  const { records: allReadings } = useRecords<MeterReading>("meterReadings", query);
  const { records: allRules } = useRecords<MaintenanceRule>("maintenanceRules", query);
  const { records: allLogs } = useRecords<MaintenanceLog>("maintenanceLogs", query);
  const { records: allFuel } = useRecords<FuelLog>("fuelLogs", query);

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
  const router = useRouter();

  const [tab, setTab] = useState<string>("meters");
  const [panel, setPanel] = useState<Panel | undefined>();

  const machine = fleet.find((entry) => entry.id === equipmentId);

  const readings = useMemo(
    () => allReadings.filter((entry) => entry.equipmentId === equipmentId),
    [allReadings, equipmentId],
  );
  const rules = useMemo(
    () => allRules.filter((entry) => entry.equipmentId === equipmentId),
    [allRules, equipmentId],
  );
  const logs = useMemo(
    () => allLogs.filter((entry) => entry.equipmentId === equipmentId),
    [allLogs, equipmentId],
  );
  const fuel = useMemo(
    () => allFuel.filter((entry) => entry.equipmentId === equipmentId),
    [allFuel, equipmentId],
  );

  // Deleting the machine takes its ledgers with it — the same cascade as the
  // fleet's — and then there is no page left to be on, so it goes back there.
  const confirmRemoveMachine = useMachineRemoval({
    propertyId,
    actorId,
    ledgers: { readings, rules, logs, fuel },
    onRemoved: () => router.push("/admin/equipment"),
  });

  if (loading) return <p className="text-muted">Looking…</p>;

  if (machine === undefined) {
    return (
      <PageBody>
        <EmptyState
          title="No machine here"
          detail="Nothing on this device has that id. It may have been deleted — deleted records are restorable from Trash for thirty days."
          action={
            <Link href="/admin/equipment" className="text-action underline">
              Back to the fleet
            </Link>
          }
        />
      </PageBody>
    );
  }

  const now = new Date();
  const hours = currentMeter(readings, machine.id, "hours");
  const miles = currentMeter(readings, machine.id, "miles");
  const due = maintenanceDue(rules, logs, readings, now);
  const overdue = due.filter((entry) => entry.overdue);
  const mpg = fuelEfficiency(fuel, machine.id);
  const running = costOfOwnership(machine.id, logs, fuel);

  const close = () => setPanel(undefined);

  /**
   * Delete from inside a panel. The panel closes first, so the confirmation is
   * the only dialog on screen rather than a second one stacked on the form.
   */
  function deleteFrom<T>(entry: T | undefined, run: (entry: T) => Promise<void>) {
    return entry === undefined
      ? undefined
      : () => {
          close();
          void run(entry);
        };
  }

  async function removeReading(reading: MeterReading) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${num(reading.value, 1)} ${reading.kind} on ${formatDate(reading.readOn)}`,
      entity: "meter reading",
      dependents: [{ entity: "Maintenance due", label: "recomputed", effect: "deleted" as const }],
      consequence:
        "The latest reading is what every hours or miles rule measures against. Deleting this one moves them back to the reading before it.",
    });
    if (!confirmed) return;

    await readingsApi.remove(reading.id, "Removed from the meter log");
    show({
      message: "Reading deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void readingsApi.restoreRecord(reading.id) },
    });
  }

  async function removeRule(rule: MaintenanceRule) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: rule.task,
      entity: "maintenance rule",
      dependents: [],
      // The history is what the money and the resale conversation are made of.
      consequence:
        "The service already recorded against it stays. Only the rule that keeps asking goes.",
    });
    if (!confirmed) return;

    await rulesApi.remove(rule.id, "Removed from the maintenance rules");
    show({
      message: "Rule deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void rulesApi.restoreRecord(rule.id) },
    });
  }

  async function removeLog(log: MaintenanceLog) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${log.task} on ${formatDate(log.performedOn)}`,
      entity: "service entry",
      dependents: [
        { entity: "Cost of ownership", label: "recomputed", effect: "deleted" as const },
        ...(log.ruleId === undefined
          ? []
          : [{ entity: "Next service due", label: "recomputed", effect: "deleted" as const }]),
      ],
      consequence:
        log.ruleId === undefined
          ? undefined
          : "Its rule measures the next interval from the most recent entry. Deleting this one moves that back to the entry before it.",
      action: "Delete",
    });
    if (!confirmed) return;

    await logsApi.remove(log.id, "Removed from the service log");
    show({
      message: "Entry deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void logsApi.restoreRecord(log.id) },
    });
  }

  async function removeFill(log: FuelLog) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${num(log.gallons, 1)} gal on ${formatDate(log.filledOn)}`,
      entity: "fuel entry",
      dependents: [
        { entity: "Cost of ownership", label: "recomputed", effect: "deleted" as const },
        { entity: "Miles per gallon", label: "recomputed", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await fuelApi.remove(log.id, "Removed from the fuel log");
    show({
      message: "Fill deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void fuelApi.restoreRecord(log.id) },
    });
  }

  /**
   * "Record this job", from a rule that is due.
   *
   * Opens the service panel with the rule as its opening state, wherever the
   * button was — the overdue line, a rule's row, a rule's own panel — so it no
   * longer has to move you to the service tab to do it.
   */
  const record = (rule: MaintenanceRule) => setPanel({ kind: "service", prefill: rule });
  const recordFrom = (rule: MaintenanceRule | undefined) =>
    rule === undefined ? undefined : () => record(rule);

  const common = { machine, propertyId, actorId, onClose: close };

  /** The tiles, said once as facts: only what has been written down. */
  const facts = line(
    meterAt(hours, miles),
    running.cents > 0 ? `${formatMoney(running)} to run` : undefined,
    mpg === undefined ? undefined : `${num(mpg, 1)} mpg`,
  );

  return (
    <PageBody>
      <PageHeader
        // Plain words, not a link: the way back is the layout's Back, above
        // every page, and a second one here only disagreed with it.
        eyebrow="Farm"
        title={machine.name}
        subtitle={line(
          [machine.year, machine.make, machine.model].filter(Boolean).join(" "),
          machine.category,
          machine.vin === undefined ? undefined : `#${machine.vin}`,
        )}
        actions={<Button onClick={() => setPanel({ kind: "machine" })}>Edit</Button>}
        meta={
          facts === "" && machine.status === "in_service" ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {/* In service is the normal state and says nothing; anything else
                  is the first thing about the machine. */}
              {machine.status === "in_service" ? null : (
                <Pill tone="danger" dot={machine.status === "down"}>
                  {machine.status.replace(/_/g, " ")}
                </Pill>
              )}
              {facts === "" ? null : <span className="text-sm text-muted">{facts}</span>}
            </span>
          )
        }
      />

      {/*
        What is late, one line a job, each with the way to record it. Recording
        the work resets the interval from the meter entered with it, which is
        why the button opens the service panel and not the rule.
      */}
      {overdue.length === 0 ? null : (
        <ul aria-label="Overdue service" className="flex flex-col text-sm">
          {overdue.map((entry) => (
            <li key={entry.rule.id} className="flex flex-wrap items-center gap-x-2">
              <span className="text-danger">
                Overdue: {entry.rule.task} (on {entry.reason})
              </span>
              <button
                type="button"
                onClick={() => record(entry.rule)}
                className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
              >
                Record it
              </button>
            </li>
          ))}
        </ul>
      )}

      <Tabs tabs={TABS} label="This machine" activeTab={tab} onTabChange={setTab}>
        {(active) =>
          active === "meters" ? (
            <MetersTab
              machine={machine}
              readings={readings}
              rules={rules}
              onAdd={() => setPanel({ kind: "meter" })}
              onEdit={(editing) => setPanel({ kind: "meter", editing })}
            />
          ) : active === "maintenance" ? (
            <MaintenanceTab
              rules={rules}
              due={due}
              readings={readings}
              onAdd={() => setPanel({ kind: "rule" })}
              onEdit={(editing) => setPanel({ kind: "rule", editing })}
              onRecord={record}
            />
          ) : active === "service" ? (
            <ServiceTab
              machine={machine}
              rules={rules}
              logs={logs}
              onAdd={() => setPanel({ kind: "service" })}
              onEdit={(editing) => setPanel({ kind: "service", editing })}
            />
          ) : active === "fuel" ? (
            <FuelTab
              machine={machine}
              fuel={fuel}
              onAdd={() => setPanel({ kind: "fuel" })}
              onEdit={(editing) => setPanel({ kind: "fuel", editing })}
            />
          ) : (
            <DetailsTab machine={machine} onEdit={() => setPanel({ kind: "machine" })} />
          )
        }
      </Tabs>

      {panel?.kind === "meter" ? (
        <MeterForm
          key={panel.editing?.id ?? "new"}
          {...common}
          readings={readings}
          editing={panel.editing}
          onDelete={deleteFrom(panel.editing, removeReading)}
        />
      ) : panel?.kind === "rule" ? (
        <RuleForm
          key={panel.editing?.id ?? "new"}
          {...common}
          editing={panel.editing}
          onDelete={deleteFrom(panel.editing, removeRule)}
          onRecord={recordFrom(panel.editing)}
        />
      ) : panel?.kind === "service" ? (
        <ServiceForm
          key={panel.editing?.id ?? panel.prefill?.id ?? "new"}
          {...common}
          rules={rules}
          hours={hours}
          miles={miles}
          editing={panel.editing}
          prefill={panel.prefill}
          onDelete={deleteFrom(panel.editing, removeLog)}
        />
      ) : panel?.kind === "fuel" ? (
        <FuelForm
          key={panel.editing?.id ?? "new"}
          {...common}
          hours={hours}
          miles={miles}
          editing={panel.editing}
          onDelete={deleteFrom(panel.editing, removeFill)}
        />
      ) : panel?.kind === "machine" ? (
        <MachineForm
          machine={machine}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={() => {
            close();
            void confirmRemoveMachine(machine);
          }}
        />
      ) : null}
    </PageBody>
  );
}
