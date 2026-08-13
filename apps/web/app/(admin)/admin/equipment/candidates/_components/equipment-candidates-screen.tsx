"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TagInput,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  CANDIDATE_STATUSES,
  compareToBudget,
  daysOnMarket,
  formatMoney,
  fromDollars,
  isActive,
  isExpiring,
  purchaseCandidateSchema,
  totalAcquisitionCost,
  type AdditionalCost,
  type CandidateStatus,
  type Contact,
  type Money,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";
import {
  concerns,
  CONDITIONS,
  EQUIPMENT_CATEGORIES,
  equipmentSchema,
  pricePerHour,
  pricePerMile,
  TITLE_STATUSES,
  type Condition,
  type Equipment,
  type EquipmentCandidateDetail,
  type EquipmentCategory,
  type TitleStatus,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Equipment under consideration (spec §5.6, §5.1, §7's
 * `/admin/equipment/candidates`).
 *
 * The comparison is the feature, and it sorts on **total acquisition cost**:
 * §5.1 is explicit that the sticker price "is the one number that never
 * decides anything", and a tractor three hundred miles away with a $900 haul
 * and a set of tyres to buy is not the cheap one.
 *
 * §5.6 adds the two figures that make different machines comparable at all —
 * price per mile and price per hour — and both divide the all-in cost rather
 * than the asking price, for the same reason. A low-hour expensive unit and a
 * high-hour cheap one cannot be argued about honestly any other way.
 *
 * Marking one **purchased** creates the `Equipment` record from it (§5.1's
 * planned-to-actual pattern), carrying the price, the seller, the photos and
 * everything the detail knows. Marking one **passed** keeps it, with the
 * reason: what you turned down and why is worth as much next year as what you
 * bought.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function num(value: number | undefined, decimals = 0): string {
  return value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/** Cents to the dollar and a half — $0.34/mi reads better than $0/mi. */
function rate(value: Money | undefined): string {
  return value === undefined
    ? "—"
    : `$${(value.cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

function detailOf(candidate: PurchaseCandidate): Partial<EquipmentCandidateDetail> {
  return (candidate.domainDetail ?? {}) as Partial<EquipmentCandidateDetail>;
}

/** How long it has been sitting, which is a negotiating position. */
function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

interface Draft {
  readonly title: string;
  readonly roadmapItemId: string;
  readonly status: CandidateStatus;
  readonly asking: string;
  readonly listingUrl: string;
  readonly sellerId: string;
  readonly location: string;
  readonly distanceMiles: string;
  readonly listedDate: string;
  readonly expiresAt: string;
  readonly notes: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly additionalCosts: readonly { label: string; amount: string }[];
  // The equipment half (§5.6).
  readonly category: EquipmentCategory;
  readonly make: string;
  readonly model: string;
  readonly year: string;
  readonly mileage: string;
  readonly engineHours: string;
  readonly vin: string;
  readonly condition: string;
  readonly titleStatus: string;
  readonly serviceHistoryAvailable: boolean;
  readonly warrantyRemaining: string;
  readonly knownFaults: string;
  readonly wearCondition: string;
}

const BLANK: Draft = {
  title: "",
  roadmapItemId: "",
  status: "watching",
  asking: "",
  listingUrl: "",
  sellerId: "",
  location: "",
  distanceMiles: "",
  listedDate: "",
  expiresAt: "",
  notes: "",
  pros: [],
  cons: [],
  // The three that turn up on nearly every purchase, offered rather than
  // typed. §5.1 wants them itemised; blank rows cost nothing and are dropped.
  additionalCosts: [
    { label: "Hauling", amount: "" },
    { label: "Inspection", amount: "" },
    { label: "Immediate repairs", amount: "" },
  ],
  category: "vehicle",
  make: "",
  model: "",
  year: "",
  mileage: "",
  engineHours: "",
  vin: "",
  condition: "",
  titleStatus: "",
  serviceHistoryAvailable: false,
  warrantyRemaining: "",
  knownFaults: "",
  wearCondition: "",
};

export function EquipmentCandidatesScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const query = { propertyId };
  const { records: all, loading } = useRecords<PurchaseCandidate>("purchaseCandidates", query);
  const { records: allItems } = useRecords<RoadmapItem>("roadmapItems", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const api = useMutations<PurchaseCandidate>(
    "purchaseCandidates",
    "purchaseCandidates",
    purchaseCandidateSchema,
    propertyId,
    actorId,
  );
  // Marking one purchased writes an Equipment record, which is the whole point
  // of the planned-to-actual pattern: the plan becomes the fact in one tap.
  const fleetApi = useMutations<Equipment>(
    "equipment",
    "equipment",
    equipmentSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<PurchaseCandidate | undefined>();
  const [draft, setDraft] = useState<Draft>(() => ({
    ...BLANK,
    roadmapItemId: params.get("item") ?? "",
  }));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  // `?item=` arrives from a roadmap card's "Compare" link.
  const [filter, setFilter] = useState(params.get("item") ?? "");

  const now = new Date();

  const candidates = useMemo(() => all.filter((entry) => entry.domain === "equipment"), [all]);
  const items = allItems.filter((item) => item.domain === "equipment");
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const shown = candidates
    .filter((entry) => filter === "" || entry.roadmapItemId === filter)
    .filter((entry) => showClosed || isActive(entry));

  const open = candidates.filter(isActive);
  const expiring = open.filter((entry) => isExpiring(entry, now, 14));

  const cheapest = shown
    .filter(isActive)
    .map((entry) => totalAcquisitionCost(entry))
    .sort((left, right) => left.cents - right.cents)[0];

  /** Candidates whose all-in cost has crossed the budget on their own want. */
  const overBudget = open.filter((entry) => {
    const budget =
      entry.roadmapItemId === undefined
        ? undefined
        : itemById.get(entry.roadmapItemId)?.budgetEstimate;
    return budget !== undefined && compareToBudget(entry, budget).overBudget;
  });

  function reset() {
    setEditing(undefined);
    setDraft({ ...BLANK, roadmapItemId: filter });
    setError(undefined);
  }

  function startEdit(candidate: PurchaseCandidate) {
    const detail = detailOf(candidate);
    setEditing(candidate);
    setDraft({
      title: candidate.title,
      roadmapItemId: candidate.roadmapItemId ?? "",
      status: candidate.status,
      asking: (candidate.askingPrice.cents / 100).toFixed(2),
      listingUrl: candidate.listingUrl ?? "",
      sellerId: candidate.sellerId ?? "",
      location: candidate.location ?? "",
      distanceMiles: candidate.distanceMiles === undefined ? "" : String(candidate.distanceMiles),
      listedDate:
        candidate.listedDate === undefined ? "" : candidate.listedDate.toISOString().slice(0, 10),
      expiresAt:
        candidate.expiresAt === undefined ? "" : candidate.expiresAt.toISOString().slice(0, 10),
      notes: candidate.notes ?? "",
      pros: candidate.pros,
      cons: candidate.cons,
      additionalCosts:
        candidate.additionalCosts.length === 0
          ? BLANK.additionalCosts
          : candidate.additionalCosts.map((cost) => ({
              label: cost.label,
              amount: (cost.amount.cents / 100).toFixed(2),
            })),
      category: detail.category ?? "vehicle",
      make: detail.make ?? "",
      model: detail.model ?? "",
      year: detail.year === undefined ? "" : String(detail.year),
      mileage: detail.mileage === undefined ? "" : String(detail.mileage),
      engineHours: detail.engineHours === undefined ? "" : String(detail.engineHours),
      vin: detail.vin ?? "",
      condition: detail.condition ?? "",
      titleStatus: detail.titleStatus ?? "",
      serviceHistoryAvailable: detail.serviceHistoryAvailable ?? false,
      warrantyRemaining: detail.warrantyRemaining ?? "",
      knownFaults: detail.knownFaults ?? "",
      wearCondition: detail.wearCondition ?? "",
    });
    setError(undefined);
    if (typeof globalThis.scrollTo === "function")
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const costs: AdditionalCost[] = draft.additionalCosts
        .filter(
          (cost) => cost.label.trim() !== "" && cost.amount !== "" && Number(cost.amount) !== 0,
        )
        .map((cost) => ({ label: cost.label.trim(), amount: fromDollars(Number(cost.amount)) }));

      const payload = {
        domain: "equipment" as const,
        title: draft.title.trim(),
        status: draft.status,
        roadmapItemId: draft.roadmapItemId === "" ? undefined : (draft.roadmapItemId as Ulid),
        askingPrice: fromDollars(Number(draft.asking || "0")),
        additionalCosts: costs,
        listingUrl: draft.listingUrl.trim() === "" ? undefined : draft.listingUrl.trim(),
        sellerId: draft.sellerId === "" ? undefined : (draft.sellerId as Ulid),
        location: draft.location.trim() === "" ? undefined : draft.location.trim(),
        distanceMiles: draft.distanceMiles === "" ? undefined : Number(draft.distanceMiles),
        listedDate: draft.listedDate === "" ? undefined : new Date(`${draft.listedDate}T12:00:00`),
        firstSeen: editing?.firstSeen ?? new Date(),
        expiresAt: draft.expiresAt === "" ? undefined : new Date(`${draft.expiresAt}T12:00:00`),
        photoKeys: editing?.photoKeys ?? [],
        pros: [...draft.pros],
        cons: [...draft.cons],
        notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
        planStatus: editing?.planStatus ?? ("open" as const),
        // The equipment half rides on the shared aggregate (§5.1). Undefined
        // keys are dropped so the stored detail says only what is known.
        domainDetail: Object.fromEntries(
          Object.entries({
            category: draft.category,
            make: draft.make.trim() === "" ? undefined : draft.make.trim(),
            model: draft.model.trim() === "" ? undefined : draft.model.trim(),
            year: draft.year === "" ? undefined : Number(draft.year),
            mileage: draft.mileage === "" ? undefined : Number(draft.mileage),
            engineHours: draft.engineHours === "" ? undefined : Number(draft.engineHours),
            vin: draft.vin.trim() === "" ? undefined : draft.vin.trim(),
            condition: draft.condition === "" ? undefined : draft.condition,
            titleStatus: draft.titleStatus === "" ? undefined : draft.titleStatus,
            serviceHistoryAvailable: draft.serviceHistoryAvailable,
            warrantyRemaining:
              draft.warrantyRemaining.trim() === "" ? undefined : draft.warrantyRemaining.trim(),
            knownFaults: draft.knownFaults.trim() === "" ? undefined : draft.knownFaults.trim(),
            wearCondition:
              draft.wearCondition.trim() === "" ? undefined : draft.wearCondition.trim(),
          }).filter(([, value]) => value !== undefined),
        ),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<PurchaseCandidate>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({
        message: editing === undefined ? "Added to the comparison" : "Candidate updated",
        tone: "success",
      });
      reset();
    } finally {
      setBusy(false);
    }
  }

  /**
   * The plan becomes the fact (§5.1).
   *
   * The machine is created first and the candidate marked realised only once
   * it exists — a candidate claiming to have become a machine that was never
   * written would leave nothing to open and nothing to prompt for again.
   */
  async function purchase(candidate: PurchaseCandidate) {
    const detail = detailOf(candidate);
    const created = await fleetApi.create({
      name: candidate.title,
      category: detail.category ?? "vehicle",
      status: "in_service",
      make: detail.make,
      model: detail.model,
      year: detail.year,
      vin: detail.vin,
      purchasedOn: new Date(),
      // What it actually cost to get here, not the sticker — the same figure
      // the comparison was decided on.
      purchasePrice: totalAcquisitionCost(candidate),
      photoKeys: [...candidate.photoKeys],
      notes: candidate.notes,
    } as never);

    if (!created.ok) {
      show({ message: "Could not create the machine", tone: "danger" });
      return;
    }

    await api.update(candidate.id, {
      status: "purchased",
      planStatus: "realised",
      realisedAs: created.value.id,
      realisedAt: new Date(),
    } as Partial<PurchaseCandidate>);

    show({
      message: `Bought. ${candidate.title} is in the fleet.`,
      tone: "success",
      action: {
        label: "Open it",
        onAct: () => router.push(`/admin/equipment/${created.value.id}`),
      },
    });
  }

  async function setStatus(candidate: PurchaseCandidate, status: CandidateStatus) {
    if (status === "purchased") {
      await purchase(candidate);
      return;
    }

    await api.update(candidate.id, {
      status,
      // Passing is an ending, and §5.1 wants the ending kept rather than the
      // record thrown away.
      ...(status === "passed"
        ? { planStatus: "abandoned" as const, abandonedReason: "Passed on it" }
        : {}),
    } as Partial<PurchaseCandidate>);

    show({
      message: `${candidate.title} · ${status.replace(/_/g, " ")}`,
      tone: status === "passed" || status === "gone" ? "warning" : "success",
    });
  }

  async function remove(candidate: PurchaseCandidate) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: candidate.title,
      entity: "candidate",
      dependents:
        candidate.realisedAs === undefined
          ? []
          : [{ entity: "Machine", label: candidate.title, effect: "detached" as const }],
      consequence:
        candidate.realisedAs === undefined
          ? "Marking it passed keeps the record and the reason. Deleting loses what you turned down and why."
          : "The machine it became stays in the fleet. Only the record of shopping for it is deleted.",
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === candidate.id) reset();
    await api.remove(candidate.id, "Removed from the candidates");
    show({
      message: "Candidate deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void api.restoreRecord(candidate.id) },
    });
  }

  const columns: readonly Column<PurchaseCandidate>[] = [
    {
      key: "title",
      header: "Unit",
      primary: true,
      render: (row) => {
        const detail = detailOf(row);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-ink">{row.title}</span>
            <span className="text-xs text-muted">
              {[detail.year, detail.make, detail.model].filter(Boolean).join(" ") || row.location}
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Pill
          tone={
            row.status === "purchased"
              ? "calm"
              : row.status === "passed" || row.status === "gone"
                ? "neutral"
                : "action"
          }
        >
          {row.status.replace(/_/g, " ")}
        </Pill>
      ),
    },
    {
      key: "asking",
      header: "Asking",
      numeric: true,
      render: (row) => formatMoney(row.askingPrice),
    },
    {
      key: "total",
      header: "All in",
      numeric: true,
      // The number the decision is made on.
      render: (row) => (
        <span className="font-semibold">{formatMoney(totalAcquisitionCost(row))}</span>
      ),
    },
    {
      key: "budget",
      header: "vs budget",
      numeric: true,
      render: (row) => {
        const budget =
          row.roadmapItemId === undefined
            ? undefined
            : itemById.get(row.roadmapItemId)?.budgetEstimate;
        if (budget === undefined) return <span className="text-muted">—</span>;
        const against = compareToBudget(row, budget);
        return (
          <span className={against.overBudget ? "text-danger" : "text-calm"}>
            {against.overBudget ? "+" : "−"}
            {formatMoney({ cents: Math.abs(against.difference.cents) })}
          </span>
        );
      },
    },
    {
      key: "miles",
      header: "Miles",
      numeric: true,
      render: (row) => num(detailOf(row).mileage),
    },
    {
      key: "hours",
      header: "Hours",
      numeric: true,
      render: (row) => num(detailOf(row).engineHours, 1),
    },
    {
      key: "permile",
      header: "$/mile",
      numeric: true,
      render: (row) => rate(pricePerMile(row, detailOf(row))),
    },
    {
      key: "perhour",
      header: "$/hour",
      numeric: true,
      render: (row) => rate(pricePerHour(row, detailOf(row))),
    },
    {
      key: "distance",
      header: "Away",
      numeric: true,
      render: (row) => (row.distanceMiles === undefined ? "—" : `${num(row.distanceMiles)} mi`),
    },
    {
      key: "age",
      header: "Listed",
      numeric: true,
      render: (row) => `${num(daysOnMarket(row, now))} d`,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap items-end gap-2">
          <Select
            label={`Status for ${row.title}`}
            hideLabel
            value={row.status}
            onChange={(event) => void setStatus(row, event.target.value as CandidateStatus)}
            options={CANDIDATE_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, " "),
            }))}
          />
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Kit"
        title="Equipment candidates"
        subtitle="What you are actually looking at, compared on what it would cost to get here and keep running — not on the asking price."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Under consideration" value={open.length} tone="identity" />
        <Tile
          label="Listing or sale within a fortnight"
          value={expiring.length}
          tone={expiring.length > 0 ? "danger" : "neutral"}
          emphasis={expiring.length > 0}
        />
        <Tile
          label="Cheapest all in"
          value={cheapest === undefined ? "—" : formatMoney(cheapest)}
          hint={filter === "" ? "Across everything open" : "Against this want"}
        />
        <Tile
          label="Over budget"
          value={overBudget.length}
          tone={overBudget.length > 0 ? "action" : "neutral"}
          hint={overBudget.length > 0 ? "All-in cost past the roadmap figure" : undefined}
        />
      </div>

      {expiring.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${expiring.length} listing${expiring.length === 1 ? "" : "s"} about to go`}
        >
          {expiring
            .map((entry) => {
              const days = entry.expiresAt === undefined ? 0 : daysUntil(entry.expiresAt, now);
              return `${entry.title} — ${days <= 0 ? "today" : `${days} d`}`;
            })
            .join("; ")}
          . A sale date is a deadline nobody controls but the seller.
        </Callout>
      )}

      <Section
        title={editing === undefined ? "Add a candidate" : `Edit ${editing.title}`}
        description="Every cost that only shows up after you say yes goes in as its own line, because that is what makes the all-in figure worth sorting on."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="What it is"
              hint="&ldquo;2018 F-250, Weatherford&rdquo;"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              required
            />
            <Select
              label="Against which want"
              value={draft.roadmapItemId}
              placeholder="Not on the roadmap"
              onChange={(event) => setDraft({ ...draft, roadmapItemId: event.target.value })}
              options={items.map((item) => ({
                value: item.id,
                label:
                  item.budgetEstimate === undefined
                    ? item.title
                    : `${item.title} · ${formatMoney(item.budgetEstimate)}`,
              }))}
            />
            <Select
              label="Category"
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value as EquipmentCategory })
              }
              options={EQUIPMENT_CATEGORIES.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Asking ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={draft.asking}
              onChange={(event) => setDraft({ ...draft, asking: event.target.value })}
              required
            />
            <TextInput
              label="Where"
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            />
            <TextInput
              label="Miles away"
              hint="One way. It is most of what hauling costs."
              type="number"
              inputMode="decimal"
              numeric
              value={draft.distanceMiles}
              onChange={(event) => setDraft({ ...draft, distanceMiles: event.target.value })}
            />
            <TextInput
              label="Make"
              value={draft.make}
              onChange={(event) => setDraft({ ...draft, make: event.target.value })}
            />
            <TextInput
              label="Model"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <TextInput
              label="Year"
              type="number"
              inputMode="numeric"
              numeric
              value={draft.year}
              onChange={(event) => setDraft({ ...draft, year: event.target.value })}
            />
            <TextInput
              label="Mileage"
              type="number"
              inputMode="numeric"
              numeric
              value={draft.mileage}
              onChange={(event) => setDraft({ ...draft, mileage: event.target.value })}
            />
            <TextInput
              label="Engine hours"
              type="number"
              inputMode="decimal"
              step="0.1"
              numeric
              value={draft.engineHours}
              onChange={(event) => setDraft({ ...draft, engineHours: event.target.value })}
            />
            <TextInput
              label="VIN or serial"
              value={draft.vin}
              onChange={(event) => setDraft({ ...draft, vin: event.target.value })}
            />
            <Select
              label="Condition"
              value={draft.condition}
              placeholder="Not judged yet"
              onChange={(event) => setDraft({ ...draft, condition: event.target.value })}
              options={CONDITIONS.map((value: Condition) => ({ value, label: value }))}
            />
            <Select
              label="Title"
              value={draft.titleStatus}
              placeholder="Not asked yet"
              onChange={(event) => setDraft({ ...draft, titleStatus: event.target.value })}
              options={TITLE_STATUSES.map((value: TitleStatus) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
            <Select
              label="Seller"
              value={draft.sellerId}
              placeholder="Not recorded"
              onChange={(event) => setDraft({ ...draft, sellerId: event.target.value })}
              options={contacts.map((contact) => ({ value: contact.id, label: contact.name }))}
            />
            <TextInput
              label="Listing link"
              type="url"
              value={draft.listingUrl}
              onChange={(event) => setDraft({ ...draft, listingUrl: event.target.value })}
            />
            <TextInput
              label="Listed on"
              type="date"
              value={draft.listedDate}
              onChange={(event) => setDraft({ ...draft, listedDate: event.target.value })}
            />
            <TextInput
              label="Sale or expiry date"
              hint="A lot is a deadline. Leave blank for a private treaty."
              type="date"
              value={draft.expiresAt}
              onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
            />
            <TextInput
              label="Warranty left"
              value={draft.warrantyRemaining}
              onChange={(event) => setDraft({ ...draft, warrantyRemaining: event.target.value })}
            />
            <TextInput
              label="Known faults"
              value={draft.knownFaults}
              onChange={(event) => setDraft({ ...draft, knownFaults: event.target.value })}
            />
            <TextInput
              label="Tyres, tracks or wear"
              value={draft.wearCondition}
              onChange={(event) => setDraft({ ...draft, wearCondition: event.target.value })}
            />
            <Checkbox
              label="Service history available"
              checked={draft.serviceHistoryAvailable}
              onChange={(event) =>
                setDraft({ ...draft, serviceHistoryAvailable: event.target.checked })
              }
            />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
              Costs on top
            </legend>
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
              {draft.additionalCosts.map((cost, index) => (
                <div key={index} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <TextInput
                      label={`Cost ${index + 1}`}
                      hideLabel
                      placeholder="What for"
                      value={cost.label}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          additionalCosts: draft.additionalCosts.map((entry, at) =>
                            at === index ? { ...entry, label: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="w-32">
                    <TextInput
                      label={`Amount ${index + 1}`}
                      hideLabel
                      placeholder="$"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      numeric
                      value={cost.amount}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          additionalCosts: draft.additionalCosts.map((entry, at) =>
                            at === index ? { ...entry, amount: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    additionalCosts: [...draft.additionalCosts, { label: "", amount: "" }],
                  })
                }
              >
                Another cost
              </Button>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-density md:grid-cols-2">
            <TagInput
              label="Pros"
              hint="Your own words. This is what the conversation away from the screen is made of."
              value={draft.pros}
              onChange={(pros) => setDraft({ ...draft, pros })}
            />
            <TagInput
              label="Cons"
              value={draft.cons}
              onChange={(cons) => setDraft({ ...draft, cons })}
            />
          </div>

          <TextInput
            label="Notes"
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editing === undefined ? "Add candidate" : "Save candidate"}
            </Button>
            {editing === undefined ? null : (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>

      <Section
        title="Comparison"
        description="Sorted on total acquisition cost. Price per mile and per hour divide that same figure, which is the only honest way to weigh a low-hour expensive unit against a high-hour cheap one."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Want"
              value={filter}
              placeholder="Everything"
              onChange={(event) => setFilter(event.target.value)}
              options={items.map((item) => ({ value: item.id, label: item.title }))}
            />
            <Checkbox
              label="Show bought, passed and gone"
              checked={showClosed}
              onChange={(event) => setShowClosed(event.target.checked)}
            />
          </div>
        }
      >
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="Equipment candidates, cheapest all-in first"
              columns={columns}
              rows={[...shown].sort(
                (left, right) =>
                  totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents,
              )}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title={
                    candidates.length === 0 ? "Nothing under consideration" : "Nothing in this view"
                  }
                  detail={
                    candidates.length === 0
                      ? "Add the truck you keep opening the listing for. Hauling, inspection and the tyres it needs go on the record, so the comparison is on what it would really cost."
                      : "Everything against this want has been bought, passed or gone. Tick the box to see it."
                  }
                />
              }
            />
          </Card>
        )}
      </Section>

      {shown.length === 0 ? null : (
        <Section
          title="Worth being told"
          description="Not a score. A decision this size is made by a person weighing these against each other, and a single number would flatten exactly the things worth weighing."
        >
          <div className="grid grid-cols-1 gap-density md:grid-cols-2 xl:grid-cols-3">
            {shown.map((candidate) => {
              const detail = detailOf(candidate);
              const flags = concerns({
                ...detail,
                candidateId: candidate.id,
                category: detail.category ?? "vehicle",
                // Absent reads as "not asked yet", which is itself a concern —
                // §5.6 flags a missing service history, and a candidate nobody
                // has asked is exactly the one nobody should assume about.
                serviceHistoryAvailable: detail.serviceHistoryAvailable ?? false,
              });
              const want =
                candidate.roadmapItemId === undefined
                  ? undefined
                  : itemById.get(candidate.roadmapItemId);

              return (
                <Card
                  key={candidate.id}
                  title={candidate.title}
                  actions={
                    candidate.listingUrl === undefined ? undefined : (
                      <Link
                        href={candidate.listingUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-action underline"
                      >
                        Listing
                      </Link>
                    )
                  }
                >
                  <div className="flex flex-col gap-3">
                    {want === undefined ? null : (
                      <p className="text-sm text-muted">Against &ldquo;{want.title}&rdquo;</p>
                    )}

                    {flags.length === 0 ? (
                      <p className="text-sm text-calm">Nothing flagged.</p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-sm text-danger">
                        {flags.map((flag) => (
                          <li key={flag}>{flag}</li>
                        ))}
                      </ul>
                    )}

                    {candidate.pros.length === 0 && candidate.cons.length === 0 ? null : (
                      <div className="flex flex-wrap gap-1.5">
                        {candidate.pros.map((pro) => (
                          <Pill key={pro} tone="calm">
                            {pro}
                          </Pill>
                        ))}
                        {candidate.cons.map((con) => (
                          <Pill key={con} tone="danger">
                            {con}
                          </Pill>
                        ))}
                      </div>
                    )}

                    {candidate.additionalCosts.length === 0 ? (
                      <p className="text-sm text-muted">
                        No costs on top — asking price is the all-in figure.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-sm">
                        {candidate.additionalCosts.map((cost) => (
                          <li key={cost.label} className="flex justify-between gap-2">
                            <span className="text-muted">{cost.label}</span>
                            <span className="[font-variant-numeric:tabular-nums]">
                              {formatMoney(cost.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {candidate.expiresAt === undefined ? null : (
                      <p className="text-sm text-muted">
                        Sale or expiry {formatDate(candidate.expiresAt)}
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      )}
    </PageBody>
  );
}
