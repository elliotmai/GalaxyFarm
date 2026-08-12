"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  CardGrid,
  DataTable,
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
  type Column,
} from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  animalsUnderWithdrawal,
  boosterDue,
  healthRecordSchema,
  HEALTH_RECORD_TYPES,
  isUnderWithdrawal,
  ROUTES,
  withdrawalEndDate,
  type AdministrationRoute,
  type HealthRecord,
  type HealthRecordType,
  type MedInventory,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Health, and the withdrawal clock (spec §5.2, issue #17).
 *
 * The withdrawal flag is the one derived value in this app with a legal edge
 * on it: an animal treated with a product carrying a withdrawal period must
 * not enter the food chain until it passes. So it is **computed, never
 * stored** — correcting a treatment date moves the clearance date with it, and
 * there is no second copy to go stale.
 *
 * `withdrawalDays` is copied off the product at the moment of treatment rather
 * than read through to the medicine record. A label change next year must not
 * silently move a date somebody has already sold an animal against.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function HealthScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: records_, loading } = useRecords<HealthRecord>("healthRecords", query);
  const { records: meds } = useRecords<MedInventory>("medInventory", query);

  const api = useMutations<HealthRecord>(
    "healthRecords",
    "healthRecords",
    healthRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const now = new Date();
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const records = records_;

  // Every cow with an unexpired withdrawal, from the domain rather than from a
  // filter written here — the same function the sale screen will ask.
  const held = animalsUnderWithdrawal(records, now);
  const heldSet = new Set(held.map((entry) => entry.animalId));
  const boosters = boosterDue(records, now, 30);

  async function remove(record: HealthRecord) {
    const animal = byId.get(record.animalId);
    const ends = withdrawalEndDate(record);

    const confirmed = await confirmDelete({
      // Elevated rather than Standard: deleting a treatment can *clear* a
      // withdrawal hold, and an animal wrongly cleared for slaughter is not a
      // record-keeping mistake.
      tier: "elevated",
      recordName: `${record.type} for ${animal === undefined ? "an animal" : displayName(animal)} on ${formatDate(record.date)}`,
      entity: "health record",
      dependents:
        ends === undefined || ends <= now
          ? []
          : [
              {
                entity: "Withdrawal hold",
                label: `clears ${formatDate(ends)}`,
                effect: "deleted" as const,
              },
            ],
      consequence:
        ends !== undefined && ends > now
          ? `${animal === undefined ? "This animal" : displayName(animal)} is under withdrawal until ${formatDate(ends)}. Deleting this treatment removes that hold.`
          : undefined,
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(record.id, "Removed from the health log");
    show({ message: "Health record deleted", tone: "danger" });
  }

  const columns: readonly Column<HealthRecord>[] = [
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
    { key: "type", header: "Type", render: (record) => record.type },
    { key: "date", header: "Date", render: (record) => formatDate(record.date) },
    { key: "product", header: "Product", render: (record) => record.product ?? "—" },
    {
      key: "withdrawal",
      header: "Withdrawal",
      render: (record) => {
        const ends = withdrawalEndDate(record);
        if (ends === undefined) return <span className="text-muted">None</span>;
        return isUnderWithdrawal(record, now) ? (
          <Pill tone="danger" dot>
            until {formatDate(ends)}
          </Pill>
        ) : (
          <Pill tone="calm">cleared {formatDate(ends)}</Pill>
        );
      },
    },
    { key: "by", header: "By", render: (record) => record.administeredBy ?? "—" },
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
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Health"
        subtitle="Treatments, and the withdrawal clock they start. The clearance date is computed from the treatment, so correcting one moves the other."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Treatments" value={records.length} />
        <Tile
          label="Under withdrawal"
          value={held.length}
          tone={held.length > 0 ? "danger" : "calm"}
          emphasis={held.length > 0}
          hint={held.length > 0 ? "Not clear for sale" : "All clear"}
        />
        <Tile label="Boosters due" value={boosters.length} tone="action" hint="Within 30 days" />
        <Tile label="In the fridge" value={meds.length} tone="identity" />
      </div>

      {held.length === 0 ? null : (
        <Section
          title="Not clear for sale"
          description="These animals are inside a withdrawal period. Nothing here is a suggestion."
        >
          <CardGrid columns={3}>
            {held.map((status) => {
              const animal = byId.get(status.animalId);

              return (
                <RecordCard
                  key={status.animalId}
                  tone="danger"
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
                  subtitle={status.product}
                  actions={
                    <Pill tone="danger" dot>
                      {status.daysRemaining} d
                    </Pill>
                  }
                  meta={<Pill>clears {formatDate(status.clearsOn)}</Pill>}
                />
              );
            })}
          </CardGrid>
        </Section>
      )}

      {boosters.length === 0 ? null : (
        <Section title="Boosters due" description="A second shot the first one is waiting on.">
          <CardGrid columns={3}>
            {boosters.map((entry) => {
              const animal = byId.get(entry.record.animalId);
              return (
                <RecordCard
                  key={entry.record.id}
                  tone={entry.overdue ? "danger" : "action"}
                  title={animal === undefined ? "Unknown animal" : displayName(animal)}
                  subtitle={entry.record.product ?? entry.record.type}
                  meta={
                    <Pill tone={entry.overdue ? "danger" : "action"} dot={entry.overdue}>
                      {entry.overdue ? "overdue" : "due"} {formatDate(entry.dueOn)}
                    </Pill>
                  }
                />
              );
            })}
          </CardGrid>
        </Section>
      )}

      <Section title="Record a treatment">
        <AddHealth animals={animals} meds={meds} api={api} heldSet={heldSet} />
      </Section>

      <Section title="Everything recorded">
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="Health records"
              columns={columns}
              rows={[...records].sort((a, b) => b.date.getTime() - a.date.getTime())}
              rowKey={(record) => record.id}
              empty={
                <EmptyState
                  title="Nothing recorded yet"
                  detail="Record a vaccination or treatment above. Anything carrying a withdrawal period flags the animal until it clears."
                />
              }
            />
          </Card>
        )}
      </Section>
    </PageBody>
  );
}

