"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Button,
  DataTable,
  EmptyState,
  Modal,
  PageBody,
  Pill,
  Select,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  compareToBudget,
  daysOnMarket,
  formatMoney,
  isActive,
  isExpiring,
  isPriced,
  purchaseCandidateSchema,
  totalAcquisitionCost,
  type CandidateStatus,
  type Contact,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";
import {
  concerns,
  equipmentSchema,
  pricePerHour,
  pricePerMile,
  type Equipment,
} from "@galaxy-farm/module-equipment";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { AddFab, ChipRow, FilteredLine, KitHeader } from "../../_components/kit-controls";
import { daysUntil, detailOf, num, rate } from "./candidate-format";
import { CandidateForm } from "./candidate-form";
import { CandidatePanel } from "./candidate-panel";

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
 *
 * The comparison table stays a table — comparing is reading across — and a
 * row opens the candidate's panel, which carries what used to be a card per
 * candidate below the table and the controls that used to fill its last
 * column. Adding and editing are a side panel of their own.
 */

/** Which side panel is open. */
type Panel =
  | { readonly kind: "view"; readonly id: Ulid }
  | { readonly kind: "edit"; readonly editing?: PurchaseCandidate }
  | { readonly kind: "filters" };

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

  const [panel, setPanel] = useState<Panel | undefined>();
  /** "", "over", "soon" or "closed" — the chip that is on. */
  const [view, setView] = useState("");
  // `?item=` arrives from a roadmap row's "Compare" link.
  const [filter, setFilter] = useState(params.get("item") ?? "");

  const now = new Date();

  const candidates = useMemo(() => all.filter((entry) => entry.domain === "equipment"), [all]);
  const items = useMemo(() => allItems.filter((item) => item.domain === "equipment"), [allItems]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const budgetOf = (entry: PurchaseCandidate) =>
    entry.roadmapItemId === undefined
      ? undefined
      : itemById.get(entry.roadmapItemId)?.budgetEstimate;

  // An unpriced candidate is never over budget — nor under it. Its costs on
  // top alone are not an all-in figure to compare.
  const isOver = (entry: PurchaseCandidate) => {
    const budget = budgetOf(entry);
    return budget !== undefined && isPriced(entry) && compareToBudget(entry, budget).overBudget;
  };

  const open = candidates.filter(isActive);
  const expiring = open.filter((entry) => isExpiring(entry, now, 14));
  /** Candidates whose all-in cost has crossed the budget on their own want. */
  const overBudget = open.filter(isOver);
  const closed = candidates.filter((entry) => !isActive(entry));

  const againstWant = candidates.filter((entry) => filter === "" || entry.roadmapItemId === filter);
  const shown = (
    view === "closed"
      ? againstWant.filter((entry) => !isActive(entry))
      : view === "over"
        ? againstWant.filter((entry) => isActive(entry) && isOver(entry))
        : view === "soon"
          ? againstWant.filter((entry) => isExpiring(entry, now, 14))
          : againstWant.filter(isActive)
  )
    .slice()
    // Cheapest all-in first; the ones with no price yet after every priced
    // one, rather than first as $0 would put them.
    .sort(
      (left, right) =>
        Number(!isPriced(left)) - Number(!isPriced(right)) ||
        totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents,
    );

  const cheapest = shown
    .filter((entry) => isActive(entry) && isPriced(entry))
    .map((entry) => totalAcquisitionCost(entry))
    .sort((left, right) => left.cents - right.cents)[0];

  const chips = [
    { key: "", label: "Open", count: open.length },
    ...(overBudget.length === 0
      ? []
      : [{ key: "over", label: "Over budget", count: overBudget.length }]),
    ...(expiring.length === 0
      ? []
      : [{ key: "soon", label: "Closing soon", count: expiring.length }]),
    ...(closed.length === 0
      ? []
      : [{ key: "closed", label: "Bought, passed or gone", count: closed.length }]),
  ];

  const wantName = filter === "" ? undefined : itemById.get(filter as Ulid)?.title;

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
      // the comparison was decided on. Bought before a price was written
      // down, it is left for the machine's own panel rather than set to the
      // costs on top alone.
      purchasePrice: isPriced(candidate) ? totalAcquisitionCost(candidate) : undefined,
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

    await api.remove(candidate.id, "Removed from the candidates");
    show({
      message: "Candidate deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void api.restoreRecord(candidate.id) },
    });
  }

  const close = () => setPanel(undefined);

  const columns: readonly Column<PurchaseCandidate>[] = [
    {
      key: "title",
      header: "Unit",
      primary: true,
      // The row's way in: the panel with the concerns, the costs and the
      // status. A real button, so it is reachable from a keyboard.
      render: (row) => {
        const detail = detailOf(row);
        const sub =
          [detail.year, detail.make, detail.model].filter(Boolean).join(" ") || row.location;
        return (
          <button
            type="button"
            onClick={() => setPanel({ kind: "view", id: row.id })}
            className="flex min-h-target flex-col items-start justify-center gap-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          >
            <span className="font-semibold text-ink underline decoration-edge underline-offset-4 hover:decoration-action">
              {row.title}
            </span>
            {sub === undefined || sub === "" ? null : (
              <span className="text-xs text-muted">{sub}</span>
            )}
          </button>
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
      key: "total",
      header: "All in",
      numeric: true,
      // The number the decision is made on.
      render: (row) =>
        isPriced(row) ? (
          <span className="font-semibold">{formatMoney(totalAcquisitionCost(row))}</span>
        ) : (
          <span className="text-muted">No price</span>
        ),
    },
    {
      key: "budget",
      header: "vs budget",
      numeric: true,
      render: (row) => {
        const budget = budgetOf(row);
        if (budget === undefined || !isPriced(row)) return <span className="text-muted">—</span>;
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
      key: "flags",
      header: "Flags",
      numeric: true,
      // A count, so the table says which rows are worth opening; the panel
      // says what they are.
      render: (row) => {
        const detail = detailOf(row);
        const count = concerns({
          ...detail,
          candidateId: row.id,
          category: detail.category ?? "vehicle",
          serviceHistoryAvailable: detail.serviceHistoryAvailable ?? false,
        }).length;
        return count === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-danger">{count}</span>
        );
      },
    },
  ];

  const facts = [
    `${open.length} open`,
    cheapest === undefined ? undefined : `cheapest ${formatMoney(cheapest)} all in`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  const viewing =
    panel?.kind === "view" ? candidates.find((entry) => entry.id === panel.id) : undefined;

  const startCreate = () => setPanel({ kind: "edit" });

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader
          eyebrow="Farm"
          title="Equipment candidates"
          facts={loading ? undefined : facts}
          action={
            <Button variant="primary" onClick={startCreate}>
              <span aria-hidden="true">+</span> Add candidate
            </Button>
          }
        />

        {/*
          A sale date is a deadline nobody controls but the seller, so the ones
          inside a fortnight are said up top — one line each, each the way in.
        */}
        {expiring.length === 0 ? null : (
          <ul aria-label="About to go" className="flex flex-col text-sm">
            {expiring.map((entry) => {
              const days = entry.expiresAt === undefined ? 0 : daysUntil(entry.expiresAt, now);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setPanel({ kind: "view", id: entry.id })}
                    className="inline-flex min-h-target items-center text-left text-danger underline-offset-2 hover:underline"
                  >
                    {days <= 0 ? "Goes today" : `Goes in ${days} d`}: {entry.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {candidates.length === 0 ? null : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ChipRow
                label="Filter the candidates"
                chips={chips}
                value={view}
                onChange={setView}
              />
            </div>
            {items.length === 0 ? null : (
              <Button aria-haspopup="dialog" onClick={() => setPanel({ kind: "filters" })}>
                Want{filter === "" ? "" : " (1)"}
              </Button>
            )}
          </div>
        )}

        <FilteredLine
          shown={shown.length}
          total={candidates.length}
          parts={[
            ...(wantName === undefined
              ? filter === ""
                ? []
                : ["Against a deleted want"]
              : [`Against ${wantName}`]),
            ...(view === "" ? [] : [chips.find((chip) => chip.key === view)?.label ?? view]),
          ]}
          onClear={() => {
            setFilter("");
            setView("");
          }}
        />

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          // Sorted on total acquisition cost. Price per mile and per hour divide
          // that same figure, the only honest way to weigh a low-hour expensive
          // unit against a high-hour cheap one.
          <div className="sm:rounded-density sm:border sm:border-rule sm:bg-panel sm:px-density">
            <DataTable
              caption="Equipment candidates, cheapest all-in first"
              columns={columns}
              rows={shown}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title={
                    candidates.length === 0 ? "Nothing under consideration" : "Nothing in this view"
                  }
                  detail={
                    candidates.length === 0
                      ? "Add the truck you keep opening the listing for, with hauling, inspection and tyres, so the comparison is on what it would really cost."
                      : undefined
                  }
                  action={
                    candidates.length === 0 ? (
                      <Button variant="primary" onClick={startCreate}>
                        Add the first candidate
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setFilter("");
                          setView("");
                        }}
                      >
                        Clear filters
                      </Button>
                    )
                  }
                />
              }
            />
          </div>
        )}

        <AddFab label="Add candidate" onClick={startCreate} />
      </div>

      {viewing === undefined ? null : (
        <CandidatePanel
          candidate={viewing}
          want={
            viewing.roadmapItemId === undefined ? undefined : itemById.get(viewing.roadmapItemId)
          }
          onStatus={(status: CandidateStatus) => {
            // Buying closes the panel: the toast's "Open it" is the next step,
            // and the candidate is not the thing to look at any more.
            if (status === "purchased") close();
            void setStatus(viewing, status);
          }}
          onEdit={() => setPanel({ kind: "edit", editing: viewing })}
          onDelete={() => {
            close();
            void remove(viewing);
          }}
          onClose={close}
        />
      )}

      {panel?.kind === "edit" ? (
        <CandidateForm
          key={panel.editing?.id ?? "new"}
          editing={panel.editing}
          defaultItemId={filter}
          items={items}
          contacts={contacts}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={
            panel.editing === undefined
              ? undefined
              : () => {
                  const candidate = panel.editing;
                  close();
                  if (candidate !== undefined) void remove(candidate);
                }
          }
        />
      ) : null}

      {panel?.kind === "filters" ? (
        <Modal
          title="Which want"
          placement="side"
          onClose={close}
          footer={
            <>
              <Button variant="primary" onClick={close}>
                Show {shown.length}
              </Button>
              {filter === "" ? null : (
                <Button variant="ghost" onClick={() => setFilter("")}>
                  Clear
                </Button>
              )}
            </>
          }
        >
          <Select
            label="Want"
            value={filter}
            placeholder="Everything"
            onChange={(event) => setFilter(event.target.value)}
            options={items.map((item) => ({ value: item.id, label: item.title }))}
          />
        </Modal>
      ) : null}
    </PageBody>
  );
}
