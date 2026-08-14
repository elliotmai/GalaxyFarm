"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  Checkbox,
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
  animalsUnderWithdrawal,
  dressingPercentage,
  herdRollup,
  isClearForSale,
  netSaleProceeds,
  processingRecordSchema,
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

function lb(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value)} lb`;
}

const TABS = [
  { id: "pl", label: "Profit and loss" },
  { id: "sales", label: "Sales" },
  { id: "acquisitions", label: "Acquisitions" },
  { id: "processing", label: "Processing" },
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
  // Every animal on the place, for reading a record back. One Animal model
  // serves every species (§2), so a row written before an animal changed hands
  // still finds its name here whatever it is.
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  // What the pickers below offer. This is a cattle screen, and an unfiltered
  // list puts the hens and the dogs in the dropdown that books a steer to the
  // processor — the same rule the breeding and calving pickers already keep.
  const cattle = useMemo(() => animals.filter((a) => a.species === "cattle"), [animals]);

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
                cattle={cattle}
                sales={sales}
                health={health}
                byId={byId}
                now={now}
                propertyId={propertyId}
                actorId={actorId}
              />
            ) : active === "acquisitions" ? (
              <AcquisitionsTab
                cattle={cattle}
                acquisitions={acquisitions}
                byId={byId}
                propertyId={propertyId}
                actorId={actorId}
              />
            ) : (
              <ProcessingTab
                cattle={cattle}
                processing={processing}
                health={health}
                byId={byId}
                now={now}
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
  cattle,
  sales,
  health,
  byId,
  now,
  propertyId,
  actorId,
}: {
  /** The herd, already narrowed to cattle — never the whole menagerie. */
  readonly cattle: readonly Animal[];
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
  /**
   * The override (#17).
   *
   * A withdrawal bars an animal from the *food chain*, not from every sale —
   * a bred heifer sold private treaty to another producer during one is legal
   * and ordinary. So the block is a block until somebody says otherwise in
   * writing, and what they say is stored on the record: "why" is required,
   * because a sale that gets questioned later is questioned about the reason
   * and not about the checkbox.
   */
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const chosen = cattle.find((entry) => entry.id === animalId);
  const clear = animalId === "" || isClearForSale(health, animalId as Ulid, now);
  const withdrawal =
    animalId === ""
      ? undefined
      : animalsUnderWithdrawal(health, now).find((entry) => entry.animalId === animalId);
  const blocked = !clear && !(override && overrideReason.trim() !== "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (animalId === "") {
      setError("Choose the animal");
      return;
    }
    if (blocked) {
      // Not a warning that scrolls past. The withdrawal flag is the one
      // derived value here with a legal edge on it, and a screen that let
      // somebody save straight past it would make the flag decorative.
      setError(
        `${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal and is not clear for slaughter. To sell it anyway, tick the override and say why.`,
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
        // The override lands in the notes rather than in a boolean nobody
        // reads. A year from now the question will be "why was she sold on the
        // ninth", and the answer has to be in the record.
        ...(clear || !override
          ? {}
          : {
              notes: `Sold under withdrawal (clears ${formatDate(withdrawal?.clearsOn)}). ${overrideReason.trim()}`,
            }),
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
      setOverride(false);
      setOverrideReason("");
      show({
        message: clear ? "Sale recorded" : "Sale recorded under a withdrawal override",
        tone: clear ? "success" : "warning",
      });
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
              options={cattle.map((entry) => ({
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

          {clear ? null : (
            <Callout
              tone="danger"
              title={`${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal${withdrawal === undefined ? "" : ` until ${formatDate(withdrawal.clearsOn)}`}`}
            >
              <div className="flex flex-col gap-density pt-2">
                <p>
                  It must not enter the food chain before that date. A sale to another producer is a
                  different matter — if that is what this is, say so and it goes on the record.
                </p>
                <Checkbox
                  label="Sell it anyway"
                  checked={override}
                  onChange={(event) => setOverride(event.target.checked)}
                />
                {override ? (
                  <TextInput
                    label="Why this is not a slaughter sale"
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    required
                  />
                ) : null}
              </div>
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={busy} disabled={blocked}>
              {clear ? "Record sale" : "Record sale under override"}
            </Button>
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
  cattle,
  acquisitions,
  byId,
  propertyId,
  actorId,
}: {
  /** The herd, already narrowed to cattle — never the whole menagerie. */
  readonly cattle: readonly Animal[];
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
              options={cattle.map((entry) => ({ value: entry.id, label: displayName(entry) }))}
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

/**
 * The packer (spec §5.2, issue #17).
 *
 * Dressing percentage is the number this record exists for — hanging weight
 * over live weight is how you find out whether an animal that looked good
 * actually was.
 *
 * The withdrawal gate here is the serious one. A sale can be to another
 * producer; delivery to a processor is the food chain by definition, and an
 * animal delivered inside a withdrawal is a residue violation rather than a
 * data-quality annoyance. The override exists because custom-exempt harvest
 * for the owner's own freezer is a real case — but it is typed, not ticked,
 * and what gets typed goes on the record.
 */
function ProcessingTab({
  cattle,
  processing,
  health,
  byId,
  now,
  propertyId,
  actorId,
}: {
  /** The herd, already narrowed to cattle — never the whole menagerie. */
  readonly cattle: readonly Animal[];
  readonly processing: readonly ProcessingRecord[];
  readonly health: readonly HealthRecord[];
  readonly byId: ReadonlyMap<Ulid, Animal>;
  readonly now: Date;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<ProcessingRecord>(
    "processingRecords",
    "processingRecords",
    processingRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [animalId, setAnimalId] = useState("");
  const [delivered, setDelivered] = useState(() => new Date().toISOString().slice(0, 10));
  const [live, setLive] = useState("");
  const [hanging, setHanging] = useState("");
  const [cost, setCost] = useState("");
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const chosen = cattle.find((entry) => entry.id === animalId);
  const clear = animalId === "" || isClearForSale(health, animalId as Ulid, now);
  const withdrawal =
    animalId === ""
      ? undefined
      : animalsUnderWithdrawal(health, now).find((entry) => entry.animalId === animalId);
  const blocked = !clear && override.trim() === "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (animalId === "") {
      setError("Choose the animal");
      return;
    }
    if (blocked) {
      setError(
        `${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal and must not enter the food chain until ${formatDate(withdrawal?.clearsOn)}.`,
      );
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        animalId: animalId as Ulid,
        deliveredOn: new Date(`${delivered}T12:00:00`),
        ...(live === "" ? {} : { liveScaleWeightLb: Number(live) }),
        ...(hanging === "" ? {} : { hangingWeightLb: Number(hanging) }),
        ...(cost === "" ? {} : { processingCost: fromDollars(Number(cost)) }),
        cutLines: [],
        ...(clear
          ? {}
          : {
              notes: `Delivered under withdrawal (clears ${formatDate(withdrawal?.clearsOn)}). ${override.trim()}`,
            }),
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      setLive("");
      setHanging("");
      setCost("");
      setOverride("");
      show({
        message: clear ? "Delivery recorded" : "Delivery recorded under a withdrawal override",
        tone: clear ? "success" : "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: ProcessingRecord) {
    const animal = byId.get(record.animalId);
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: `${animal === undefined ? "an animal" : displayName(animal)} delivered ${formatDate(record.deliveredOn)}`,
      entity: "processing record",
      dependents: [
        { entity: "Profit and loss", label: "for this animal", effect: "deleted" as const },
        { entity: "Dressing percentage", label: "cannot be computed", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(record.id, "Removed from the processing records");
    show({ message: "Processing record deleted", tone: "danger" });
  }

  const columns: readonly Column<ProcessingRecord>[] = [
    {
      key: "animal",
      header: "Animal",
      primary: true,
      render: (record) => {
        const animal = byId.get(record.animalId);
        return animal === undefined ? (
          <span className="text-muted">Unknown</span>
        ) : (
          <Link
            href={animalHref(animal)}
            className="font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
          >
            {displayName(animal)}
          </Link>
        );
      },
    },
    { key: "delivered", header: "Delivered", render: (r) => formatDate(r.deliveredOn) },
    { key: "live", header: "Live", numeric: true, render: (r) => lb(r.liveScaleWeightLb) },
    { key: "hanging", header: "Hanging", numeric: true, render: (r) => lb(r.hangingWeightLb) },
    {
      key: "dressing",
      header: "Dressing",
      numeric: true,
      render: (record) => {
        const percent = dressingPercentage(record);
        if (percent === undefined) return <span className="text-muted">—</span>;
        // Sixty to sixty-four is the ordinary range for a finished animal.
        return (
          <Pill tone={percent >= 60 && percent <= 64 ? "calm" : "action"}>
            {percent.toFixed(1)}%
          </Pill>
        );
      },
    },
    { key: "cost", header: "Cost", numeric: true, render: (r) => money(r.processingCost) },
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
      <Section
        title="Deliver to the processor"
        description="Dressing percentage is why this record exists: hanging weight over live weight is how you find out whether an animal that looked good actually was."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Animal"
              value={animalId}
              onChange={(event) => setAnimalId(event.target.value)}
              placeholder="Choose an animal"
              options={cattle
                .filter((entry) => entry.status === "active")
                .map((entry) => ({
                  value: entry.id,
                  label: `${displayName(entry)}${isClearForSale(health, entry.id, now) ? "" : " · under withdrawal"}`,
                }))}
              required
            />
            <TextInput
              label="Delivered"
              type="date"
              value={delivered}
              onChange={(event) => setDelivered(event.target.value)}
              required
            />
            <TextInput
              label="Live weight (lb)"
              type="number"
              inputMode="decimal"
              numeric
              value={live}
              onChange={(event) => setLive(event.target.value)}
            />
            <TextInput
              label="Hanging weight (lb)"
              hint="Hot carcass weight, off the processor's sheet."
              type="number"
              inputMode="decimal"
              numeric
              value={hanging}
              onChange={(event) => setHanging(event.target.value)}
            />
            <TextInput
              label="Processing cost"
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
          </div>

          {clear ? null : (
            <Callout
              tone="danger"
              title={`${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal until ${formatDate(withdrawal?.clearsOn)}`}
            >
              <div className="flex flex-col gap-density pt-2">
                <p>
                  Delivering it to a processor before that date puts it in the food chain inside a
                  withdrawal period. That is a residue violation, not a paperwork problem.
                </p>
                <TextInput
                  label="If you are doing this anyway, say why"
                  hint="Goes on the record. Custom-exempt harvest for your own freezer is the case this exists for."
                  value={override}
                  onChange={(event) => setOverride(event.target.value)}
                />
              </div>
            </Callout>
          )}

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div>
            <Button type="submit" busy={busy} disabled={blocked}>
              {clear ? "Record delivery" : "Record delivery under override"}
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Every delivery">
        <Card>
          <DataTable
            caption="Processing records"
            columns={columns}
            rows={[...processing].sort((a, b) => b.deliveredOn.getTime() - a.deliveredOn.getTime())}
            rowKey={(record) => record.id}
            empty={
              <EmptyState
                title="Nothing processed yet"
                detail="Record a delivery above. Live and hanging weight together give the dressing percentage."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}
