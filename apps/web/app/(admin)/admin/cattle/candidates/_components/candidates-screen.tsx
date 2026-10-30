"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
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

import { candidateDetail, saleEndOf } from "./candidate-detail";
import { LotCard, countdownLabel } from "./lot-card";

/**
 * Cattle under consideration (spec §5.2, §5.9, issue #27), laid out as a sale.
 *
 * The lots are the page: a photo, a lot number, the next bid and a running
 * count to close, the way an auction site presents them. The comparison table
 * below is still there for the question the lots cannot answer on their own,
 * which is what each animal would cost all in. "Auction lots are a deadline,
 * not a browse" — so the default order is the one closing soonest.
 */

const STATUS_FILTERS: readonly {
  readonly value: "open" | CandidateStatus;
  readonly label: string;
}[] = [
  { value: "open", label: "All open" },
  ...CANDIDATE_STATUSES.filter(
    (status) => status !== "purchased" && status !== "passed" && status !== "gone",
  ).map((status) => ({ value: status, label: status.replace(/_/g, " ") })),
  { value: "passed", label: "Passed" },
];

const SORTS = ["ending", "price", "lot", "newest"] as const;
type Sort = (typeof SORTS)[number];

const SORT_LABEL: Readonly<Record<Sort, string>> = {
  ending: "Closing soonest",
  price: "Lowest next bid",
  lot: "Lot number",
  newest: "Newest listed",
};

/** Still a live question: not yet bought, passed on, or gone from the sale. */
function isOpen(candidate: PurchaseCandidate): boolean {
  return (
    candidate.status !== "passed" && candidate.status !== "purchased" && candidate.status !== "gone"
  );
}

/** Closing soonest first, lots with no end time last. */
function byEnding(left: PurchaseCandidate, right: PurchaseCandidate): number {
  const a = saleEndOf(left)?.getTime() ?? Number.POSITIVE_INFINITY;
  const b = saleEndOf(right)?.getTime() ?? Number.POSITIVE_INFINITY;
  return a - b;
}

