"use client";

import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  Callout,
  Checkbox,
  EmptyState,
  Modal,
  PageBody,
  Pill,
  Section,
  Select,
  StatRow,
  Tabs,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  optionLabel,
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

import {
  AddFab,
  facts,
  Row,
  Rows,
  ScreenHeader,
} from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
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

type TabId = (typeof TABS)[number]["id"];

/** What the header's one button records, on each tab. */
const ADD_LABEL: Record<TabId, string> = {
  pl: "Record sale",
  sales: "Record sale",
  acquisitions: "Record acquisition",
  processing: "Record delivery",
};

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

  const [tab, setTab] = useState<TabId>("pl");
  /** Whether the current tab's form panel is open. */
  const [adding, setAdding] = useState(false);

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
  const incomplete = rollup.animals - rollup.completeAnimals;

  function startAdd() {
    // From the P&L the commonest thing to record is a sale, so the button
    // goes there rather than being missing.
    if (tab === "pl") setTab("sales");
    setAdding(true);
  }

  const shared = {
    cattle,
    byId,
    propertyId,
    actorId,
    open: adding,
    onClose: () => setAdding(false),
  };

  return (
    <PageBody>
      {/* Bottom clearance on a phone, so the floating button never covers a row. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <ScreenHeader
          title="Sales and finance"
          facts={facts(
            `${rollup.animals} costed`,
            rollup.animals > 0 && `net ${money(rollup.net)}`,
            incomplete > 0 && `${incomplete} incomplete`,
          )}
          action={
            <span className="hidden sm:block">
              <Button variant="primary" aria-haspopup="dialog" onClick={startAdd}>
                <span aria-hidden="true">+</span> {ADD_LABEL[tab]}
              </Button>
            </span>
          }
        />

        <Tabs
          tabs={TABS}
          label="Cattle finance"
          activeTab={tab}
          onTabChange={(id) => {
            setTab(id as TabId);
            setAdding(false);
          }}
        >
          {(active) =>
            active === "pl" ? (
              <div className="flex flex-col gap-density">
                {rows.length === 0 ? null : (
                  <StatRow>
                    <Tile
                      label="Net"
                      value={money(rollup.net)}
                      tone={rollup.net.cents >= 0 ? "calm" : "danger"}
                      emphasis
                      hint={
                        incomplete === 0
                          ? "Every figure complete"
                          : `${incomplete} missing an input`
                      }
                    />
                    <Tile label="Revenue" value={money(rollup.totalRevenue)} />
                    <Tile label="Cost" value={money(rollup.totalCost)} />
                  </StatRow>
                )}

                <Section
                  title="Per animal"
                  description="A figure marked incomplete is missing a cost line — usually feed, which is apportioned in §5.3."
                >
                  {rows.length === 0 ? (
                    <EmptyState
                      title="Nothing costed yet"
                      detail="Record an acquisition or a sale and the picture builds from what is logged."
                    />
                  ) : (
                    <Rows label="Profit and loss by animal">
                      {rows.map((row) => {
                        const animal = byId.get(row.animalId);
                        return (
                          <Row
                            key={row.animalId}
                            title={animal === undefined ? "Unknown animal" : displayName(animal)}
                            href={animal === undefined ? undefined : animalHref(animal)}
                            line={facts(
                              `${money(row.totalRevenue)} in`,
                              `${money(row.totalCost)} out`,
                              row.acquisitionCost.cents > 0 &&
                                `bought ${money(row.acquisitionCost)}`,
                              row.healthCost.cents > 0 && `health ${money(row.healthCost)}`,
                              row.feedCost.cents > 0 && `feed ${money(row.feedCost)}`,
                            )}
                            chip={
                              <span className="flex items-center gap-2">
                                {row.complete ? null : (
                                  <Pill tone="action" dot>
                                    Incomplete
                                  </Pill>
                                )}
                                <span
                                  className={`gf-numeric font-semibold ${row.net.cents >= 0 ? "text-ink" : "text-danger"}`}
                                >
                                  {money(row.net)}
                                </span>
                              </span>
                            }
                          />
                        );
                      })}
                    </Rows>
                  )}
                </Section>
              </div>
            ) : active === "sales" ? (
              <SalesTab {...shared} sales={sales} health={health} now={now} />
            ) : active === "acquisitions" ? (
              <AcquisitionsTab {...shared} acquisitions={acquisitions} />
            ) : (
              <ProcessingTab {...shared} processing={processing} health={health} now={now} />
            )
          }
        </Tabs>

        <AddFab onClick={startAdd}>{ADD_LABEL[tab]}</AddFab>
      </div>
    </PageBody>
  );
}

/** What every tab's form panel is handed. */
interface PanelProps {
  /** The herd, already narrowed to cattle — never the whole menagerie. */
  readonly cattle: readonly Animal[];
  readonly byId: ReadonlyMap<Ulid, Animal>;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly open: boolean;
  readonly onClose: () => void;
}

function DeleteButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-target min-w-target items-center justify-center rounded-full text-muted hover:bg-raised hover:text-danger focus-visible:outline-2 focus-visible:outline-action"
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 7h16" />
        <path d="M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </svg>
    </button>
  );
}

