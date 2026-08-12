"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Select,
  Tabs,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  displayName,
  formatMoney,
  fromDollars,
  type Animal,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";
import {
  acquisitionRecordSchema,
  animalProfitAndLoss,
  herdRollup,
  isClearForSale,
  netSaleProceeds,
  saleRecordSchema,
  TRANSACTION_TYPES,
  type AcquisitionRecord,
  type HealthRecord,
  type ProcessingRecord,
  type SaleRecord,
  type TransactionType,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * What animals cost, what they brought, and what is left (spec §5.2).
 *
 * Two things this screen refuses to do quietly.
 *
 * It will not sell an animal that is under withdrawal without saying so. The
 * clearance date is computed from the treatment (§5.2's hard flag), and a
 * screen that let somebody record a sale over the top of it would make the
 * flag decorative.
 *
 * And it marks a per-animal profit **incomplete** when a cost line has no
 * figure behind it. A home-raised calf with no feed allocation yet shows a
 * flattering number that is arithmetically right and practically misleading,
 * and the honest thing is to say which ones those are rather than to present
 * a herd total that quietly includes them.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function money(value: Money | undefined): string {
  return value === undefined ? "—" : formatMoney(value);
}

const TABS = [
  { id: "pl", label: "Profit and loss" },
  { id: "sales", label: "Sales" },
  { id: "acquisitions", label: "Acquisitions" },
] as const;

export function SalesScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: sales } = useRecords<SaleRecord>("saleRecords", query);
  const { records: acquisitions } = useRecords<AcquisitionRecord>("acquisitionRecords", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: processing } = useRecords<ProcessingRecord>("processingRecords", query);

  const now = new Date();
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  // Every animal that has a figure of any kind against it. An animal with
  // nothing recorded has no P&L worth a row — it would read as a clean zero.
  const rows = useMemo(() => {
    const touched = new Set([
      ...sales.map((s) => s.animalId),
      ...acquisitions.map((a) => a.animalId),
      ...health.filter((h) => h.cost !== undefined).map((h) => h.animalId),
      ...processing.map((p) => p.animalId),
    ]);

    return [...touched]
      .map((animalId) => animalProfitAndLoss({ animalId, acquisitions, sales, health, processing }))
      .sort((left, right) => right.net.cents - left.net.cents);
  }, [sales, acquisitions, health, processing]);

  const rollup = herdRollup(rows);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Sales and finance"
        subtitle="What each animal cost, what it brought, and which figures are still missing an input."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Animals costed" value={rollup.animals} />
        <Tile label="Total cost" value={money(rollup.totalCost)} tone="danger" />
        <Tile label="Total revenue" value={money(rollup.totalRevenue)} tone="calm" />
        <Tile
          label="Net"
          value={money(rollup.net)}
          tone={rollup.net.cents >= 0 ? "calm" : "danger"}
          emphasis
          hint={
            rollup.completeAnimals === rollup.animals
              ? "Every figure complete"
              : `${rollup.animals - rollup.completeAnimals} missing an input`
          }
        />
      </div>

      <Tabs tabs={TABS} label="Cattle finance">
        {(active) => (
          <div className="pt-density">
            {active === "pl" ? (
              <Section
                title="Per animal"
                description="A figure marked incomplete is missing a cost line — usually feed, which is apportioned in §5.3."
              >
                {rows.length === 0 ? (
                  <EmptyState
                    title="Nothing costed yet"
                    detail="Record an acquisition or a sale and the per-animal picture builds itself from what is already logged."
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-density md:grid-cols-2 xl:grid-cols-3">
                    {rows.map((row) => {
                      const animal = byId.get(row.animalId);
                      return (
                        <RecordCard
                          key={row.animalId}
                          tone={row.net.cents >= 0 ? "calm" : "danger"}
                          title={
                            animal === undefined ? (
                              "Unknown animal"
                            ) : (
                              <Link
                                href={animalHref(animal)}
                                className="underline decoration-edge underline-offset-4 hover:decoration-action"
                              >
                                {displayName(animal)}
                              </Link>
                            )
                          }
                          subtitle={`${money(row.totalRevenue)} in, ${money(row.totalCost)} out`}
                          actions={
                            <Pill tone={row.net.cents >= 0 ? "calm" : "danger"}>
                              {money(row.net)}
                            </Pill>
                          }
                          meta={
                            <>
                              {row.acquisitionCost.cents > 0 ? (
                                <Pill>bought {money(row.acquisitionCost)}</Pill>
                              ) : null}
                              {row.healthCost.cents > 0 ? (
                                <Pill>health {money(row.healthCost)}</Pill>
                              ) : null}
                              {row.feedCost.cents > 0 ? (
                                <Pill>feed {money(row.feedCost)}</Pill>
                              ) : null}
                              {row.complete ? null : (
                                <Pill tone="action" dot>
                                  incomplete
                                </Pill>
                              )}
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </Section>
            ) : active === "sales" ? (
              <SalesTab
                animals={animals}
                sales={sales}
                health={health}
                byId={byId}
                now={now}
                propertyId={propertyId}
                actorId={actorId}
              />
            ) : (
              <AcquisitionsTab
                animals={animals}
                acquisitions={acquisitions}
                byId={byId}
                propertyId={propertyId}
                actorId={actorId}
              />
            )}
          </div>
        )}
      </Tabs>
    </PageBody>
  );
}

function SalesTab({
  animals,
  sales,
  health,
  byId,
  now,
  propertyId,
  actorId,
}: {
  readonly animals: readonly Animal[];
  readonly sales: readonly SaleRecord[];
  readonly health: readonly HealthRecord[];
  readonly byId: ReadonlyMap<Ulid, Animal>;
  readonly now: Date;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<SaleRecord>(
    "saleRecords",
    "saleRecords",
    saleRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [animalId, setAnimalId] = useState("");
  const [price, setPrice] = useState("");
  const [commission, setCommission] = useState("");
  const [type, setType] = useState<TransactionType>("private");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const chosen = animals.find((entry) => entry.id === animalId);
  const clear = animalId === "" || isClearForSale(health, animalId as Ulid, now);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (animalId === "") {
      setError("Choose the animal");
      return;
    }
    if (!clear) {
      // Refused rather than warned. The withdrawal flag is the one derived
      // value here with a legal edge on it, and a screen that let somebody
      // save past it would make the flag decorative.
      setError(
        `${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal and is not clear for sale. Check the health screen.`,
      );
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        animalId: animalId as Ulid,
        date: new Date(`${date}T12:00:00`),
        price: fromDollars(Number(price)),
        type,
        ...(commission === "" ? {} : { commission: fromDollars(Number(commission)) }),
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      setPrice("");
      setCommission("");
      show({ message: "Sale recorded", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: SaleRecord) {
    const animal = byId.get(record.animalId);
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: `${money(record.price)} for ${animal === undefined ? "an animal" : displayName(animal)} on ${formatDate(record.date)}`,
      entity: "sale",
      dependents: [
        { entity: "Profit and loss", label: "for this animal", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(record.id, "Removed from the sales log");
    show({ message: "Sale deleted", tone: "danger" });
  }

  const columns: readonly Column<SaleRecord>[] = [
    {
      key: "animal",
      header: "Animal",
      primary: true,
      render: (record) => {
        const animal = byId.get(record.animalId);
        return animal === undefined ? "Unknown" : displayName(animal);
      },
    },
    { key: "date", header: "Date", render: (record) => formatDate(record.date) },
    { key: "type", header: "Sold", render: (record) => record.type.replace(/_/g, " ") },
    { key: "price", header: "Price", numeric: true, render: (record) => money(record.price) },
    {
      key: "net",
      header: "Net",
      numeric: true,
      // The number that actually landed, after the barn took its cut.
      render: (record) => money(netSaleProceeds(record)),
    },
    {
      key: "actions",
      header: "",
      render: (record) => (
        <Button variant="ghost" onClick={() => void remove(record)}>
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section title="Record a sale">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Animal"
              value={animalId}
              onChange={(event) => setAnimalId(event.target.value)}
              placeholder="Choose an animal"
              options={animals.map((entry) => ({
                value: entry.id,
                label: `${displayName(entry)}${isClearForSale(health, entry.id, now) ? "" : " · under withdrawal"}`,
              }))}
              required
            />
            <TextInput
              label="Price ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
            />
            <Select
              label="How"
              value={type}
              onChange={(event) => setType(event.target.value as TransactionType)}
              options={TRANSACTION_TYPES.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
            <TextInput
              label="Commission ($)"
              hint="What the barn took, so the net is the number that landed."
              type="number"
              inputMode="decimal"
              step="0.01"
              value={commission}
              onChange={(event) => setCommission(event.target.value)}
            />
            <TextInput
              label="Date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={busy} disabled={!clear}>
              Record sale
            </Button>
            {clear ? null : (
              <Pill tone="danger" dot>
                Under withdrawal — not clear for sale
              </Pill>
            )}
          </div>
        </form>
      </Section>

      <Section title="Every sale">
        <Card>
          <DataTable
            caption="Sales"
            columns={columns}
            rows={[...sales].sort((a, b) => b.date.getTime() - a.date.getTime())}
            rowKey={(record) => record.id}
            empty={<EmptyState title="Nothing sold yet" detail="Record a sale above." />}
          />
        </Card>
      </Section>
    </div>
  );
}

function AcquisitionsTab({
  animals,
  acquisitions,
  byId,
  propertyId,
  actorId,
}: {
  readonly animals: readonly Animal[];
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly byId: ReadonlyMap<Ulid, Animal>;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<AcquisitionRecord>(
    "acquisitionRecords",
    "acquisitionRecords",
    acquisitionRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [animalId, setAnimalId] = useState("");
  const [price, setPrice] = useState("");
  const [type, setType] = useState<TransactionType>("private");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (animalId === "") {
      setError("Choose the animal");
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        animalId: animalId as Ulid,
        date: new Date(`${date}T12:00:00`),
        price: fromDollars(Number(price)),
        type,
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      setPrice("");
      show({ message: "Acquisition recorded", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: AcquisitionRecord) {
    const animal = byId.get(record.animalId);
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: `${money(record.price)} for ${animal === undefined ? "an animal" : displayName(animal)} on ${formatDate(record.date)}`,
      entity: "acquisition",
      dependents: [
        { entity: "Profit and loss", label: "for this animal", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(record.id, "Removed from the acquisitions log");
    show({ message: "Acquisition deleted", tone: "danger" });
  }

  const columns: readonly Column<AcquisitionRecord>[] = [
    {
      key: "animal",
      header: "Animal",
      primary: true,
      render: (record) => {
        const animal = byId.get(record.animalId);
        return animal === undefined ? "Unknown" : displayName(animal);
      },
    },
    { key: "date", header: "Date", render: (record) => formatDate(record.date) },
    { key: "type", header: "Bought", render: (record) => record.type.replace(/_/g, " ") },
    { key: "price", header: "Price", numeric: true, render: (record) => money(record.price) },
    {
      key: "actions",
      header: "",
      render: (record) => (
        <Button variant="ghost" onClick={() => void remove(record)}>
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section title="Record an acquisition">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Animal"
              value={animalId}
              onChange={(event) => setAnimalId(event.target.value)}
              placeholder="Choose an animal"
              options={animals.map((entry) => ({ value: entry.id, label: displayName(entry) }))}
              required
            />
            <TextInput
              label="Price ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
            />
            <Select
              label="How"
              value={type}
              onChange={(event) => setType(event.target.value as TransactionType)}
              options={TRANSACTION_TYPES.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
            <TextInput
              label="Date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" busy={busy}>
            Record acquisition
          </Button>
        </form>
      </Section>

      <Section title="Every acquisition">
        <Card>
          <DataTable
            caption="Acquisitions"
            columns={columns}
            rows={[...acquisitions].sort((a, b) => b.date.getTime() - a.date.getTime())}
            rowKey={(record) => record.id}
            empty={
              <EmptyState
                title="Nothing bought yet"
                detail="A home-raised calf has no acquisition — its cost is feed and health, apportioned."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}
