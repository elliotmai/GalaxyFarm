"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  PageBody,
  Pill,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
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

import {
  AddFab,
  Chip,
  ChipRow,
  facts,
  FilteredLine,
  Row,
  Rows,
  ScreenHeader,
} from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
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
  // with `?animal=`, and the panel opens with her already chosen — so the
  // second tap is Record.
  const prefilledAnimal = useSearchParams().get("animal") ?? "";
  /** The panel: closed, recording a new one, or editing one. */
  const [panel, setPanel] = useState<"closed" | "new" | HealthRecord>(
    prefilledAnimal === "" ? "closed" : "new",
  );
  const [filter, setFilter] = useState<Filter>("all");

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

  const sorted = [...records].sort((a, b) => b.date.getTime() - a.date.getTime());
  const shown = sorted.filter((record) => FILTERS[filter].keep(record, now));
  const nameOf = (id: Ulid) => {
    const animal = byId.get(id);
    return animal === undefined ? "Unknown animal" : displayName(animal);
  };

  const add = (
    <Button variant="primary" aria-haspopup="dialog" onClick={() => setPanel("new")}>
      <span aria-hidden="true">+</span> Record treatment
    </Button>
  );

  return (
    // Bottom clearance on a phone, so the floating button never covers a row.
    <PageBody>
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <ScreenHeader
          title="Health"
          facts={facts(
            `${records.length} treatment${records.length === 1 ? "" : "s"}`,
            held.length > 0 && `${held.length} under withdrawal`,
            boosters.length > 0 &&
              `${boosters.length} booster${boosters.length === 1 ? "" : "s"} due`,
          )}
          action={<span className="hidden sm:block">{add}</span>}
        />

        {/*
          The exceptions, and only when there are some. A withdrawal is the
          one derived value here with a legal edge on it, so the animals under
          one are listed by name above everything else — and a day with none
          says so in one quiet line rather than a green box.
        */}
        {held.length === 0 && boosters.length === 0 ? (
          loading || records.length === 0 ? null : (
            <p className="text-sm text-calm">
              Nobody under withdrawal. No boosters due in 30 days.
            </p>
          )
        ) : null}

        {held.length === 0 ? null : (
          <Section title="Not clear for sale">
            <Rows label="Under withdrawal">
              {held.map((status) => {
                const animal = byId.get(status.animalId);
                return (
                  <Row
                    key={status.animalId}
                    title={nameOf(status.animalId)}
                    href={animal === undefined ? undefined : animalHref(animal)}
                    line={facts(status.product, `clears ${formatDate(status.clearsOn)}`)}
                    chip={
                      <Pill tone="danger" dot>
                        {status.daysRemaining} d
                      </Pill>
                    }
                  />
                );
              })}
            </Rows>
          </Section>
        )}

        {boosters.length === 0 ? null : (
          <Section title="Boosters due" description="Within 30 days">
            <Rows label="Boosters due">
              {boosters.map((entry) => {
                const animal = byId.get(entry.record.animalId);
                return (
                  <Row
                    key={entry.record.id}
                    title={nameOf(entry.record.animalId)}
                    href={animal === undefined ? undefined : animalHref(animal)}
                    line={entry.record.product ?? entry.record.type}
                    chip={
                      <Pill tone={entry.overdue ? "danger" : "action"} dot={entry.overdue}>
                        {entry.overdue ? "Overdue" : "Due"} {formatDate(entry.dueOn)}
                      </Pill>
                    }
                  />
                );
              })}
            </Rows>
          </Section>
        )}

        <Section title="Treatments">
          <ChipRow label="Show">
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <Chip
                key={key}
                on={filter === key}
                // Pressing the one already on goes back to all of them.
                onClick={() => setFilter(filter === key ? "all" : key)}
              >
                {FILTERS[key].label}
              </Chip>
            ))}
          </ChipRow>

          {filter === "all" ? null : (
            <FilteredLine
              shown={shown.length}
              total={records.length}
              what={FILTERS[filter].label}
              onClear={() => setFilter("all")}
            />
          )}

          {loading ? (
            <p className="text-muted">Looking…</p>
          ) : shown.length === 0 ? (
            <EmptyState
              title={records.length === 0 ? "Nothing recorded yet" : "None match"}
              detail={
                records.length === 0
                  ? "Anything carrying a withdrawal period flags the animal until it clears."
                  : undefined
              }
              action={
                records.length === 0 ? (
                  <Button variant="primary" onClick={() => setPanel("new")}>
                    Record a treatment
                  </Button>
                ) : (
                  <Button onClick={() => setFilter("all")}>Show all</Button>
                )
              }
            />
          ) : (
            <Rows label="Health records">
              {shown.map((record) => {
                const ends = withdrawalEndDate(record);
                const under = ends !== undefined && isUnderWithdrawal(record, now);
                return (
                  <Row
                    key={record.id}
                    title={nameOf(record.animalId)}
                    onSelect={() => setPanel(record)}
                    selectLabel={`Edit ${record.type} for ${nameOf(record.animalId)} on ${formatDate(record.date)}`}
                    line={facts(
                      record.type,
                      record.product,
                      formatDate(record.date),
                      record.administeredBy,
                      ends !== undefined && !under && `cleared ${formatDate(ends)}`,
                    )}
                    chip={
                      under ? (
                        <Pill tone="danger" dot>
                          Until {formatDate(ends)}
                        </Pill>
                      ) : undefined
                    }
                  />
                );
              })}
            </Rows>
          )}
        </Section>

        <AddFab onClick={() => setPanel("new")}>Record</AddFab>

        {panel === "closed" ? null : (
          <AddHealth
            key={panel === "new" ? "new" : panel.id}
            animals={animals}
            meds={meds}
            api={api}
            fridge={fridge}
            heldSet={heldSet}
            records={records}
            {...(panel === "new" ? {} : { editing: panel })}
            onDone={() => setPanel("closed")}
            onDelete={(record) => {
              // The panel closes first, so the typed confirmation is the only
              // dialog on screen rather than a second one stacked on this.
              setPanel("closed");
              void remove(record);
            }}
            defaultAnimalId={prefilledAnimal}
          />
        )}
      </div>
    </PageBody>
  );
}