function compareFor(sort: Sort): (left: PurchaseCandidate, right: PurchaseCandidate) => number {
  switch (sort) {
    case "ending":
      return byEnding;
    case "price":
      return (left, right) => left.askingPrice.cents - right.askingPrice.cents;
    case "lot":
      return (left, right) =>
        (candidateDetail(left).lotNumber ?? "").localeCompare(
          candidateDetail(right).lotNumber ?? "",
          undefined,
          {
            numeric: true,
          },
        );
    case "newest":
      return (left, right) => right.firstSeen.getTime() - left.firstSeen.getTime();
  }
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
  const [filter, setFilter] = useState<"open" | CandidateStatus>("open");
  const [sort, setSort] = useState<Sort>("ending");

  const now = new Date();
  // Only the cattle. The same aggregate serves equipment and horses (§5.9).
  const candidates = useMemo(() => all.filter((entry) => entry.domain === "cattle"), [all]);

  const open = candidates.filter(isOpen);

  const visible = useMemo(() => {
    const matching =
      filter === "open"
        ? candidates.filter(isOpen)
        : candidates.filter((entry) => entry.status === filter);
    return [...matching].sort(compareFor(sort));
  }, [candidates, filter, sort]);

  const closingSoon = open.filter((candidate) => {
    const ends = saleEndOf(candidate);
    if (ends === undefined) return false;
    const label = countdownLabel(ends, now);
    return (
      label !== undefined && label !== "Closed" && ends.getTime() - now.getTime() <= 86_400_000
    );
  });

  const cheapest = open
    .map((candidate) => totalAcquisitionCost(candidate))
    .sort((left, right) => left.cents - right.cents)[0] as Money | undefined;

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

  const columns: readonly Column<PurchaseCandidate>[] = [
    { key: "title", header: "Lot", primary: true, render: (c) => c.title },
    {
      key: "status",
      header: "Status",
      render: (c) => <Pill tone={c.status === "passed" ? "neutral" : "action"}>{c.status}</Pill>,
    },
    { key: "asking", header: "Next bid", numeric: true, render: (c) => formatMoney(c.askingPrice) },
    {
      key: "total",
      header: "All in",
      numeric: true,
      // The number the decision is actually made on.
      render: (c) => formatMoney(totalAcquisitionCost(c)),
    },
    {
      key: "sale",
      header: "Closes",
      render: (c) => countdownLabel(saleEndOf(c), now) ?? "—",
    },
    { key: "where", header: "Where", render: (c) => c.location ?? "—" },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Candidates"
        subtitle="Lots from the sales you are watching, and anything you have added by hand. Ordered by what closes first."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Under consideration" value={open.length} tone="identity" />
        <Tile
          label="Closing within a day"
          value={closingSoon.length}
          tone={closingSoon.length > 0 ? "danger" : "neutral"}
          emphasis={closingSoon.length > 0}
          hint={closingSoon.length > 0 ? "A deadline, not a browse" : undefined}
        />
        <Tile
          label="Cheapest all-in"
          value={cheapest === undefined ? "—" : formatMoney(cheapest)}
        />
        <Tile
          label="Passed"
          value={candidates.filter((c) => c.status === "passed").length}
          hint="Kept, with the reason"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={[
                "rounded-full border px-3 py-1 text-sm capitalize transition-colors",
                filter === option.value
                  ? "border-action bg-action text-white"
                  : "border-edge bg-surface text-ink hover:border-action",
              ].join(" ")}
            >
              {option.label}
              <span className="ml-1.5 tabular-nums text-xs opacity-70">
                {option.value === "open"
                  ? open.length
                  : candidates.filter((c) => c.status === option.value).length}
              </span>
            </button>
          ))}
        </div>
        <Select
          label="Sort"
          hideLabel
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          options={SORTS.map((value) => ({ value, label: SORT_LABEL[value] }))}
        />
      </div>

      {loading ? (
        <p className="text-muted">Looking…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No lots here"
          detail="Lots from the sales you watch arrive here on their own. Add one by hand below if you have a private treaty."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((candidate) => (
            <LotCard
              key={candidate.id}
              candidate={candidate}
              now={now}
              onStatus={(status) => void setStatus(candidate, status)}
              onDelete={() => void remove(candidate)}
            />
          ))}
        </div>
      )}

      <Section
        title="Comparison"
        description="Sorted on total acquisition cost. A cheaper animal four hundred miles away is often not the cheaper animal."
      >
        {loading ? null : (
          <Card>
            <DataTable
              caption="Cattle candidates"
              columns={columns}
              rows={[...candidates].sort(
                (left, right) =>
                  totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents,
              )}
              rowKey={(candidate) => candidate.id}
              empty={
                <EmptyState
                  title="Nothing under consideration"
                  detail="Add a heifer or a show prospect below. Hauling and commission go on the record, so the comparison is on what it would really cost."
                />
              }
            />
          </Card>
        )}
      </Section>

      <Section title="Add a candidate">
        <AddCandidate api={api} />
      </Section>
    </PageBody>
  );
}

function AddCandidate({
  api,
}: {
  readonly api: ReturnType<typeof useMutations<PurchaseCandidate>>;
}) {
  const { show } = useToast();
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
      setTitle("");
      setAsking("");
      setHaul("");
      setLot("");
      show({ message: "Added to the candidates", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
        <TextInput
          label="Animal"
          hint="&ldquo;Bred Maine heifer, Weatherford&rdquo;"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
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
          hint="Counted in the all-in figure the comparison sorts on."
          type="number"
          inputMode="decimal"
          step="0.01"
          value={haul}
          onChange={(event) => setHaul(event.target.value)}
        />
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
            label: value.replace(/_/g, " "),
          }))}
        />
        <TextInput
          label="Sale date"
          hint="A lot is a deadline. Leave blank for a private treaty."
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

      <Button type="submit" busy={busy}>
        Add candidate
      </Button>
    </form>
  );
}
