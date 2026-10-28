"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  SearchSelect,
  Select,
  Tabs,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { displayName, formatMoney, fromDollars, type Animal, type Ulid } from "@galaxy-farm/core";
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
 *
 * Status by exception: what is low or going out of date is one line each above
 * the tabs, and a quiet line when nothing is. Each inventory is a list of rows
 * with one chip, and adding to one is a side panel opened from the header.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type TabId = "semen" | "meds" | "protocols";

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: "semen", label: "Semen tank" },
  { id: "meds", label: "Medicine fridge" },
  { id: "protocols", label: "Sync protocols" },
];

/** What the header's one button adds, on each tab. */
const ADD_LABEL: Readonly<Record<TabId, string>> = {
  semen: "Add a sire",
  meds: "Add a product",
  protocols: "Add a protocol",
};

const LIST =
  "flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel";

const ICON_BUTTON =
  "inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action disabled:opacity-40";

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

  const [tab, setTab] = useState<TabId>("semen");
  // Which tab's add panel is open. Held here so the header and the floating
  // button on a phone can both open it; the tab owns the form itself.
  const [adding, setAdding] = useState<TabId | undefined>();

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

  const strawCount = straws.reduce((total, entry) => total + entry.strawsOnHand, 0);
  const activeProtocols = protocols.filter((protocol) => protocol.active).length;

  return (
    <PageBody>
      {/* Bottom clearance on a phone, for the floating button and the tab bar. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <PageHeader
          eyebrow="Cattle"
          title="Tank and fridge"
          subtitle={`${strawCount} straw${strawCount === 1 ? "" : "s"} · ${meds.length} product${meds.length === 1 ? "" : "s"} · ${activeProtocols} protocol${activeProtocols === 1 ? "" : "s"}`}
          actions={
            // A wrapper hides it on a phone: the button's own `inline-flex`
            // would win over a `hidden` passed to it.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={() => setAdding(tab)}>
                <span aria-hidden="true">+</span> {ADD_LABEL[tab]}
              </Button>
            </span>
          }
        />

        {/*
          What is running out, one line each, and one quiet line when nothing
          is. Each line is also the way to the tab it is about. Expired stock
          stays in the count: a bottle that went out of date last month is
          still in the fridge, and still the one somebody reaches for at six in
          the morning.
        */}
        <div className="flex flex-col gap-1 text-sm" aria-live="polite">
          {lowStraws.length === 0 && expiringMeds.length === 0 ? (
            <p className="text-muted">Everything stocked and in date.</p>
          ) : null}
          {lowStraws.length === 0 ? null : (
            <p className="text-danger">
              {lowStraws.length} sire{lowStraws.length === 1 ? "" : "s"} at or below reorder.{" "}
              {tab === "semen" ? null : (
                <button
                  type="button"
                  onClick={() => setTab("semen")}
                  className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
                >
                  Show them
                </button>
              )}
            </p>
          )}
          {expiringMeds.length === 0 ? null : (
            <p className="text-danger">
              {expiringMeds.length} product{expiringMeds.length === 1 ? "" : "s"} expiring within{" "}
              {leadDays} days
              {expired.length === 0 ? "" : ` (${expired.length} already out of date)`}.{" "}
              {tab === "meds" ? null : (
                <button
                  type="button"
                  onClick={() => setTab("meds")}
                  className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
                >
                  Show them
                </button>
              )}
            </p>
          )}
        </div>

        <Tabs
          tabs={TABS}
          label="Cattle supplies"
          activeTab={tab}
          onTabChange={(id) => setTab(id as TabId)}
        >
          {(active) =>
            active === "semen" ? (
              <SemenTab
                straws={straws}
                lookup={lookup}
                sexes={sexes}
                propertyId={propertyId}
                actorId={actorId}
                adding={adding === "semen"}
                onAdding={(open) => setAdding(open ? "semen" : undefined)}
              />
            ) : active === "meds" ? (
              <MedsTab
                meds={meds}
                now={now}
                leadDays={leadDays}
                onLeadDays={setLeadDays}
                propertyId={propertyId}
                actorId={actorId}
                adding={adding === "meds"}
                onAdding={(open) => setAdding(open ? "meds" : undefined)}
              />
            ) : (
              <ProtocolsTab
                protocols={protocols}
                propertyId={propertyId}
                actorId={actorId}
                adding={adding === "protocols"}
                onAdding={(open) => setAdding(open ? "protocols" : undefined)}
              />
            )
          }
        </Tabs>

        <button
          type="button"
          onClick={() => setAdding(tab)}
          className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            +
          </span>
          {ADD_LABEL[tab]}
        </button>
      </div>
    </PageBody>
  );
}