type Filter = "all" | "held" | "vaccination" | "treatment";

/** The chips over the log: the cuts people ask for out loud. */
const FILTERS: Record<
  Filter,
  { readonly label: string; readonly keep: (record: HealthRecord, now: Date) => boolean }
> = {
  all: { label: "All", keep: () => true },
  held: { label: "Under withdrawal", keep: (record, now) => isUnderWithdrawal(record, now) },
  vaccination: { label: "Vaccinations", keep: (record) => record.type === "vaccination" },
  treatment: { label: "Treatments", keep: (record) => record.type === "treatment" },
};

type Api = ReturnType<typeof useMutations<HealthRecord>>;

/**
 * The form, in a side panel (a bottom sheet on a phone).
 *
 * A new treatment leaves the panel open after it saves, with the animal and
 * the bottle still chosen: a round of blackleg is forty calves in a row, and
 * reopening the panel forty times is forty taps nobody needs.
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
  onDelete,
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
  readonly onDelete: (record: HealthRecord) => void;
  readonly defaultAnimalId: string;
}) {
  const { show } = useToast();
  // The save button lives in the panel's footer, outside the form, and names
  // the form so Enter in a field and the button are the same submit.
  const formId = useId();

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
    <Modal
      placement="side"
      title={editing === undefined ? "Record a treatment" : "Edit this treatment"}
      // Said only on an edit, where it is the thing people worry about.
      {...(editing === undefined
        ? {}
        : { description: "Changing the date or the withdrawal days moves the clearance date." })}
      onClose={onDone}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            {editing === undefined ? "Record treatment" : "Save treatment"}
          </Button>
          <Button onClick={onDone}>{editing === undefined ? "Done" : "Cancel"}</Button>
          {editing === undefined ? null : (
            <Button variant="danger" className="ml-auto" onClick={() => onDelete(editing)}>
              Delete
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density sm:grid sm:grid-cols-2"
      >
        <Select
          label="Animal"
          value={animalId}
          onChange={(event) => setAnimalId(event.target.value)}
          placeholder="Choose an animal"
          // Cattle only. The entity is species-agnostic and the pets screen
          // writes to the same table, so an unfiltered list offers the dogs on
          // the screen that draws a dose out of the cattle fridge. The record
          // being edited stays in the list whatever it is, or opening a pet's
          // row from the log would blank the field it came in with.
          options={animals
            .filter(
              (entry) =>
                (entry.species === "cattle" && entry.status === "active") ||
                entry.id === editing?.animalId,
            )
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
              ? "An edit does not draw a second dose, or put the first back."
              : chosenMed === undefined
                ? "Choose from the fridge to draw it out of stock."
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
          value={by}
          onChange={(event) => setBy(event.target.value)}
        />
        <TextInput
          label="Booster due"
          type="date"
          value={booster}
          onChange={(event) => setBooster(event.target.value)}
        />
        <TextInput
          label="Notes"
          className="sm:col-span-2"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />

        {/* Shown before saving, because the clearance date is the point of the
            record and a mistyped withdrawal is invisible until somebody tries
            to sell her. */}
        {clears === undefined ? null : (
          <p className="text-sm text-muted sm:col-span-2">
            {animal === undefined ? "This animal" : displayName(animal)} will not be clear for sale
            until <span className="font-medium text-ink">{formatDate(clears)}</span>
          </p>
        )}

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}

        {editing === undefined || animal === undefined ? null : (
          <Link
            href={animalHref(animal)}
            className="inline-flex min-h-target items-center text-sm text-action underline-offset-2 hover:underline sm:col-span-2"
          >
            Open {displayName(animal)}&rsquo;s page
          </Link>
        )}
      </form>
    </Modal>
  );
}
