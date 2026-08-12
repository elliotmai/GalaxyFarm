"use client";

import { useState } from "react";

import {
  Button,
  Card,
  CardGrid,
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
} from "@galaxy-farm/ui";
import { fromDollars, type Ulid } from "@galaxy-farm/core";
import {
  isExpired,
  isLowSemenInventory,
  MED_CATEGORIES,
  medInventorySchema,
  PROTOCOL_ACTIONS,
  semenInventorySchema,
  syncProtocolSchema,
  type MedCategory,
  type MedInventory,
  type SemenInventory,
  type SyncProtocol,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The tank, the fridge, and the protocols (spec §5.2, issue #20).
 *
 * Three inventories on one screen because they are one errand: what is on hand
 * for breeding and treating, and what is running out. Splitting them across
 * three routes would mean three places to look before an AI appointment.
 *
 * Each carries its own reorder signal, and both are the farm's numbers rather
 * than ours — §6's "low semen inventory" and "med expiring" notifications read
 * exactly these fields.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const TABS = [
  { id: "semen", label: "Semen tank" },
  { id: "meds", label: "Medicine fridge" },
  { id: "protocols", label: "Sync protocols" },
] as const;

export function CattleSuppliesScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: straws } = useRecords<SemenInventory>("semenInventory", query);
  const { records: meds } = useRecords<MedInventory>("medInventory", query);
  const { records: protocols } = useRecords<SyncProtocol>("syncProtocols", query);

  const now = new Date();
  const lowStraws = straws.filter((entry) => isLowSemenInventory(entry));
  const expired = meds.filter((entry) => isExpired(entry, now));

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Tank and fridge"
        subtitle="What is on hand for breeding and treating, and what is running out."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Straws on hand"
          value={straws.reduce((total, entry) => total + entry.strawsOnHand, 0)}
          tone="identity"
        />
        <Tile
          label="Sires low"
          value={lowStraws.length}
          tone={lowStraws.length > 0 ? "danger" : "calm"}
          emphasis={lowStraws.length > 0}
          hint={lowStraws.length > 0 ? "At or below reorder" : "All stocked"}
        />
        <Tile
          label="Expired product"
          value={expired.length}
          tone={expired.length > 0 ? "danger" : "calm"}
          emphasis={expired.length > 0}
        />
        <Tile label="Protocols" value={protocols.filter((p) => p.active).length} tone="action" />
      </div>

      <Tabs tabs={TABS} label="Cattle supplies">
        {(active) => (
          <div className="pt-density">
            {active === "semen" ? (
              <SemenTab straws={straws} propertyId={propertyId} actorId={actorId} />
            ) : active === "meds" ? (
              <MedsTab meds={meds} now={now} propertyId={propertyId} actorId={actorId} />
            ) : (
              <ProtocolsTab protocols={protocols} propertyId={propertyId} actorId={actorId} />
            )}
          </div>
        )}
      </Tabs>
    </PageBody>
  );
}