/** One row of an inventory: a bold name, one muted line, one chip, its controls. */
function SupplyRow({
  title,
  line,
  chip,
  children,
}: {
  readonly title: ReactNode;
  readonly line: ReactNode;
  readonly chip?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    // Wraps rather than squeezes: on a phone the chip and the controls drop
    // under the name instead of leaving the name a few letters wide.
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 pl-density pr-1">
      <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5 py-1">
        <span className="truncate font-semibold text-ink">{title}</span>
        <span className="text-sm text-muted">{line}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {chip === undefined ? null : <span className="mr-1">{chip}</span>}
        {children}
      </span>
    </li>
  );
}

function PencilIcon() {
  return (
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
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** The validation message a failed write came back with, in words. */
function failure(error: {
  readonly kind: string;
  readonly issues?: readonly { message: string }[];
}) {
  return error.kind === "validation"
    ? (error.issues?.[0]?.message ?? "That is not valid")
    : "Could not save that";
}

function SemenTab({
  straws,
  lookup,
  sexes,
  propertyId,
  actorId,
  adding,
  onAdding,
}: {
  readonly straws: readonly SemenInventory[];
  /** Our bulls and the ancestors on file, to join a cane to one of them. */
  readonly lookup: SireLookup;
  readonly sexes: ReturnType<typeof inferAncestorSexes>;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly adding: boolean;
  readonly onAdding: (open: boolean) => void;
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
  // The cane open in its panel, and whether it opened straight onto the join.
  const [open, setOpen] = useState<{ readonly id: Ulid; readonly joining: boolean } | undefined>();
  const opened = open === undefined ? undefined : straws.find((entry) => entry.id === open.id);

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
    <>
      {straws.length === 0 ? (
        <EmptyState
          title="The tank is empty"
          detail="Straws drawn for an AI breeding come off here."
          action={
            <Button variant="primary" onClick={() => onAdding(true)}>
              Add a sire
            </Button>
          }
        />
      ) : (
        <ul aria-label="In the tank" className={LIST}>
          {straws.map((entry) => {
            const low = isLowSemenInventory(entry);
            const where = [
              entry.tank === undefined ? undefined : `Tank ${entry.tank}`,
              entry.canister === undefined ? undefined : `canister ${entry.canister}`,
              entry.cane === undefined ? undefined : `cane ${entry.cane}`,
              entry.reorderThreshold === undefined
                ? undefined
                : `reorder at ${entry.reorderThreshold}`,
            ].filter((part): part is string => part !== undefined);
            const joined = sireOf(entry, lookup);
            return (
              <SupplyRow
                key={entry.id}
                title={entry.sireName}
                line={
                  <>
                    {[...(joined === undefined ? [] : [joined.line]), ...where].join(" · ")}
                    {joined === undefined ? (
                      // The one state of a cane worth a control on its row: a
                      // name only, which a calf can never be pedigreed from.
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>Name only — a calf out of it cannot be pedigreed.</span>
                        <button
                          type="button"
                          onClick={() => setOpen({ id: entry.id, joining: true })}
                          className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
                        >
                          Join to a sire
                        </button>
                      </span>
                    ) : null}
                  </>
                }
                chip={
                  <Pill tone={entry.strawsOnHand === 0 || low ? "danger" : "neutral"} dot={low}>
                    {entry.strawsOnHand} straw{entry.strawsOnHand === 1 ? "" : "s"}
                  </Pill>
                }
              >
                <button
                  type="button"
                  aria-label={`Draw one straw of ${entry.sireName}`}
                  onClick={() => void draw(entry, -1)}
                  disabled={entry.strawsOnHand === 0}
                  className={ICON_BUTTON}
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    −
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Add one straw of ${entry.sireName}`}
                  onClick={() => void draw(entry, 1)}
                  className={ICON_BUTTON}
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    +
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${entry.sireName}`}
                  onClick={() => setOpen({ id: entry.id, joining: false })}
                  className={ICON_BUTTON}
                >
                  <PencilIcon />
                </button>
              </SupplyRow>
            );
          })}
        </ul>
      )}

      {adding ? (
        <AddStraw lookup={lookup} sexes={sexes} api={api} onClose={() => onAdding(false)} />
      ) : null}

      {opened === undefined || open === undefined ? null : (
        <Modal
          title={opened.sireName}
          placement="side"
          onClose={() => setOpen(undefined)}
          footer={
            <>
              <Button onClick={() => setOpen(undefined)}>Close</Button>
              {/* Closed first, so the confirmation is the only dialog showing. */}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  setOpen(undefined);
                  void remove(opened);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <DetailList
            items={[
              { label: "On hand", value: opened.strawsOnHand },
              { label: "Reorder at", value: opened.reorderThreshold },
              { label: "Tank", value: opened.tank },
              { label: "Canister", value: opened.canister },
              { label: "Cane", value: opened.cane },
              {
                label: "Price per straw",
                value:
                  opened.pricePerStraw === undefined
                    ? undefined
                    : formatMoney(opened.pricePerStraw),
              },
            ]}
          />
          <StrawSire
            entry={opened}
            lookup={lookup}
            sexes={sexes}
            api={api}
            startOpen={open.joining}
            onJoined={() => setOpen(undefined)}
          />
        </Modal>
      )}
    </>
  );
}

/** Who a cane is joined to, as the row's line says it — or undefined for a name only. */
function sireOf(
  entry: SemenInventory,
  lookup: SireLookup,
): { readonly line: string; readonly bull?: Animal } | undefined {
  const bull =
    entry.sireAnimalId === undefined
      ? undefined
      : lookup.animals.find((animal) => animal.id === entry.sireAnimalId);
  if (bull !== undefined) return { line: "Collected here", bull };

  const outsider =
    entry.sireExternalId === undefined
      ? undefined
      : lookup.outsiders.find((record) => record.id === entry.sireExternalId);
  if (outsider === undefined) return undefined;

  const papers = allRegistrations(outsider)
    .map((registration) => `${registration.association} ${registration.regNumber}`)
    .join(" · ");
  return { line: papers === "" ? "On the papers" : papers };
}

function AddStraw({
  lookup,
  sexes,
  api,
  onClose,
}: {
  readonly lookup: SireLookup;
  readonly sexes: ReturnType<typeof inferAncestorSexes>;
  readonly api: ReturnType<typeof useMutations<SemenInventory>>;
  readonly onClose: () => void;
}) {
  const { show } = useToast();
  const formId = useId();
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
        setError(failure(result.error));
        return;
      }
      onClose();
      show({ message: "Added to the tank", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a sire"
      placement="side"
      onClose={onClose}
      footer={
        <>
          {/* Tied to the form by `form`, so it stays pinned while fields scroll. */}
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            Add to the tank
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
        <SearchSelect
          label="Sire"
          hint="Picking a bull on file carries his pedigree into every breeding from this cane."
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
        {/* A bull not here yet is brought across from the catalog first —
            that is what the catalog is for. */}
        <p className="-mt-2 text-sm text-muted">
          Not on file?{" "}
          <Link className="text-action underline" href="/admin/cattle/catalog">
            Find him in the catalog
          </Link>
        </p>
        <div className="grid grid-cols-2 gap-density">
          <TextInput
            label="Straws"
            type="number"
            inputMode="numeric"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            required
          />
          <TextInput
            label="Reorder at"
            type="number"
            inputMode="numeric"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <TextInput label="Tank" value={tank} onChange={(event) => setTank(event.target.value)} />
          <TextInput
            label="Canister"
            value={canister}
            onChange={(event) => setCanister(event.target.value)}
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
      </form>
    </Modal>
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
  startOpen,
  onJoined,
}: {
  readonly entry: SemenInventory;
  readonly lookup: SireLookup;
  readonly sexes: ReturnType<typeof inferAncestorSexes>;
  readonly api: ReturnType<typeof useMutations<SemenInventory>>;
  /** Opened from the row's "Join to a sire", straight onto the picker. */
  readonly startOpen: boolean;
  readonly onJoined: () => void;
}) {
  const { show } = useToast();
  const [openForm, setOpenForm] = useState(startOpen);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => bullOptions(lookup, sexes), [lookup, sexes]);
  const joined = sireOf(entry, lookup);

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
      onJoined();
      show({ message: `${named.sireName} joined to this cane` });
    } finally {
      setBusy(false);
    }
  }

  if (joined?.bull !== undefined) {
    return (
      <p className="text-sm text-muted">
        <Link className="text-action underline" href={animalHref(joined.bull)}>
          {displayName(joined.bull)}
        </Link>{" "}
        — collected here.
      </p>
    );
  }

  if (joined !== undefined) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Pill tone="identity">on the papers</Pill>
        <span>{joined.line}</span>
      </p>
    );
  }

  if (!openForm) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>A name only.</span>
        <Button variant="ghost" onClick={() => setOpenForm(true)}>
          Join to a sire
        </Button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-density">
      <SearchSelect
        label="Sire"
        hint="Picking a bull renames the cane to what he is called."
        value={choice}
        placeholder={`Who is ${entry.sireName}?`}
        options={options}
        onChange={setChoice}
      />
      <span className="flex flex-wrap gap-2">
        <Button onClick={() => void join()} busy={busy} disabled={choice === ""}>
          Join
        </Button>
        <Button variant="ghost" onClick={() => setOpenForm(false)}>
          Cancel
        </Button>
      </span>
    </div>
  );
}

