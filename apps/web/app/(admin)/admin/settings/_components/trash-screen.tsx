"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Select,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { DEFAULT_RETENTION_DAYS, isPurgeable, type BaseRecord, type Ulid } from "@galaxy-farm/core";

import { useSyncEngine } from "@/app/_components/sync-provider";
import { LOCAL_STORES, type LocalStoreName } from "@/lib/local/store";
import { useRecords } from "@/lib/local/use-records";

/**
 * Trash (spec §4.5 clause 4).
 *
 * This screen is what makes every confirmation in the app honest. The answer
 * to "what if I misclick" is always "restore it", and that is only true if
 * there is somewhere to restore it from.
 *
 * Purge is the one action here that is not undoable, so it is owner-only and
 * Typed tier, and it is offered only for records already past the retention
 * window — purging something deleted this morning is almost always a mistake
 * being made twice.
 *
 * A row per record — its name, when and why, a chip only once it is past the
 * window — with Restore beside it, because restoring is the whole reason
 * anybody comes here and it should not be behind a second tap.
 */

/** Human labels for the store names, which are database plurals. */
const LABELS: Partial<Record<LocalStoreName, string>> = {
  animals: "Animals",
  trips: "Trips",
  zones: "Zones",
  waterSources: "Water sources",
  zoneAssignments: "Zone assignments",
  contacts: "Contacts",
  tasks: "Tasks",
  choreTemplates: "Chore templates",
  roadmapItems: "Roadmap items",
  purchaseCandidates: "Purchase candidates",
  flocks: "Flocks",
  flockAdjustments: "Headcount entries",
  eggLogs: "Egg collections",
  eggDispositions: "Egg dispositions",
  beds: "Beds",
  crops: "Crops",
  varieties: "Varieties",
  seedInventory: "Seed",
  plantings: "Plantings",
  gardenCareLogs: "Garden care log",
  harvestLogs: "Harvests",
  preservationLogs: "Pantry",
  seasonPlans: "Season plans",
  plannedPlantings: "Planned plantings",
  equipment: "Equipment",
  meterReadings: "Meter readings",
  maintenanceRules: "Maintenance rules",
  maintenanceLogs: "Service log",
  fuelLogs: "Fuel log",
  supplyItems: "Supplies",
  supplyPurchases: "Supply purchases",
  supplyUsage: "Supply usage",
  durableAssignments: "Durable assignments",
  attachments: "Attachments",
  properties: "Properties",
  brandingConfigs: "Branding",
};

interface TrashRow {
  /**
   * `label` is here for the pantry, whose records have no name and no title.
   * A jar is identified by what is written on it, and "Untitled Pantry" is
   * not a row anybody can decide whether to restore.
   */
  readonly record: BaseRecord & {
    readonly name?: string;
    readonly title?: string;
    readonly label?: string;
  };
  readonly store: LocalStoreName;
}

export function TrashScreen({
  propertyId,
  canPurge,
}: {
  readonly propertyId: Ulid;
  readonly canPurge: boolean;
}) {
  const [store, setStore] = useState<LocalStoreName>("animals");
  const { store: local } = useSyncEngine();
  const { records, loading } = useRecords<BaseRecord>(store, {
    propertyId,
    includeDeleted: true,
  });

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  const deleted = records.filter((record) => record.deletedAt !== undefined);
  const now = new Date();

  const nameOf = (record: TrashRow["record"]) =>
    record.name ?? record.title ?? record.label ?? `Untitled ${LABELS[store] ?? store}`;

  async function restore(row: TrashRow) {
    if (local === undefined) return;
    setBusy(true);
    try {
      const repository = local.repository(row.store);
      const current = await repository.findById(row.record.id);
      if (current === undefined) return;

      const revived = { ...current, updatedAt: new Date() } as Record<string, unknown>;
      delete revived["deletedAt"];
      delete revived["deletedBy"];
      delete revived["deletedReason"];

      await repository.save(revived as unknown as BaseRecord);
      show({ message: `${nameOf(row.record)} restored` });
    } finally {
      setBusy(false);
    }
  }

  async function purge(row: TrashRow) {
    const confirmed = await confirmDelete({
      tier: "typed",
      recordName: nameOf(row.record),
      entity: LABELS[row.store]?.toLowerCase() ?? row.store,
      dependents: [],
      action: "Purge",
      // The only place in the app where this sentence is true.
      consequence: "This cannot be undone. The record is removed permanently.",
    });

    if (!confirmed || local === undefined) return;

    await local.repository(row.store).purge(row.record.id);
    show({ message: `${nameOf(row.record)} purged`, tone: "danger" });
  }

  const rows = deleted.map((record) => ({ record, store }) as TrashRow);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Settings"
        title="Trash"
        subtitle={`Kept ${DEFAULT_RETENTION_DAYS} days, then purgeable${canPurge ? "" : " by the owner"}`}
      />

      <div className="max-w-xs">
        <Select
          label="Kind of record"
          options={LOCAL_STORES.map((name) => ({ value: name, label: LABELS[name] ?? name }))}
          value={store}
          onChange={(event) => setStore(event.target.value as LocalStoreName)}
        />
      </div>

      {loading ? (
        <p className="text-muted">Looking…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing deleted"
          detail={`No ${(LABELS[store] ?? store).toLowerCase()} have been deleted.`}
        />
      ) : (
        <ul
          aria-label={`Deleted ${LABELS[store] ?? store}`}
          className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
        >
          {rows.map((row) => {
            const purgeable = isPurgeable(row.record, now);
            return (
              <li key={row.record.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-semibold text-ink">{nameOf(row.record)}</span>
                  <span className="truncate text-sm text-muted">
                    Deleted {row.record.deletedAt?.toLocaleDateString() ?? "—"}
                    {row.record.deletedReason === undefined ? "" : ` · ${row.record.deletedReason}`}
                  </span>
                </span>
                {purgeable ? <Pill tone="danger">Past {DEFAULT_RETENTION_DAYS} days</Pill> : null}
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" busy={busy} onClick={() => void restore(row)}>
                    Restore
                  </Button>
                  {canPurge && purgeable ? (
                    <Button variant="ghost" onClick={() => void purge(row)}>
                      Purge
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
