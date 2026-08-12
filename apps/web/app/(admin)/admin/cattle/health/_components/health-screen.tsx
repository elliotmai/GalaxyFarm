"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  drawDose,
  healthRecordSchema,
  HEALTH_RECORD_TYPES,
  isUnderWithdrawal,
  medInventorySchema,
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
  // Recording a treatment draws the dose out of the fridge, so this screen
  // writes to two collections. Both go through the same mutation path — an
  // inventory count that only moved on this device would be a count nobody
  // could trust from the barn.
  const fridge = useMutations<MedInventory>(
    "medInventory",
    "medInventory",
    medInventorySchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const now = new Date();
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const records = records_;

  // #17: logging a treatment is two taps from the animal. Her page links here
  // with `?animal=`, and the form opens with her already chosen.
  const prefilledAnimal = useSearchParams().get("animal") ?? "";
  const [editing, setEditing] = useState<HealthRecord | undefined>();

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
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => setEditing(record)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(record)}>
            Delete
          </Button>
        </span>
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

      <Section
        title={editing === undefined ? "Record a treatment" : "Edit this treatment"}
        description={
          editing === undefined
            ? undefined
            : "Changing the date or the withdrawal days moves the clearance date with it — nothing is stored twice."
        }
      >
        <AddHealth
          key={editing?.id ?? "new"}
          animals={animals}
          meds={meds}
          api={api}
          fridge={fridge}
          heldSet={heldSet}
          records={records}
          {...(editing === undefined ? {} : { editing })}
          onDone={() => setEditing(undefined)}
          defaultAnimalId={prefilledAnimal}
        />
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
  fridge,
  heldSet,
  records,
  editing,
  onDone,
  defaultAnimalId,
}: {
  readonly animals: readonly Animal[];
  readonly meds: readonly MedInventory[];
  readonly api: Api;
  readonly fridge: ReturnType<typeof useMutations<MedInventory>>;
  readonly heldSet: ReadonlySet<Ulid>;
  readonly records: readonly HealthRecord[];
  readonly editing?: HealthRecord;
  readonly onDone: () => void;
  readonly defaultAnimalId: string;
}) {
  const { show } = useToast();

  /**
   * The last product used, and the fridge entry it came from.
   *
   * #17 asks for a treatment to be two taps from the animal, defaulting to
   * today and the last-used product. Nearly every treatment on this place is
   * the same bottle as the one before it — a round of blackleg is forty calves
   * and one product — so re-choosing it forty times is forty chances to pick
   * the wrong line of a dropdown.
   */
  const lastUsed = useMemo(
    () => [...records].sort((left, right) => right.date.getTime() - left.date.getTime())[0],
    [records],
  );

  const [animalId, setAnimalId] = useState(editing?.animalId ?? defaultAnimalId);
  const [type, setType] = useState<HealthRecordType>(editing?.type ?? "vaccination");
  const [medId, setMedId] = useState(editing?.medInventoryId ?? lastUsed?.medInventoryId ?? "");
  const [product, setProduct] = useState(editing?.product ?? lastUsed?.product ?? "");
  const [route, setRoute] = useState<AdministrationRoute>(
    editing?.route ?? lastUsed?.route ?? "subcutaneous",
  );
  const [date, setDate] = useState((editing?.date ?? new Date()).toISOString().slice(0, 10));
  const [withdrawal, setWithdrawal] = useState(
    editing?.withdrawalDays === undefined ? "" : String(editing.withdrawalDays),
  );
  const [dose, setDose] = useState("");
  const [by, setBy] = useState(editing?.administeredBy ?? "");
  const [booster, setBooster] = useState(
    editing?.boosterDueOn === undefined ? "" : editing.boosterDueOn.toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function chooseMed(id: string) {
    setMedId(id);
    const med = meds.find((entry) => entry.id === id);
    if (med === undefined) return;
    setProduct(med.product);
    if (med.defaultWithdrawalDays !== undefined) setWithdrawal(String(med.defaultWithdrawalDays));
  }

  const chosenMed = meds.find((entry) => entry.id === medId);

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

    /*
     * Drawing the dose is checked *before* the treatment is written, and both
     * are written before either is reported. `drawDose` refuses to go negative
     * (§4.5 clause 2) — a fridge showing minus two bottles is a fridge nobody
     * trusts, and the honest reading is that the count was wrong before the
     * dose rather than after it.
     *
     * Only on create. Editing a record does not draw a second dose, and
     * putting one back on a correction would need the original amount, which
     * the record does not carry — so an edit leaves the count alone and says
     * so rather than guessing.
     */
    let drawn: MedInventory | undefined;
    if (editing === undefined && chosenMed !== undefined && dose.trim() !== "") {
      const result = drawDose(
        chosenMed,
        { amount: Number(dose), unit: chosenMed.onHand.unit },
        new Date(),
      );
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      drawn = result.item;
    }

    setBusy(true);
    try {
      const payload = {
        animalId: animalId as Ulid,
        type,
        date: new Date(`${date}T12:00:00`),
        product: product.trim() === "" ? undefined : product.trim(),
        medInventoryId: medId === "" ? undefined : (medId as Ulid),
        route,
        administeredBy: by.trim() === "" ? undefined : by.trim(),
        withdrawalDays: withdrawal === "" ? undefined : Number(withdrawal),
        boosterDueOn: booster === "" ? undefined : new Date(`${booster}T12:00:00`),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<HealthRecord>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      if (drawn !== undefined) {
        await fridge.update(drawn.id, { onHand: drawn.onHand } as Partial<MedInventory>);
      }

      if (editing !== undefined) {
        show({
          message:
            clears === undefined
              ? "Treatment updated"
              : `Updated. Clear for sale ${formatDate(clears)}.`,
          tone: "success",
        });
        onDone();
        return;
      }

      setNotes("");
      setBooster("");
      setDose("");

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
            .filter((entry) => entry.status === "active" || entry.id === editing?.animalId)
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
          options={meds.map((med) => ({
            value: med.id,
            label: `${med.product} · ${med.onHand.amount} ${med.onHand.unit}`,
          }))}
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
          label={chosenMed === undefined ? "Dose" : `Dose (${chosenMed.onHand.unit})`}
          hint={
            editing !== undefined
              ? "An edit does not draw a second dose, or put the first one back."
              : chosenMed === undefined
                ? "Choose from the fridge to draw the dose out of stock."
                : `Comes off the ${chosenMed.onHand.amount} ${chosenMed.onHand.unit} on hand.`
          }
          type="number"
          inputMode="decimal"
          numeric
          value={dose}
          disabled={editing !== undefined}
          onChange={(event) => setDose(event.target.value)}
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
          {editing === undefined ? "Record treatment" : "Save treatment"}
        </Button>
        {editing === undefined ? null : (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        {clears === undefined ? null : (
          <p className="text-sm text-muted">
            {animal === undefined ? "This animal" : displayName(animal)} will not be clear for sale until{" "}
            <span className="font-medium text-ink">{formatDate(clears)}</span>
          </p>
        )}
      </div>
    </form>
  );
}