function MedsTab({
  meds,
  now,
  leadDays,
  onLeadDays,
  propertyId,
  actorId,
  adding,
  onAdding,
}: {
  readonly meds: readonly MedInventory[];
  readonly now: Date;
  readonly leadDays: number;
  readonly onLeadDays: (days: number) => void;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly adding: boolean;
  readonly onAdding: (open: boolean) => void;
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

  // What is going out of date first, soonest at the top — the old "coming out
  // of date" section, folded into the list it duplicated.
  const expiring = new Set(expiringSoon(meds, now, leadDays).map((entry) => entry.id));
  const ordered = [...meds].sort((left, right) => {
    const soon = Number(expiring.has(right.id)) - Number(expiring.has(left.id));
    if (soon !== 0) return soon;
    return (left.expiresOn?.getTime() ?? Infinity) - (right.expiresOn?.getTime() ?? Infinity);
  });

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
      <div className="flex justify-end">
        <Select
          label="Warn me this far ahead"
          hideLabel
          value={String(leadDays)}
          onChange={(event) => onLeadDays(Number(event.target.value))}
          options={[
            { value: "14", label: "Warn 14 days ahead" },
            { value: "30", label: "Warn 30 days ahead" },
            { value: "60", label: "Warn 60 days ahead" },
            { value: "90", label: "Warn 90 days ahead" },
          ]}
        />
      </div>

      {meds.length === 0 ? (
        <EmptyState
          title="Nothing in the fridge"
          detail="A product's withdrawal period fills in on every treatment given from it."
          action={
            <Button variant="primary" onClick={() => onAdding(true)}>
              Add a product
            </Button>
          }
        />
      ) : (
        <ul aria-label="In the fridge" className={LIST}>
          {ordered.map((entry) => {
            const out = isExpired(entry, now);
            const days =
              entry.expiresOn === undefined
                ? undefined
                : Math.ceil((entry.expiresOn.getTime() - now.getTime()) / 86_400_000);
            const line = [
              entry.category,
              `${entry.onHand.amount} ${entry.onHand.unit}`,
              entry.expiresOn === undefined
                ? undefined
                : `${out ? "expired" : "expires"} ${formatDate(entry.expiresOn)}`,
              entry.defaultWithdrawalDays === undefined
                ? undefined
                : `${entry.defaultWithdrawalDays} d withdrawal`,
            ].filter((part): part is string => part !== undefined);
            return (
              <SupplyRow
                key={entry.id}
                title={entry.product}
                line={line.join(" · ")}
                chip={
                  out ? (
                    <Pill tone="danger" dot>
                      Expired
                    </Pill>
                  ) : expiring.has(entry.id) && days !== undefined ? (
                    <Pill tone="action">{days} d left</Pill>
                  ) : undefined
                }
              >
                <Button variant="ghost" onClick={() => void remove(entry)}>
                  Delete
                </Button>
              </SupplyRow>
            );
          })}
        </ul>
      )}

      {adding ? <AddMed api={api} onClose={() => onAdding(false)} /> : null}
    </div>
  );
}

