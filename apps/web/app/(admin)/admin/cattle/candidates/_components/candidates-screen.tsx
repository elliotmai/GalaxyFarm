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
  RecordCard,
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
 * on is gone at a time nobody controls, so the days remaining are on the card
 * rather than in a field somebody has to open.
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

  const columns: readonly Column<PurchaseCandidate>[] = [
    { key: "title", header: "Animal", primary: true, render: (c) => c.title },
    {
      key: "status",
      header: "Status",
      render: (c) => <Pill tone={c.status === "passed" ? "neutral" : "action"}>{c.status}</Pill>,
    },
    { key: "asking", header: "Asking", numeric: true, render: (c) => formatMoney(c.askingPrice) },
    {
      key: "total",
      header: "All in",
      numeric: true,
      // The number the decision is actually made on.
      render: (c) => formatMoney(totalAcquisitionCost(c)),
    },
    {
      key: "sale",
      header: "Sale",
      render: (c) => {
        const on = saleDateOf(c);
        if (on === undefined) return <span className="text-muted">—</span>;
        const days = daysUntil(on, now);
        return days < 0 ? (
          <span className="text-muted">{formatDate(on)}</span>
        ) : (
          <Pill tone={days <= 3 ? "danger" : days <= 14 ? "action" : "neutral"} dot={days <= 3}>
            {days === 0 ? "today" : `${days} d`}
          </Pill>
        );
      },
    },
    { key: "where", header: "Where", render: (c) => c.location ?? "—" },
    {
      key: "actions",
      header: "",
      render: (candidate) => (
        <span className="flex flex-wrap items-end gap-2">
          {/*
            A candidate walks watching → contacted → inspected → offer_made,
            and ends at purchased, passed or gone. A Pass button alone would
            record only the endings, so the whole ladder is here.
          */}
          <Select
            label="Status"
            hideLabel
            value={candidate.status}
            onChange={(event) => void setStatus(candidate, event.target.value as CandidateStatus)}
            options={CANDIDATE_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, " "),
            }))}
          />
          <Button variant="ghost" onClick={() => void remove(candidate)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  const cheapest = open
    .map((candidate) => totalAcquisitionCost(candidate))
    .sort((left, right) => left.cents - right.cents)[0] as Money | undefined;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Candidates"
        subtitle="Cattle under consideration, compared on what they would actually cost to get here — not on the asking price."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Under consideration" value={open.length} tone="identity" />
        <Tile
          label="Sale within a fortnight"
          value={deadlines.length}
          tone={deadlines.length > 0 ? "danger" : "neutral"}
          emphasis={deadlines.length > 0}
          hint={deadlines.length > 0 ? "A deadline, not a browse" : undefined}
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

      {deadlines.length === 0 ? null : (
        <Section
          title="Sale dates coming up"
          description="A lot you meant to bid on is gone at a time nobody controls."
        >
          <div className="grid grid-cols-1 gap-density md:grid-cols-2 xl:grid-cols-3">
            {deadlines.map(({ candidate, on }) => {
              const detail = detailOf(candidate);
              const days = daysUntil(on, now);
              return (
                <RecordCard
                  key={candidate.id}
                  tone={days <= 3 ? "danger" : "action"}
                  title={candidate.title}
                  subtitle={candidate.location}
                  actions={
                    <Pill tone={days <= 3 ? "danger" : "action"} dot={days <= 3}>
                      {days === 0 ? "today" : `${days} d`}
                    </Pill>
                  }
                  meta={
                    <>
                      <Pill>{formatMoney(totalAcquisitionCost(candidate))} all in</Pill>
                      {detail.lotNumber === undefined ? null : (
                        <Pill tone="identity">lot {detail.lotNumber}</Pill>
                      )}
                      {detail.saleType === undefined ? null : (
                        <Pill>{detail.saleType.replace(/_/g, " ")}</Pill>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Add a candidate">
        <AddCandidate api={api} />
      </Section>

      <Section
        title="Comparison"
        description="Sorted on total acquisition cost. A cheaper animal four hundred miles away is often not the cheaper animal."
      >
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
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
                  detail="Add a heifer or a show prospect above. Hauling and commission go on the record, so the comparison is on what she would really cost."
                />
              }
            />
          </Card>
        )}
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
      show({ message: "Added to the comparison", tone: "success" });
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
