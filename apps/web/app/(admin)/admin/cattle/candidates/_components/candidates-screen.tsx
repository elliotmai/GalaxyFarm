"use client";

import { useId, useMemo, useState, type ReactNode } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
  optionLabel,
} from "@galaxy-farm/ui";
import {
  CANDIDATE_STATUSES,
  formatMoney,
  fromDollars,
  purchaseCandidateSchema,
  totalAcquisitionCost,
  type CandidateStatus,
  type Money,
  type PurchaseCandidate,
  type Ulid,
} from "@galaxy-farm/core";
import { CATTLE_SALE_TYPES, type CattleSaleType } from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Cattle under consideration (spec §5.2, §5.9, issue #27).
 *
 * The comparison is the feature, and it sorts on **total acquisition cost**
 * rather than sticker price: a heifer four hundred miles away with a
 * commission on top is not the cheaper animal, and a table sorted on the
 * asking price says she is.
 *
 * The other thing this screen exists to do is make a sale date impossible to
 * miss. "Auction lots are a deadline, not a browse" — a lot you meant to bid
 * on is gone at a time nobody controls, so the days remaining are the one
 * chip on the row rather than in a field somebody has to open.
 *
 * Rows open a side panel with the status ladder and the costs; adding is a
 * side panel too, so neither pushes the comparison down the page.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** The cattle half, as it is stored on the shared candidate. */
interface CattleDetail {
  readonly sex?: string;
  readonly saleType?: CattleSaleType;
  readonly saleDate?: string;
  readonly lotNumber?: string;
  readonly regNumber?: string;
  readonly unpapered?: boolean;
  readonly bred?: boolean;
}

function detailOf(candidate: PurchaseCandidate): CattleDetail {
  return (candidate.domainDetail ?? {}) as CattleDetail;
}

function saleDateOf(candidate: PurchaseCandidate): Date | undefined {
  const raw = detailOf(candidate).saleDate;
  if (raw === undefined || raw === "") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function CattleCandidatesScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: all, loading } = useRecords<PurchaseCandidate>("purchaseCandidates", {
    propertyId,
  });

  const api = useMutations<PurchaseCandidate>(
    "purchaseCandidates",
    "purchaseCandidates",
    purchaseCandidateSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const now = new Date();
  // Only the cattle. The same aggregate serves equipment and horses (§5.9).
  const candidates = useMemo(() => all.filter((entry) => entry.domain === "cattle"), [all]);

  const open = candidates.filter(
    (entry) => entry.status !== "passed" && entry.status !== "purchased",
  );

  /** Anything with a sale date inside a fortnight, soonest first. */
  const deadlines = open
    .map((candidate) => ({ candidate, on: saleDateOf(candidate) }))
    .filter((entry): entry is { candidate: PurchaseCandidate; on: Date } => entry.on !== undefined)
    .filter((entry) => daysUntil(entry.on, now) >= 0 && daysUntil(entry.on, now) <= 14)
    .sort((left, right) => left.on.getTime() - right.on.getTime());

  async function setStatus(candidate: PurchaseCandidate, status: CandidateStatus) {
    await api.update(candidate.id, { status } as Partial<PurchaseCandidate>);
    show({
      message: `${candidate.title} · ${status}`,
      tone: status === "passed" ? "warning" : "success",
    });
  }

  async function remove(candidate: PurchaseCandidate) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: candidate.title,
      entity: "candidate",
      dependents: [],
      // §5.9: what you turned down and why is worth as much next year as what
      // you bought. Passing keeps that; deleting throws it away.
      consequence:
        "Marking it passed keeps the record and the reason. Deleting loses what you turned down and why.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(candidate.id, "Removed from the candidates");
    show({ message: "Candidate deleted", tone: "danger" });
  }

  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<Ulid | undefined>();
  const opened = candidates.find((candidate) => candidate.id === openId);
  const [view, setView] = useState<View>("all");

  const cheapest = open
    .map((candidate) => totalAcquisitionCost(candidate))
    .sort((left, right) => left.cents - right.cents)[0] as Money | undefined;
  const passed = candidates.filter((c) => c.status === "passed").length;

  const counts: Readonly<Record<View, number>> = {
    all: candidates.length,
    open: open.length,
    purchased: candidates.filter((c) => c.status === "purchased").length,
    passed,
  };
  const shown = [...candidates]
    .filter((candidate) => inView(candidate, view))
    .sort((left, right) => totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents);

  /** The sale-date chip: a deadline, coloured by how close it is. */
  const saleChip = (candidate: PurchaseCandidate) => {
    const on = saleDateOf(candidate);
    if (on === undefined) return undefined;
    const days = daysUntil(on, now);
    if (days < 0) return undefined;
    return (
      <Pill tone={days <= 3 ? "danger" : days <= 14 ? "action" : "neutral"} dot={days <= 3}>
        {days === 0 ? "today" : `${days} d`}
      </Pill>
    );
  };

  return (
    <PageBody>
      {/* Bottom clearance on a phone, for the floating button and the tab bar. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <PageHeader
          eyebrow="Cattle"
          title="Candidates"
          subtitle={[
            `${open.length} under consideration`,
            ...(cheapest === undefined ? [] : [`cheapest ${formatMoney(cheapest)} all in`]),
            ...(passed === 0 ? [] : [`${passed} passed`]),
          ].join(" · ")}
          actions={
            // A wrapper hides it on a phone: the button's own `inline-flex`
            // would win over a `hidden` passed to it.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={() => setAdding(true)}>
                <span aria-hidden="true">+</span> Add a candidate
              </Button>
            </span>
          }
        />

        {/*
          The deadlines, only when there are any. "Auction lots are a deadline,
          not a browse" — a lot you meant to bid on is gone at a time nobody
          controls, so they lead, soonest first.
        */}
        {deadlines.length === 0 ? null : (
          <Section title="Sale dates coming up" description="Within a fortnight">
            <ul aria-label="Sale dates coming up" className={LIST}>
              {deadlines.map(({ candidate }) => {
                const detail = detailOf(candidate);
                return (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    line={[
                      `${formatMoney(totalAcquisitionCost(candidate))} all in`,
                      detail.lotNumber === undefined ? undefined : `lot ${detail.lotNumber}`,
                      detail.saleType?.replace(/_/g, " "),
                      candidate.location,
                    ]}
                    chip={saleChip(candidate)}
                    onOpen={() => setOpenId(candidate.id)}
                  />
                );
              })}
            </ul>
          </Section>
        )}

        <Section title="Comparison" description="Cheapest all in first, hauling included.">
          <div
            role="group"
            aria-label="Filter by status"
            className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
          >
            {VIEWS.map((entry) => {
              const on = view === entry.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setView(on ? "all" : entry.key)}
                  className={[
                    "inline-flex min-h-target shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                    on
                      ? "bg-action/15 font-semibold text-action"
                      : "font-medium text-muted hover:bg-raised hover:text-ink",
                  ].join(" ")}
                >
                  {entry.label}
                  <span className="gf-numeric text-xs opacity-80">{counts[entry.key]}</span>
                </button>
              );
            })}
          </div>

          {view === "all" ? null : (
            <p
              className="flex flex-wrap items-center gap-x-2 text-sm text-muted"
              aria-live="polite"
            >
              <span>
                Showing {shown.length} of {candidates.length}
              </span>
              <span aria-hidden="true">·</span>
              <span>{VIEWS.find((entry) => entry.key === view)?.label}</span>
              <button
                type="button"
                onClick={() => setView("all")}
                className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
              >
                Clear
              </button>
            </p>
          )}

          {loading ? (
            <p className="text-muted">Looking…</p>
          ) : shown.length === 0 ? (
            <EmptyState
              title={candidates.length === 0 ? "Nothing under consideration" : "None here"}
              {...(candidates.length === 0
                ? {
                    detail: "Hauling goes on the record, so the comparison is on the real cost.",
                    action: (
                      <Button variant="primary" onClick={() => setAdding(true)}>
                        Add a candidate
                      </Button>
                    ),
                  }
                : { action: <Button onClick={() => setView("all")}>Show all</Button> })}
            />
          ) : (
            <ul aria-label="Cattle candidates" className={LIST}>
              {shown.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  // The all-in figure leads: it is the number the decision is
                  // actually made on, and what the list is sorted by.
                  line={[
                    `${formatMoney(totalAcquisitionCost(candidate))} all in`,
                    `${formatMoney(candidate.askingPrice)} asking`,
                    candidate.status.replace(/_/g, " "),
                    candidate.location,
                  ]}
                  chip={saleChip(candidate)}
                  onOpen={() => setOpenId(candidate.id)}
                />
              ))}
            </ul>
          )}
        </Section>

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            +
          </span>
          Add a candidate
        </button>
      </div>

      {adding ? <AddCandidate api={api} onClose={() => setAdding(false)} /> : null}

      {opened === undefined ? null : (
        <Modal
          title={opened.title}
          placement="side"
          onClose={() => setOpenId(undefined)}
          footer={
            <>
              <Button onClick={() => setOpenId(undefined)}>Done</Button>
              {/* Closed first, so the confirmation is the only dialog showing. */}
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
          {/*
            A candidate walks watching → contacted → inspected → offer_made,
            and ends at purchased, passed or gone. A Pass button alone would
            record only the endings, so the whole ladder is here. Saved on
            change, as it was on the row.
          */}
          <Select
            label="Status"
            value={opened.status}
            onChange={(event) => void setStatus(opened, event.target.value as CandidateStatus)}
            options={CANDIDATE_STATUSES.map((value) => ({
              value,
              label: optionLabel(value),
            }))}
          />
          <DetailList
            items={[
              { label: "All in", value: formatMoney(totalAcquisitionCost(opened)) },
              { label: "Asking", value: formatMoney(opened.askingPrice) },
              ...opened.additionalCosts.map((cost) => ({
                label: cost.label,
                value: formatMoney(cost.amount),
              })),
              { label: "Where", value: opened.location },
              { label: "Sold how", value: detailOf(opened).saleType?.replace(/_/g, " ") },
              { label: "Sale date", value: formatDate(saleDateOf(opened)) },
              { label: "Lot", value: detailOf(opened).lotNumber },
            ]}
          />
        </Modal>
      )}
    </PageBody>
  );
}