function AddMed({
  api,
  onClose,
}: {
  readonly api: ReturnType<typeof useMutations<MedInventory>>;
  readonly onClose: () => void;
}) {
  const { show } = useToast();
  const formId = useId();
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
        setError(failure(result.error));
        return;
      }
      onClose();
      show({ message: "Added to the fridge", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a product"
      placement="side"
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            Add to the fridge
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
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
        <div className="grid grid-cols-2 gap-density">
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
        </div>
        <TextInput
          label="Withdrawal (days)"
          hint="Copied onto every treatment from this bottle."
          type="number"
          inputMode="numeric"
          value={withdrawal}
          onChange={(event) => setWithdrawal(event.target.value)}
        />
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function ProtocolsTab({
  protocols,
  propertyId,
  actorId,
  adding,
  onAdding,
}: {
  readonly protocols: readonly SyncProtocol[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly adding: boolean;
  readonly onAdding: (open: boolean) => void;
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
  // The protocol whose steps are open. Read back off the live list, so a step
  // added in the panel shows there the moment it is written.
  const [openId, setOpenId] = useState<Ulid | undefined>();
  const opened = protocols.find((protocol) => protocol.id === openId);

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

  const ordered = (protocol: SyncProtocol) =>
    [...protocol.steps].sort((left, right) => left.dayOffset - right.dayOffset);

  return (
    <>
      {protocols.length === 0 ? (
        <EmptyState
          title="No protocols yet"
          detail="A protocol turns one date into a schedule of dated steps."
          action={
            <Button variant="primary" onClick={() => onAdding(true)}>
              Add a protocol
            </Button>
          }
        />
      ) : (
        <ul aria-label="Protocols" className={LIST}>
          {protocols.map((protocol) => (
            <SupplyRow
              key={protocol.id}
              title={protocol.name}
              line={ordered(protocol)
                .map((step) => `Day ${step.dayOffset} ${step.label}`)
                .join(" · ")}
              chip={protocol.active ? undefined : <Pill tone="neutral">Inactive</Pill>}
            >
              <button
                type="button"
                aria-label={`Edit ${protocol.name}`}
                onClick={() => setOpenId(protocol.id)}
                className={ICON_BUTTON}
              >
                <PencilIcon />
              </button>
            </SupplyRow>
          ))}
        </ul>
      )}

      {adding ? (
        <AddProtocol
          api={api}
          onClose={() => onAdding(false)}
          onCreated={(id) => {
            onAdding(false);
            // Straight on to its steps: it was saved with only the first one.
            setOpenId(id);
          }}
        />
      ) : null}

      {opened === undefined ? null : (
        <Modal
          title={opened.name}
          placement="side"
          onClose={() => setOpenId(undefined)}
          footer={
            <>
              <Button onClick={() => setOpenId(undefined)}>Done</Button>
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  setOpenId(undefined);
                  void remove(opened);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <ol className="flex flex-col divide-y divide-rule rounded-density border border-rule">
            {ordered(opened).map((step, index) => (
              <li
                key={`${step.dayOffset}-${step.action}-${index}`}
                className="flex items-baseline gap-3 px-density py-2 text-density"
              >
                <span className="gf-numeric w-14 shrink-0 text-sm text-muted">
                  Day {step.dayOffset}
                </span>
                <span className="text-ink">{step.label}</span>
              </li>
            ))}
          </ol>
          <AddStep onAdd={(day, action, label) => void addStep(opened, day, action, label)} />
        </Modal>
      )}
    </>
  );
}

/**
 * A protocol starts with one step and grows.
 *
 * The schema requires at least one, and a form that made somebody build the
 * whole seven-step CIDR sequence before it would save is a form nobody
 * finishes standing at a chute.
 */
function AddProtocol({
  api,
  onClose,
  onCreated,
}: {
  readonly api: ReturnType<typeof useMutations<SyncProtocol>>;
  readonly onClose: () => void;
  readonly onCreated: (id: Ulid) => void;
}) {
  const { show } = useToast();
  const formId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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
        setError(failure(result.error));
        return;
      }
      onCreated(result.value.id);
      show({ message: "Protocol added — add its steps", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a protocol"
      description="Starts with CIDR in on day 0; add the rest next."
      placement="side"
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            Add protocol
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void add(event)} className="flex flex-col gap-density">
        <TextInput
          label="Name"
          placeholder="7-day CO-Synch + CIDR"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
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
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[6rem_1fr] gap-density">
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
      </div>
      <span>
        <Button onClick={() => onAdd(Number(day), action, action.replace(/_/g, " "))}>
          Add step
        </Button>
      </span>
    </div>
  );
}
