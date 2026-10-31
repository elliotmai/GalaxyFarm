"use client";

import { useConfirmDelete, useToast } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  equipmentSchema,
  fuelLogSchema,
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

/**
 * Deleting a machine, with everything that hangs off it (spec §4.5, §5.6).
 *
 * One hook for the fleet's pencil panel and the machine page's Edit panel, so
 * the two cannot disagree about what a machine takes with it.
 *
 * **Cascade, not restrict.** A meter reading, a service entry and a tank of
 * diesel are facts about one machine and about nothing else — leaving them
 * behind would put a fuel log on the cost-of-ownership figure for a truck that
 * is no longer in the app. Every one of them is a tombstone, so the undo puts
 * the whole machine back, ledgers and all, and that is the only reason
 * cascading here is honest.
 *
 * **All at once, not one after another.** A machine with two years of history
 * is a hundred-odd records. Written one at a time, each waiting on the last,
 * the delete took nearly two seconds with the confirmation already closed and
 * nothing on screen saying why; issued together, IndexedDB queues them and they
 * land in one go. Each is its own record in its own store, so there is no
 * order among them to keep.
 */

export interface MachineLedgers {
  readonly readings: readonly MeterReading[];
  readonly rules: readonly MaintenanceRule[];
  readonly logs: readonly MaintenanceLog[];
  readonly fuel: readonly FuelLog[];
}

/** The two writes a cascade needs from a store — what `useMutations` returns. */
export interface Tombstoner {
  remove(id: Ulid, reason?: string): Promise<unknown>;
  restoreRecord(id: Ulid): Promise<unknown>;
}

/** One record to tombstone, the store that owns it, and how the dialog names it. */
export interface MachineChild {
  readonly api: Tombstoner;
  readonly id: Ulid;
  readonly entity: string;
  readonly label: string;
}

/**
 * One formatter, built once. `toLocaleDateString` with options builds a new
 * `Intl.DateTimeFormat` on every call — about a tenth of a millisecond each,
 * which on a list of a few hundred rows, dated twice a row, was most of the
 * time a save spent re-rendering the list behind its panel.
 */
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function formatDate(value: Date): string {
  return DAY.format(value);
}

function num(value: number, decimals = 0): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/**
 * Everything one machine owns, each paired with the store it lives in, so the
 * delete and the undo both walk one list.
 */
export function machineChildren(
  machineId: Ulid,
  ledgers: MachineLedgers,
  apis: {
    readonly readings: Tombstoner;
    readonly rules: Tombstoner;
    readonly logs: Tombstoner;
    readonly fuel: Tombstoner;
  },
): MachineChild[] {
  const children: MachineChild[] = [];
  for (const entry of ledgers.readings) {
    if (entry.equipmentId !== machineId) continue;
    children.push({
      api: apis.readings,
      id: entry.id,
      entity: "Meter reading",
      label: `${num(entry.value, 1)} ${entry.kind}`,
    });
  }
  for (const entry of ledgers.rules) {
    if (entry.equipmentId !== machineId) continue;
    children.push({ api: apis.rules, id: entry.id, entity: "Maintenance rule", label: entry.task });
  }
  for (const entry of ledgers.logs) {
    if (entry.equipmentId !== machineId) continue;
    children.push({
      api: apis.logs,
      id: entry.id,
      entity: "Service entry",
      label: `${entry.task}, ${formatDate(entry.performedOn)}`,
    });
  }
  for (const entry of ledgers.fuel) {
    if (entry.equipmentId !== machineId) continue;
    children.push({
      api: apis.fuel,
      id: entry.id,
      entity: "Fuel log",
      label: `${num(entry.gallons, 1)} gal, ${formatDate(entry.filledOn)}`,
    });
  }
  return children;
}

/**
 * Tombstone the children and then the machine, or restore the machine and then
 * the children. The children go together; the machine waits for them on the
 * way out and leads on the way back, so there is never a moment with a live
 * machine missing its history or live history pointing at a deleted machine
 * longer than one batch takes.
 */
export async function removeMachine(
  machine: Pick<Equipment, "id" | "name">,
  machineApi: Tombstoner,
  children: readonly MachineChild[],
): Promise<void> {
  const reason = `Deleted with ${machine.name}`;
  await Promise.all(children.map((child) => child.api.remove(child.id, reason)));
  await machineApi.remove(machine.id, "Removed from the fleet");
}

export async function restoreMachine(
  machine: Pick<Equipment, "id">,
  machineApi: Tombstoner,
  children: readonly MachineChild[],
): Promise<void> {
  await machineApi.restoreRecord(machine.id);
  await Promise.all(children.map((child) => child.api.restoreRecord(child.id)));
}

export function useMachineRemoval({
  propertyId,
  actorId,
  ledgers,
  onRemoved,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly ledgers: MachineLedgers;
  /** After the machine is gone — the machine page leaves for the fleet. */
  readonly onRemoved?: (() => void) | undefined;
}) {
  const machineApi = useMutations<Equipment>(
    "equipment",
    "equipment",
    equipmentSchema,
    propertyId,
    actorId,
  );
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

  return async function remove(machine: Equipment): Promise<void> {
    const children = machineChildren(machine.id, ledgers, {
      readings: readingsApi,
      rules: rulesApi,
      logs: logsApi,
      fuel: fuelApi,
    });

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

    await removeMachine(machine, machineApi, children);
    onRemoved?.();

    show({
      message: `${machine.name} deleted`,
      tone: "danger",
      action: {
        label: "Undo",
        onAct: () => void restoreMachine(machine, machineApi, children),
      },
    });
  };
}