function SemenTab({
  straws,
  propertyId,
  actorId,
}: {
  readonly straws: readonly SemenInventory[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<SemenInventory>(
    "semenInventory",
    "semenInventory",
    semenInventorySchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [sire, setSire] = useState("");
  const [count, setCount] = useState("");
  const [tank, setTank] = useState("");
  const [canister, setCanister] = useState("");
  const [threshold, setThreshold] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.create({
        sireName: sire.trim(),
        strawsOnHand: Number(count || "0"),
        ...(tank.trim() === "" ? {} : { tank: tank.trim() }),
        ...(canister.trim() === "" ? {} : { canister: canister.trim() }),
        ...(threshold === "" ? {} : { reorderThreshold: Number(threshold) }),
        ...(price === "" ? {} : { pricePerStraw: fromDollars(Number(price)) }),
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      setSire("");
      setCount("");
      show({ message: "Added to the tank", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  /** Drawing a straw is the ordinary write here, so it is one tap. */
  async function draw(entry: SemenInventory, by: number) {
    const next = Math.max(0, entry.strawsOnHand + by);
    await api.update(entry.id, { strawsOnHand: next } as Partial<SemenInventory>);
    if (next === 0) show({ message: `${entry.sireName} is out`, tone: "warning" });
  }

  async function remove(entry: SemenInventory) {
    const confirmed = await confirmDelete({
      tier: "elevated",
      recordName: `${entry.sireName} — ${entry.strawsOnHand} straw${entry.strawsOnHand === 1 ? "" : "s"}`,
      entity: "semen record",
      // Breedings reference the straw they came from, and that reference is
      // what pedigrees a calf. Saying so is the difference between tidying up
      // and losing which bull sired a heifer.
      dependents: [
        {
          entity: "Breeding records",
          label: "that name this straw",
          effect: "detached" as const,
        },
      ],
      consequence: "Any breeding drawn from this will no longer resolve its sire.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(entry.id, "Removed from the tank");
    show({ message: "Removed from the tank", tone: "danger" });
  }

  return (
    <div className="flex flex-col gap-density">
      <Section title="Add a sire">
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="Sire"
              hint="As written on the cane."
              value={sire}
              onChange={(event) => setSire(event.target.value)}
              required
            />
            <TextInput
              label="Straws"
              type="number"
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              required
            />
            <TextInput
              label="Tank"
              value={tank}
              onChange={(event) => setTank(event.target.value)}
            />
            <TextInput
              label="Canister"
              value={canister}
              onChange={(event) => setCanister(event.target.value)}
            />
            <TextInput
              label="Reorder at"
              hint="Below this, §6 says something."
              type="number"
              inputMode="numeric"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
            <TextInput
              label="Price per straw ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy}>
            Add to the tank
          </Button>
        </form>
      </Section>

      <Section title="In the tank">
        {straws.length === 0 ? (
          <EmptyState
            title="The tank is empty"
            detail="Add a sire above. Straws drawn for an AI breeding come off here."
          />
        ) : (
          <CardGrid columns={3}>
            {straws.map((entry) => (
              <RecordCard
                key={entry.id}
                tone={
                  entry.strawsOnHand === 0
                    ? "danger"
                    : isLowSemenInventory(entry)
                      ? "action"
                      : "calm"
                }
                title={entry.sireName}
                subtitle={[entry.tank, entry.canister, entry.cane].filter(Boolean).join(" · ")}
                actions={
                  <Pill
                    tone={isLowSemenInventory(entry) ? "danger" : "calm"}
                    dot={isLowSemenInventory(entry)}
                  >
                    {entry.strawsOnHand} straw{entry.strawsOnHand === 1 ? "" : "s"}
                  </Pill>
                }
                meta={
                  entry.reorderThreshold === undefined ? undefined : (
                    <Pill>reorder at {entry.reorderThreshold}</Pill>
                  )
                }
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => void draw(entry, -1)}
                    disabled={entry.strawsOnHand === 0}
                  >
                    Draw one
                  </Button>
                  <Button variant="ghost" onClick={() => void draw(entry, 1)}>
                    Add one
                  </Button>
                  <Button variant="ghost" onClick={() => void remove(entry)}>
                    Delete
                  </Button>
                </div>
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>
    </div>
  );
}

function MedsTab({
  meds,
  now,
  propertyId,
  actorId,
}: {
  readonly meds: readonly MedInventory[];
  readonly now: Date;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<MedInventory>(
    "medInventory",
    "medInventory",
    medInventorySchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [product, setProduct] = useState("");
  const [category, setCategory] = useState<MedCategory>("vaccine");
  const [amount, setAmount] = useState("");
  const [expires, setExpires] = useState("");
  const [withdrawal, setWithdrawal] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.create({
        product: product.trim(),
        category,
        onHand: { amount: Number(amount || "0"), unit: "ml" },
        ...(expires === "" ? {} : { expiresOn: new Date(`${expires}T12:00:00`) }),
        ...(withdrawal === "" ? {} : { defaultWithdrawalDays: Number(withdrawal) }),
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
      setAmount("");
      show({ message: "Added to the fridge", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: MedInventory) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: entry.product,
      entity: "medicine",
      dependents: [],
      // The treatment copies the withdrawal at the time it is given, so
      // deleting the bottle cannot move a clearance date. Worth saying.
      consequence:
        "Treatments already recorded keep their own withdrawal period — it was copied from the label, not read from here.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(entry.id, "Removed from the fridge");
    show({ message: "Removed from the fridge", tone: "danger" });
  }

  return (
    <div className="flex flex-col gap-density">
      <Section title="Add a product">
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="Product"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              required
            />
            <Select
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value as MedCategory)}
              options={MED_CATEGORIES.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="On hand (ml)"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
            <TextInput
              label="Expires"
              type="date"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
            />
            <TextInput
              label="Withdrawal (days)"
              hint="Copied onto every treatment from this bottle."
              type="number"
              inputMode="numeric"
              value={withdrawal}
              onChange={(event) => setWithdrawal(event.target.value)}
            />
          </div>
          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy}>
            Add to the fridge
          </Button>
        </form>
      </Section>

      <Section title="In the fridge">
        {meds.length === 0 ? (
          <EmptyState
            title="Nothing in the fridge"
            detail="Add a product above and its withdrawal period fills in on every treatment given from it."
          />
        ) : (
          <CardGrid columns={3}>
            {meds.map((entry) => (
              <RecordCard
                key={entry.id}
                tone={isExpired(entry, now) ? "danger" : "neutral"}
                title={entry.product}
                subtitle={entry.category}
                actions={
                  <Pill tone={isExpired(entry, now) ? "danger" : "neutral"}>
                    {entry.onHand.amount} {entry.onHand.unit}
                  </Pill>
                }
                meta={
                  <>
                    {entry.expiresOn === undefined ? null : (
                      <Pill
                        tone={isExpired(entry, now) ? "danger" : "neutral"}
                        dot={isExpired(entry, now)}
                      >
                        {isExpired(entry, now) ? "expired" : "expires"}{" "}
                        {formatDate(entry.expiresOn)}
                      </Pill>
                    )}
                    {entry.defaultWithdrawalDays === undefined ? null : (
                      <Pill tone="action">{entry.defaultWithdrawalDays} d withdrawal</Pill>
                    )}
                  </>
                }
              >
                <Button variant="ghost" onClick={() => void remove(entry)}>
                  Delete
                </Button>
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>
    </div>
  );
}

function ProtocolsTab({
  protocols,
  propertyId,
  actorId,
}: {
  readonly protocols: readonly SyncProtocol[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<SyncProtocol>(
    "syncProtocols",
    "syncProtocols",
    syncProtocolSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /**
   * A protocol starts with one step and grows.
   *
   * The schema requires at least one, and a form that made somebody build the
   * whole seven-step CIDR sequence before it would save is a form nobody
   * finishes standing at a chute.
   */
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.create({
        name: name.trim(),
        active: true,
        steps: [{ dayOffset: 0, action: "cidr_in", label: "CIDR in" }],
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      setName("");
      show({ message: "Protocol added — add its steps below", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  async function addStep(protocol: SyncProtocol, dayOffset: number, action: string, label: string) {
    await api.update(protocol.id, {
      steps: [...protocol.steps, { dayOffset, action, label }],
    } as Partial<SyncProtocol>);
  }

  async function remove(protocol: SyncProtocol) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: protocol.name,
      entity: "sync protocol",
      dependents: [],
      consequence:
        "Breedings already recorded against it keep their reference; nothing scheduled from it is rebuilt.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(protocol.id, "Removed from the protocols");
    show({ message: "Protocol deleted", tone: "danger" });
  }

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Add a protocol"
        description="A named sequence of dated steps — CIDR in, PG, CIDR out, heat, breed."
      >
        <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <TextInput
              label="Name"
              hint="&ldquo;7-day CO-Synch + CIDR&rdquo;"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <Button type="submit" busy={busy}>
            Add protocol
          </Button>
        </form>
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Section>

      <Section title="Protocols">
        {protocols.length === 0 ? (
          <EmptyState
            title="No protocols yet"
            detail="A protocol is what turns one date into a schedule: every step lands on a day counted from the start."
          />
        ) : (
          <div className="flex flex-col gap-density">
            {protocols.map((protocol) => (
              <Card key={protocol.id} title={protocol.name}>
                <ol className="flex flex-col gap-2">
                  {[...protocol.steps]
                    .sort((left, right) => left.dayOffset - right.dayOffset)
                    .map((step, index) => (
                      <li
                        key={`${step.dayOffset}-${step.action}-${index}`}
                        className="flex flex-wrap items-center gap-2 text-density"
                      >
                        <Pill tone="action">day {step.dayOffset}</Pill>
                        <span className="text-ink">{step.label}</span>
                        <span className="text-sm text-muted">{step.action}</span>
                      </li>
                    ))}
                </ol>

                <div className="mt-density flex flex-wrap items-center gap-2 border-t border-edge pt-density">
                  <AddStep
                    onAdd={(day, action, label) => void addStep(protocol, day, action, label)}
                  />
                  <Button variant="ghost" onClick={() => void remove(protocol)}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function AddStep({
  onAdd,
}: {
  readonly onAdd: (day: number, action: string, label: string) => void;
}) {
  const [day, setDay] = useState("0");
  const [action, setAction] = useState<string>(PROTOCOL_ACTIONS[0]);

  return (
    <span className="flex flex-wrap items-end gap-2">
      <TextInput
        label="Day"
        type="number"
        inputMode="numeric"
        value={day}
        onChange={(event) => setDay(event.target.value)}
      />
      <Select
        label="Step"
        value={action}
        onChange={(event) => setAction(event.target.value)}
        options={PROTOCOL_ACTIONS.map((value) => ({ value, label: value.replace(/_/g, " ") }))}
      />
      <Button variant="ghost" onClick={() => onAdd(Number(day), action, action.replace(/_/g, " "))}>
        Add step
      </Button>
    </span>
  );
}