const LIST =
  "flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel";

/** The status views offered as chips; pressing the one that is on goes back to all. */
type View = "all" | "open" | "purchased" | "passed";

const VIEWS: readonly { readonly key: View; readonly label: string }[] = [
  { key: "open", label: "Open" },
  { key: "purchased", label: "Purchased" },
  { key: "passed", label: "Passed" },
];

function inView(candidate: PurchaseCandidate, view: View): boolean {
  if (view === "all") return true;
  if (view === "open") return candidate.status !== "passed" && candidate.status !== "purchased";
  return candidate.status === view;
}

/** One candidate: the title, one muted line of facts, at most one chip. */
function CandidateRow({
  candidate,
  line,
  chip,
  onOpen,
}: {
  readonly candidate: PurchaseCandidate;
  readonly line: readonly (string | undefined)[];
  readonly chip: ReactNode;
  readonly onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[60px] w-full items-center gap-3 px-density py-2 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-semibold text-ink">{candidate.title}</span>
          <span className="truncate text-sm text-muted">
            {line.filter((part): part is string => part !== undefined && part !== "").join(" · ")}
          </span>
        </span>
        {chip === undefined ? null : <span className="shrink-0">{chip}</span>}
      </button>
    </li>
  );
}

function AddCandidate({
  api,
  onClose,
}: {
  readonly api: ReturnType<typeof useMutations<PurchaseCandidate>>;
  readonly onClose: () => void;
}) {
  const { show } = useToast();
  const formId = useId();
  const [title, setTitle] = useState("");
  const [asking, setAsking] = useState("");
  const [haul, setHaul] = useState("");
  const [location, setLocation] = useState("");
  const [saleType, setSaleType] = useState<CattleSaleType>("private");
  const [saleDate, setSaleDate] = useState("");
  const [lot, setLot] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.create({
        domain: "cattle",
        title: title.trim(),
        status: "watching",
        askingPrice: fromDollars(Number(asking || "0")),
        // Itemised rather than folded into the price, so the comparison can
        // show why one animal is dearer than her sticker suggests.
        additionalCosts:
          haul === "" ? [] : [{ label: "Hauling", amount: fromDollars(Number(haul)) }],
        ...(location.trim() === "" ? {} : { location: location.trim() }),
        firstSeen: new Date(),
        photoKeys: [],
        pros: [],
        cons: [],
        planStatus: "open",
        // The cattle half rides along on the shared aggregate (§5.9).
        domainDetail: {
          saleType,
          ...(saleDate === "" ? {} : { saleDate }),
          ...(lot.trim() === "" ? {} : { lotNumber: lot.trim() }),
        },
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      onClose();
      show({ message: "Added to the comparison", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a candidate"
      placement="side"
      onClose={onClose}
      footer={
        <>
          {/* Tied to the form by `form`, so it stays pinned while fields scroll. */}
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            Add candidate
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <TextInput
          label="Animal"
          placeholder="Bred Maine heifer, Weatherford"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-density">
          <TextInput
            label="Asking ($)"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={asking}
            onChange={(event) => setAsking(event.target.value)}
            required
          />
          <TextInput
            label="Hauling ($)"
            hint="Counted in the all-in figure."
            type="number"
            inputMode="decimal"
            step="0.01"
            value={haul}
            onChange={(event) => setHaul(event.target.value)}
          />
        </div>
        <TextInput
          label="Where"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
        <Select
          label="Sold how"
          value={saleType}
          onChange={(event) => setSaleType(event.target.value as CattleSaleType)}
          options={CATTLE_SALE_TYPES.map((value) => ({
            value,
            label: optionLabel(value),
          }))}
        />
        <div className="grid grid-cols-2 gap-density">
          <TextInput
            label="Sale date"
            hint="Blank for private treaty."
            type="date"
            value={saleDate}
            onChange={(event) => setSaleDate(event.target.value)}
          />
          <TextInput
            label="Lot number"
            value={lot}
            onChange={(event) => setLot(event.target.value)}
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
