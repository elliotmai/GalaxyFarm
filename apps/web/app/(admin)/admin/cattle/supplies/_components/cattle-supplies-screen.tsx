"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  SearchSelect,
  Section,
  Select,
  Tabs,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { displayName, fromDollars, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  expiringSoon,
  inferAncestorSexes,
  isExpired,
  isLowSemenInventory,
  MED_CATEGORIES,
  medInventorySchema,
  PROTOCOL_ACTIONS,
  semenInventorySchema,
  syncProtocolSchema,
  type CattleProfile,
  type ExternalAnimal,
  type MedCategory,
  type MedInventory,
  type SemenInventory,
  type SyncProtocol,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";
import { bullOptions, parseSire, strawSire, type SireLookup } from "@/lib/sires";

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
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: outsiders } = useRecords<ExternalAnimal>("externalAnimals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);

  /**
   * Who a straw can be joined to: our bulls, and every ancestor on file.
   *
   * The sexes are worked out from where each ancestor sits in the pedigrees
   * already here, because a certificate has a sire column and a dam column
   * rather than a sex field — and a cow offered as a sire is a mistake that
   * looks perfectly ordinary afterwards.
   */
  const sexes = useMemo(
    () => inferAncestorSexes(outsiders, [...profiles, ...outsiders]),
    [outsiders, profiles],
  );
  const lookup: SireLookup = useMemo(() => ({ animals, outsiders }), [animals, outsiders]);

  const now = new Date();
  const lowStraws = straws.filter((entry) => isLowSemenInventory(entry));
  const expired = meds.filter((entry) => isExpired(entry, now));

  /**
   * How far ahead to warn about expiry (#17).
   *
   * Configurable because the right answer depends on the product and on how
   * often you get to the co-op. Thirty days is the default; a fortnight suits
   * somebody in town twice a week, and ninety suits an annual order. Kept on
   * the device rather than in a record: it is a preference about a screen, not
   * a fact about the farm.
   */
  const [leadDays, setLeadDays] = useState(30);
  const expiringMeds = expiringSoon(meds, now, leadDays);

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
          label="Expiring or expired"
          value={expiringMeds.length}
          tone={expiringMeds.length > 0 ? "danger" : "calm"}
          emphasis={expiringMeds.length > 0}
          hint={
            expired.length > 0 ? `${expired.length} already out of date` : `Within ${leadDays} days`
          }
        />
        <Tile label="Protocols" value={protocols.filter((p) => p.active).length} tone="action" />
      </div>

      {expiringMeds.length === 0 ? null : (
        <Section
          title="Coming out of date"
          description="Expired stock stays on this list. A bottle that went out of date last month is still in the fridge and still the one somebody reaches for at six in the morning."
          actions={
            <Select
              label="Warn me this far ahead"
              hideLabel
              value={String(leadDays)}
              onChange={(event) => setLeadDays(Number(event.target.value))}
              options={[
                { value: "14", label: "14 days ahead" },
                { value: "30", label: "30 days ahead" },
                { value: "60", label: "60 days ahead" },
                { value: "90", label: "90 days ahead" },
              ]}
            />
          }
        >
          <CardGrid columns={3}>
            {expiringMeds.map((med) => {
              const days = Math.ceil(
                ((med.expiresOn as Date).getTime() - now.getTime()) / 86_400_000,
              );
              return (
                <RecordCard
                  key={med.id}
                  tone="danger"
                  title={med.product}
                  subtitle={med.storageLocation}
                  actions={
                    <Pill tone="danger" dot={days <= 0}>
                      {days <= 0 ? "expired" : `${days} d`}
                    </Pill>
                  }
                  meta={
                    <>
                      <Pill>
                        {med.onHand.amount} {med.onHand.unit} on hand
                      </Pill>
                      <Pill tone="neutral">{formatDate(med.expiresOn)}</Pill>
                    </>
                  }
                />
              );
            })}
          </CardGrid>
        </Section>
      )}

      <Tabs tabs={TABS} label="Cattle supplies">
        {(active) => (
          <div className="pt-density">
            {active === "semen" ? (
              <SemenTab
                straws={straws}
                lookup={lookup}
                sexes={sexes}
                propertyId={propertyId}
                actorId={actorId}
              />
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
  lookup,
  sexes,
  propertyId,
  actorId,
}: {
  readonly straws: readonly SemenInventory[];
  /** Our bulls and the ancestors on file, to join a cane to one of them. */
  readonly lookup: SireLookup;
  readonly sexes: ReturnType<typeof inferAncestorSexes>;
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

  const sireChoices = useMemo(() => bullOptions(lookup, sexes), [lookup, sexes]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      // Whichever way he was picked. A bull on file hands over his id as well
      // as his name, and that reference is what the breeding drawn from this
      // straw inherits — nobody is asked who the sire was a second time in the
      // chute, and the calf is pedigreed from it at calving.
      const chosen = parseSire(sire);
      const named = chosen === undefined ? undefined : strawSire(chosen, lookup);
      if (named === undefined) {
        setError("Name the sire — a straw with no sire cannot pedigree a calf");
        return;
      }

      const result = await api.create({
        ...named,
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
      <Section
        title="Add a sire"
        description={
          <>
            A cane joined to a bull on file carries his pedigree into every breeding drawn from it.
            A bull who is not here yet comes across from the{" "}
            <Link className="text-action underline" href="/admin/cattle/catalog">
              association catalog
            </Link>{" "}
            first — that is what the catalog is for.
          </>
        }
      >
        <form onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <SearchSelect
              label="Sire"
              hint="Our bulls and every ancestor on file. A bull who is neither can be typed in as written on the cane."
              value={sire}
              placeholder="Choose a bull, or type the cane"
              options={sireChoices}
              // Picking one is what joins the cane to a pedigree. Typing is
              // still a real answer — a cane from a bull nobody here will ever
              // own — and it has to be chosen from the list, so nothing is
              // recorded by typing and walking away.
              allowCustom={(typed) => `Use "${typed}" — not on file`}
              onChange={setSire}
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
                <StrawSire entry={entry} lookup={lookup} sexes={sexes} api={api} />

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

/**
 * Which bull this cane is, and joining it to one that is not yet said.
 *
 * A straw carrying only a name is a straw that can never pedigree a calf: the
 * breeding drawn from it inherits the name and nothing else, and at calving
 * the sire column comes up blank. Every cane already in the tank was entered
 * that way, so the join has to be reachable from here rather than only on the
 * form that adds a new one — otherwise the tank has to be deleted and typed in
 * again to gain a pedigree, and nobody will.
 */
function StrawSire({
  entry,
  lookup,
  sexes,
  api,
}: {
  readonly entry: SemenInventory;
  readonly lookup: SireLookup;
  readonly sexes: ReturnType<typeof inferAncestorSexes>;
  readonly api: ReturnType<typeof useMutations<SemenInventory>>;
}) {
  const { show } = useToast();
  const [openForm, setOpenForm] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => bullOptions(lookup, sexes), [lookup, sexes]);

  const bull =
    entry.sireAnimalId === undefined
      ? undefined
      : lookup.animals.find((animal) => animal.id === entry.sireAnimalId);
  const outsider =
    entry.sireExternalId === undefined
      ? undefined
      : lookup.outsiders.find((record) => record.id === entry.sireExternalId);

  async function join() {
    const chosen = parseSire(choice);
    if (chosen === undefined) return;

    setBusy(true);
    try {
      const named = strawSire(chosen, lookup);
      if (named === undefined) return;

      // The name goes with the reference. A cane says a name on it whatever
      // the app decides the bull is, and the two disagreeing is worse than
      // either — so picking a bull renames the straw to what he is called.
      await api.update(entry.id, named as Partial<SemenInventory>);
      setOpenForm(false);
      show({ message: `${named.sireName} joined to this cane` });
    } finally {
      setBusy(false);
    }
  }

  if (bull !== undefined) {
    return (
      <p className="text-sm text-muted">
        <Link className="text-action underline" href={animalHref(bull)}>
          {displayName(bull)}
        </Link>{" "}
        — collected here.
      </p>
    );
  }

  if (outsider !== undefined) {
    const papers = allRegistrations(outsider)
      .map((registration) => `${registration.association} ${registration.regNumber}`)
      .join(" · ");
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Pill tone="identity">on the papers</Pill>
        <span>{papers === "" ? outsider.name : `${outsider.name} · ${papers}`}</span>
      </p>
    );
  }

  if (!openForm) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>A name only — a calf out of this cane cannot be pedigreed from it.</span>
        <Button variant="ghost" onClick={() => setOpenForm(true)}>
          Join to a sire
        </Button>
      </p>
    );
  }

  return (
    <span className="flex flex-wrap items-end gap-2">
      <SearchSelect
        label="Sire"
        hideLabel
        value={choice}
        placeholder={`Who is ${entry.sireName}?`}
        options={options}
        onChange={setChoice}
      />
      <Button onClick={() => void join()} busy={busy} disabled={choice === ""}>
        Join
      </Button>
      <Button variant="ghost" onClick={() => setOpenForm(false)}>
        Cancel
      </Button>
    </span>
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