/**
 * A form panel's footer: the submit, which names the form so Enter in a field
 * and the button are the same submit, and a way out. The panel stays open
 * after a save with the animal still chosen — a load going to the sale barn
 * is several rows in a row.
 */
function PanelFooter({
  formId,
  busy,
  disabled,
  label,
  onClose,
}: {
  readonly formId: string;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClose: () => void;
}) {
  return (
    <>
      <Button variant="primary" type="submit" form={formId} busy={busy} disabled={disabled}>
        {label}
      </Button>
      <Button onClick={onClose}>Done</Button>
    </>
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
  open,
  onClose,
}: PanelProps & {
  readonly sales: readonly SaleRecord[];
  readonly health: readonly HealthRecord[];
  readonly now: Date;
}) {
  const formId = useId();
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

  return (
    <>
      {sales.length === 0 ? (
        <EmptyState title="Nothing sold yet" />
      ) : (
        <Rows label="Sales">
          {[...sales]
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .map((record) => {
              const animal = byId.get(record.animalId);
              const name = animal === undefined ? "Unknown animal" : displayName(animal);
              return (
                <Row
                  key={record.id}
                  title={name}
                  line={facts(
                    formatDate(record.date),
                    record.type.replace(/_/g, " "),
                    `price ${money(record.price)}`,
                  )}
                  notes={record.notes}
                  // The number that actually landed, after the barn took its cut.
                  chip={<Figure>{money(netSaleProceeds(record))}</Figure>}
                  action={
                    <DeleteButton
                      label={`Delete sale of ${name} on ${formatDate(record.date)}`}
                      onClick={() => void remove(record)}
                    />
                  }
                />
              );
            })}
        </Rows>
      )}

      {!open ? null : (
        <Modal
          placement="side"
          title="Record a sale"
          onClose={onClose}
          footer={
            <PanelFooter
              formId={formId}
              busy={busy}
              disabled={blocked}
              label={clear ? "Record sale" : "Record sale under override"}
              onClose={onClose}
            />
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-density"
          >
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

            {clear ? null : (
              <Callout
                tone="danger"
                title={`${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal${withdrawal === undefined ? "" : ` until ${formatDate(withdrawal.clearsOn)}`}`}
              >
                <div className="flex flex-col gap-density pt-2">
                  <p>
                    Not for the food chain. A sale to another producer can go ahead, on the record.
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
                label: optionLabel(value),
              }))}
            />
            <TextInput
              label="Commission ($)"
              hint="What the barn took, so the net is what landed."
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

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}

/** The figure a money row is about, in the numeric face so a column lines up. */
function Figure({ children }: { readonly children: ReactNode }) {
  return <span className="gf-numeric font-semibold text-ink">{children}</span>;
}

function AcquisitionsTab({
  cattle,
  acquisitions,
  byId,
  propertyId,
  actorId,
  open,
  onClose,
}: PanelProps & {
  readonly acquisitions: readonly AcquisitionRecord[];
}) {
  const formId = useId();
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

  return (
    <>
      {acquisitions.length === 0 ? (
        <EmptyState
          title="Nothing bought yet"
          detail="A home-raised calf has no acquisition — its cost is feed and health."
        />
      ) : (
        <Rows label="Acquisitions">
          {[...acquisitions]
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .map((record) => {
              const animal = byId.get(record.animalId);
              const name = animal === undefined ? "Unknown animal" : displayName(animal);
              return (
                <Row
                  key={record.id}
                  title={name}
                  line={facts(formatDate(record.date), record.type.replace(/_/g, " "))}
                  chip={<Figure>{money(record.price)}</Figure>}
                  action={
                    <DeleteButton
                      label={`Delete purchase of ${name} on ${formatDate(record.date)}`}
                      onClick={() => void remove(record)}
                    />
                  }
                />
              );
            })}
        </Rows>
      )}

      {!open ? null : (
        <Modal
          placement="side"
          title="Record an acquisition"
          onClose={onClose}
          footer={
            <PanelFooter formId={formId} busy={busy} label="Record acquisition" onClose={onClose} />
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-density"
          >
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
                label: optionLabel(value),
              }))}
            />
            <TextInput
              label="Date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </>
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
  open,
  onClose,
}: PanelProps & {
  readonly processing: readonly ProcessingRecord[];
  readonly health: readonly HealthRecord[];
  readonly now: Date;
}) {
  const formId = useId();
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

  return (
    <Section
      title="Deliveries"
      description="Dressing percentage is why this record exists: hanging weight over live weight is how you find out whether an animal that looked good actually was."
    >
      {processing.length === 0 ? (
        <EmptyState
          title="Nothing processed yet"
          detail="Live and hanging weight together give the dressing percentage."
        />
      ) : (
        <Rows label="Processing records">
          {[...processing]
            .sort((a, b) => b.deliveredOn.getTime() - a.deliveredOn.getTime())
            .map((record) => {
              const animal = byId.get(record.animalId);
              const name = animal === undefined ? "Unknown animal" : displayName(animal);
              const percent = dressingPercentage(record);
              return (
                <Row
                  key={record.id}
                  title={name}
                  href={animal === undefined ? undefined : animalHref(animal)}
                  line={facts(
                    `delivered ${formatDate(record.deliveredOn)}`,
                    record.liveScaleWeightLb !== undefined &&
                      `live ${lb(record.liveScaleWeightLb)}`,
                    record.hangingWeightLb !== undefined && `hanging ${lb(record.hangingWeightLb)}`,
                    record.processingCost !== undefined && money(record.processingCost),
                  )}
                  notes={record.notes}
                  chip={
                    percent === undefined ? undefined : (
                      // Sixty to sixty-four is the ordinary range for a finished animal.
                      <Pill tone={percent >= 60 && percent <= 64 ? "calm" : "action"}>
                        {percent.toFixed(1)}%
                      </Pill>
                    )
                  }
                  action={
                    <DeleteButton
                      label={`Delete delivery of ${name} on ${formatDate(record.deliveredOn)}`}
                      onClick={() => void remove(record)}
                    />
                  }
                />
              );
            })}
        </Rows>
      )}

      {!open ? null : (
        <Modal
          placement="side"
          title="Deliver to the processor"
          onClose={onClose}
          footer={
            <PanelFooter
              formId={formId}
              busy={busy}
              disabled={blocked}
              label={clear ? "Record delivery" : "Record delivery under override"}
              onClose={onClose}
            />
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-density"
          >
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

            {clear ? null : (
              <Callout
                tone="danger"
                title={`${chosen === undefined ? "That animal" : displayName(chosen)} is under withdrawal until ${formatDate(withdrawal?.clearsOn)}`}
              >
                <div className="flex flex-col gap-density pt-2">
                  <p>Delivering it now is a residue violation, not a paperwork problem.</p>
                  <TextInput
                    label="If you are doing this anyway, say why"
                    hint="Goes on the record — for custom-exempt harvest for your own freezer."
                    value={override}
                    onChange={(event) => setOverride(event.target.value)}
                  />
                </div>
              </Callout>
            )}

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

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </Section>
  );
}
