"use client";

import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Select,
  useConfirmDelete,
  useToast,
  type Column,
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
 */

/** Human labels for the store names, which are database plurals. */
const LABELS: Partial<Record<LocalStoreName, string>> = {
  animals: "Animals",
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
  readonly record: BaseRecord & { readonly name?: string; readonly title?: string };
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
    record.name ?? record.title ?? `Untitled ${LABELS[store] ?? store}`;

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

  const columns: readonly Column<TrashRow>[] = [
    { key: "name", header: "Record", render: (row) => nameOf(row.record) },
    {
      key: "deletedAt",
      header: "Deleted",
      render: (row) => row.record.deletedAt?.toLocaleDateString() ?? "—",
    },
    {
      key: "reason",
      header: "Why",
      render: (row) => row.record.deletedReason ?? <span className="text-muted">Not given</span>,
    },
    {
      key: "retention",
      header: "Retention",
      render: (row) =>
        isPurgeable(row.record, now) ? (
          <Badge tone="danger">Past {DEFAULT_RETENTION_DAYS} days</Badge>
        ) : (
          <Badge tone="calm">Kept</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" busy={busy} onClick={() => void restore(row)}>
            Restore
          </Button>
          {canPurge && isPurgeable(row.record, now) ? (
            <Button variant="ghost" onClick={() => void purge(row)}>
              Purge
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <header className="flex flex-wrap items-center justify-between gap-density">
        <h1 className="text-ink">Trash</h1>
        <Select
          label="Kind of record"
          options={LOCAL_STORES.map((name) => ({ value: name, label: LABELS[name] ?? name }))}
          value={store}
          onChange={(event) => setStore(event.target.value as LocalStoreName)}
        />
      </header>

      <p className="max-w-prose text-sm text-muted">
        Deleted records are kept for {DEFAULT_RETENTION_DAYS} days and can be restored at any point
        before that. Purging is permanent and only offered once the window has passed
        {canPurge ? "" : ", and only to the owner"}.
      </p>

      <Card>
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <DataTable
            caption={`Deleted ${LABELS[store] ?? store}`}
            columns={columns}
            rows={deleted.map((record) => ({ record, store }) as TrashRow)}
            rowKey={(row) => row.record.id}
            empty={
              <EmptyState
                title="Nothing deleted"
                detail={`No ${(LABELS[store] ?? store).toLowerCase()} have been deleted.`}
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