type Api = ReturnType<typeof useMutations<HealthRecord>>;

/**
 * The form.
 *
 * Choosing a product from the fridge fills in its withdrawal days — copied,
 * not linked, so a label change next year cannot move a date somebody has
 * already sold an animal against. It stays editable, because the bottle in
 * your hand is the authority, not the record of it.
 */
function AddHealth({
  animals,
  meds,
  api,
  heldSet,
}: {
  readonly animals: readonly Animal[];
  readonly meds: readonly MedInventory[];
  readonly api: Api;
  readonly heldSet: ReadonlySet<Ulid>;
}) {
  const { show } = useToast();
  const [animalId, setAnimalId] = useState("");
  const [type, setType] = useState<HealthRecordType>("vaccination");
  const [medId, setMedId] = useState("");
  const [product, setProduct] = useState("");
  const [route, setRoute] = useState<AdministrationRoute>("subcutaneous");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [withdrawal, setWithdrawal] = useState("");
  const [by, setBy] = useState("");
  const [booster, setBooster] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function chooseMed(id: string) {
    setMedId(id);
    const med = meds.find((entry) => entry.id === id);
    if (med === undefined) return;
    setProduct(med.product);
    if (med.defaultWithdrawalDays !== undefined) setWithdrawal(String(med.defaultWithdrawalDays));
  }

  // Shown before saving, because the clearance date is the point of the record
  // and a mistyped withdrawal is invisible until somebody tries to sell her.
  const clears =
    withdrawal === "" || date === ""
      ? undefined
      : new Date(new Date(`${date}T12:00:00`).getTime() + Number(withdrawal) * 86_400_000);

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
        type,
        date: new Date(`${date}T12:00:00`),
        ...(product.trim() === "" ? {} : { product: product.trim() }),
        ...(medId === "" ? {} : { medInventoryId: medId as Ulid }),
        route,
        ...(by.trim() === "" ? {} : { administeredBy: by.trim() }),
        ...(withdrawal === "" ? {} : { withdrawalDays: Number(withdrawal) }),
        ...(booster === "" ? {} : { boosterDueOn: new Date(`${booster}T12:00:00`) }),
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      setProduct("");
      setMedId("");
      setNotes("");
      setBooster("");

      show({
        message:
          clears === undefined
            ? "Treatment recorded"
            : `Recorded. Clear for sale ${formatDate(clears)}.`,
        tone: clears === undefined ? "success" : "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  const animal = animals.find((entry) => entry.id === animalId);

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Animal"
          value={animalId}
          onChange={(event) => setAnimalId(event.target.value)}
          placeholder="Choose an animal"
          options={animals
            .filter((entry) => entry.status === "active")
            .map((entry) => ({
              value: entry.id,
              label: `${displayName(entry)}${heldSet.has(entry.id) ? " · under withdrawal" : ""}`,
            }))}
          required
        />
        <Select
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as HealthRecordType)}
          options={HEALTH_RECORD_TYPES.map((value) => ({ value, label: value }))}
        />
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <Select
          label="From the fridge"
          hint="Fills in the product and its withdrawal."
          value={medId}
          onChange={(event) => chooseMed(event.target.value)}
          placeholder="Not from stock"
          options={meds.map((med) => ({ value: med.id, label: med.product }))}
        />
        <TextInput
          label="Product"
          value={product}
          onChange={(event) => setProduct(event.target.value)}
        />
        <Select
          label="Route"
          value={route}
          onChange={(event) => setRoute(event.target.value as AdministrationRoute)}
          options={ROUTES.map((value) => ({ value, label: value }))}
        />
        <TextInput
          label="Withdrawal (days)"
          hint="Copied from the label. Blank means none."
          type="number"
          inputMode="numeric"
          value={withdrawal}
          onChange={(event) => setWithdrawal(event.target.value)}
        />
        <TextInput
          label="Administered by"
          hint="Not every hand is a user account."
          value={by}
          onChange={(event) => setBy(event.target.value)}
        />
        <TextInput
          label="Booster due"
          type="date"
          value={booster}
          onChange={(event) => setBooster(event.target.value)}
        />
        <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy}>
          Record treatment
        </Button>
        {clears === undefined ? null : (
          <p className="text-sm text-muted">
            {animal === undefined ? "She" : displayName(animal)} will not be clear for sale until{" "}
            <span className="font-medium text-ink">{formatDate(clears)}</span>
          </p>
        )}
      </div>
    </form>
  );
}
