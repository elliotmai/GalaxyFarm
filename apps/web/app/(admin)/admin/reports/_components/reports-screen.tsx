"use client";

import { useState } from "react";

import {
  Button,
  Card,
  Callout,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  Tabs,
  TextInput,
  Tile,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  formatMoney,
  type Animal,
  type FeedingPlan,
  type PastureCareLog,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type {
  AcquisitionRecord,
  HealthRecord,
  ProcessingRecord,
  SaleRecord,
} from "@galaxy-farm/module-cattle";
import type { FeedPurchase, FeedType } from "@galaxy-farm/module-feed";

import { csvFilename, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import {
  REPORTS_AWAITING_MODULES,
  capitalPlan,
  daysBetween,
  feedSpend,
  herdGrowth,
  herdProfitAndLoss,
  operatingCost,
  processingYields,
  type CapitalRow,
  type FeedSpendRow,
  type GrowthRow,
  type OperatingLine,
  type PnlRow,
  type ReportRange,
  type YieldRow,
} from "@/lib/reports";
import { useRecords } from "@/lib/local/use-records";

/**
 * The reports suite (spec §6, §7).
 *
 * Five reports that the modules built so far can actually answer, one tab
 * each, every one of them exportable to CSV. The four that need a module which
 * does not sync to devices yet are named at the bottom rather than left as a
 * gap somebody has to work out for themselves.
 *
 * **Every report states its window and what it could not price.** A herd whose
 * feed has never been catalogued shows a flattering profit; a total that did
 * not say so would be arithmetically right and practically misleading, and
 * these are numbers somebody makes a decision on.
 */

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "custom", label: "Between two dates" },
] as const;

const dateInput = (value: Date): string => value.toISOString().slice(0, 10);
const percent = (value: number | undefined): string =>
  value === undefined ? "—" : `${value.toFixed(1)}%`;
const formatDate = (value: Date): string =>
  value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function ReportsScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: acquisitions } = useRecords<AcquisitionRecord>("acquisitionRecords", query);
  const { records: sales } = useRecords<SaleRecord>("saleRecords", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: processing } = useRecords<ProcessingRecord>("processingRecords", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: purchases } = useRecords<FeedPurchase>("feedPurchases", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: roadmap } = useRecords<RoadmapItem>("roadmapItems", query);
  const { records: candidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);
  const { records: pastureCare } = useRecords<PastureCareLog>("pastureCareLogs", query);

  const { show } = useToast();
  const now = new Date();

  const [period, setPeriod] = useState<string>("365");
  const [from, setFrom] = useState(() => dateInput(new Date(now.getTime() - 365 * 86_400_000)));
  const [to, setTo] = useState(() => dateInput(now));

  /**
   * The window every figure on this page is computed over.
   *
   * A named period wins over the two boxes so that switching back to "Last 90
   * days" is not silently ignored because somebody typed dates earlier.
   */
  const range: ReportRange =
    period === "custom"
      ? { from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59`) }
      : { from: new Date(now.getTime() - Number(period) * 86_400_000), to: now };

  const pnl = herdProfitAndLoss(
    { animals, acquisitions, sales, health, processing, plans, purchases, assignments },
    range,
  );
  const feedRows = feedSpend(purchases, feeds, range);
  const yields = processingYields(processing, animals, range);
  const growth = herdGrowth(animals, roadmap, now);
  const capital = capitalPlan(roadmap, candidates);
  const operating = operatingCost(
    { purchases, health, acquisitions, processing, pastureCare },
    range,
  );
  const spent = operating.reduce((total, line) => total + line.spend.cents, 0);
  const unpriced = operating.reduce((total, line) => total + line.unpriced, 0);

  function exportCsv<T>(report: string, columns: readonly CsvColumn<T>[], rows: readonly T[]) {
    if (rows.length === 0) {
      show({ message: "Nothing to export in this window", tone: "warning" });
      return;
    }

    downloadCsv(csvFilename(report, now), toCsv(columns, rows));
    show({ message: `${report} exported`, tone: "success" });
  }

  const pnlColumns: readonly Column<PnlRow>[] = [
    { key: "name", header: "Animal", render: (row) => row.name },
    { key: "status", header: "Status", render: (row) => row.status },
    { key: "cost", header: "Cost", render: (row) => formatMoney(row.totalCost) },
    { key: "feed", header: "of which feed", render: (row) => formatMoney(row.feedCost) },
    { key: "revenue", header: "Revenue", render: (row) => formatMoney(row.totalRevenue) },
    {
      key: "net",
      header: "Net",
      render: (row) => (
        <span className={row.net.cents < 0 ? "text-danger" : "text-calm"}>
          {formatMoney(row.net)}
        </span>
      ),
    },
    {
      key: "complete",
      header: "",
      render: (row) => (row.complete ? null : <Pill tone="action">partial</Pill>),
    },
  ];

  const feedColumns: readonly Column<FeedSpendRow>[] = [
    { key: "name", header: "Feed", render: (row) => row.name },
    { key: "category", header: "Category", render: (row) => row.category },
    {
      key: "quantity",
      header: "Bought",
      render: (row) => `${row.quantity} ${row.unit.replace(/_/g, " ")}`,
    },
    { key: "pounds", header: "Pounds", render: (row) => row.pounds?.toLocaleString() ?? "—" },
    {
      key: "average",
      header: "Average unit",
      render: (row) => (row.averageUnitCost === undefined ? "—" : formatMoney(row.averageUnitCost)),
    },
    { key: "spend", header: "Spend", render: (row) => formatMoney(row.spend) },
  ];

  const yieldColumns: readonly Column<YieldRow>[] = [
    { key: "name", header: "Animal", render: (row) => row.name },
    { key: "date", header: "Delivered", render: (row) => formatDate(row.deliveredOn) },
    { key: "live", header: "Live lb", render: (row) => row.liveWeightLb ?? "—" },
    { key: "hanging", header: "Hanging lb", render: (row) => row.hangingWeightLb ?? "—" },
    { key: "dressing", header: "Dressing", render: (row) => percent(row.dressingPercent) },
    { key: "cutting", header: "Cutting yield", render: (row) => percent(row.cuttingYieldPercent) },
    { key: "kept", header: "Kept lb", render: (row) => row.poundsKept },
    { key: "sold", header: "Sold lb", render: (row) => row.poundsSold },
    {
      key: "perlb",
      header: "$/lb realised",
      render: (row) => (row.pricePerLbSold === undefined ? "—" : formatMoney(row.pricePerLbSold)),
    },
    { key: "revenue", header: "Revenue", render: (row) => formatMoney(row.revenue) },
  ];

  const capitalColumns: readonly Column<CapitalRow>[] = [
    { key: "title", header: "Want", render: (row) => row.title },
    { key: "domain", header: "For", render: (row) => row.domain },
    { key: "priority", header: "Priority", render: (row) => <Pill>{row.priority}</Pill> },
    {
      key: "budget",
      header: "Budget",
      render: (row) => (row.budget === undefined ? "—" : formatMoney(row.budget)),
    },
    { key: "candidates", header: "Looking at", render: (row) => row.candidates },
    {
      key: "best",
      header: "Cheapest true cost",
      render: (row) =>
        row.best === undefined ? (
          "—"
        ) : (
          <span className={row.overBudget ? "text-danger" : undefined}>
            {formatMoney(row.best)}
          </span>
        ),
    },
  ];

  const growthColumns: readonly Column<GrowthRow>[] = [
    { key: "year", header: "By", render: (row) => row.year },
    { key: "title", header: "Milestone", render: (row) => row.title ?? "—" },
    { key: "target", header: "Target", render: (row) => row.target ?? "—" },
    { key: "actual", header: "Head", render: (row) => row.actual },
    {
      key: "track",
      header: "",
      render: (row) =>
        row.onTrack === undefined ? null : (
          <Pill tone={row.onTrack ? "calm" : "action"}>{row.onTrack ? "met" : "short"}</Pill>
        ),
    },
  ];

  const operatingColumns: readonly Column<OperatingLine>[] = [
    { key: "category", header: "Category", render: (row) => row.category },
    { key: "records", header: "Records", render: (row) => row.records },
    { key: "spend", header: "Spend", render: (row) => formatMoney(row.spend) },
    {
      key: "unpriced",
      header: "",
      render: (row) =>
        row.unpriced === 0 ? null : <Pill tone="action">{row.unpriced} unpriced</Pill>,
    },
  ];

  if (loading) return <p className="text-muted">Loading records…</p>;

  return (
    <PageBody>
      <PageHeader
        title="Reports"
        subtitle="Computed from the records, never stored. Correct a cost anywhere and the number here moves."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Period"
              hideLabel
              value={period}
              options={PERIODS.map((entry) => ({ value: entry.value, label: entry.label }))}
              onChange={(event) => setPeriod(event.target.value)}
            />
            {period !== "custom" ? null : (
              <>
                <TextInput
                  label="From"
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
                <TextInput
                  label="Until"
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </>
            )}
          </div>
        }
        meta={`${formatDate(range.from)} – ${formatDate(range.to)} · ${daysBetween(range)} days`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Spent"
          value={formatMoney({ cents: spent })}
          tone="action"
          hint={unpriced === 0 ? "Everything priced" : `${unpriced} records with no figure`}
        />
        <Tile
          label="Herd net"
          value={formatMoney(pnl.rollup.net)}
          tone={pnl.rollup.net.cents < 0 ? "danger" : "calm"}
          emphasis
        />
        <Tile
          label="Cost per head"
          value={formatMoney(pnl.rollup.costPerHead)}
          tone="neutral"
          hint={`${pnl.rollup.animals} head`}
        />
        <Tile
          label="Fully costed"
          value={`${pnl.rollup.completeAnimals}/${pnl.rollup.animals}`}
          tone={pnl.rollup.completeAnimals === pnl.rollup.animals ? "calm" : "action"}
          hint="Every input behind the figure"
        />
      </div>

      {pnl.feedIncomplete === 0 ? null : (
        <Callout tone="action" title="Feed is not fully costed">
          {pnl.feedIncomplete} {pnl.feedIncomplete === 1 ? "animal is" : "animals are"} eating a
          feed with no purchase recorded against it, so it is valued at nothing. Every figure below
          that includes feed is a floor, not the answer.
        </Callout>
      )}

      <Tabs
        label="Reports"
        tabs={[
          { id: "pnl", label: "Profit and loss" },
          { id: "feed", label: "Feed" },
          { id: "yields", label: "Processing" },
          { id: "roadmap", label: "Growth and capital" },
          { id: "operating", label: "Operating cost" },
        ]}
      >
        {(active) =>
          active === "pnl" ? (
            <Section
              title="Per animal, worst first"
              description="Acquisition, feed, health and processing against sale, cut and packer revenue. Feed is allocated over this window from the plans in force — the screen is not extrapolating it across a year the plans never covered."
              actions={
                <Button
                  onClick={() =>
                    exportCsv<PnlRow>(
                      "Herd P&L",
                      [
                        { header: "Animal", value: (row) => row.name },
                        { header: "Status", value: (row) => row.status },
                        { header: "Acquisition", value: (row) => row.acquisitionCost },
                        { header: "Feed", value: (row) => row.feedCost },
                        { header: "Health", value: (row) => row.healthCost },
                        { header: "Breeding", value: (row) => row.breedingCost },
                        { header: "Processing", value: (row) => row.processingCost },
                        { header: "Total cost", value: (row) => row.totalCost },
                        { header: "Sale revenue", value: (row) => row.saleRevenue },
                        { header: "Cut revenue", value: (row) => row.cutRevenue },
                        { header: "Packer revenue", value: (row) => row.packerRevenue },
                        { header: "Total revenue", value: (row) => row.totalRevenue },
                        { header: "Net", value: (row) => row.net },
                        { header: "Fully costed", value: (row) => (row.complete ? "yes" : "no") },
                      ],
                      pnl.rows,
                    )
                  }
                >
                  Export CSV
                </Button>
              }
            >
              <Card>
                <DataTable
                  caption="Per-animal profit and loss"
                  columns={pnlColumns}
                  rows={pnl.rows}
                  rowKey={(row) => row.animalId}
                  empty={
                    <EmptyState
                      title="No cattle in this window"
                      detail="Acquisitions, sales, treatments and processing inside the dates above are what this adds up."
                    />
                  }
                />
              </Card>
            </Section>
          ) : active === "feed" ? (
            <Section
              title="Feed spend"
              description="What was bought, what it averaged, and what it weighs where the feed knows."
              actions={
                <Button
                  onClick={() =>
                    exportCsv<FeedSpendRow>(
                      "Feed spend",
                      [
                        { header: "Feed", value: (row) => row.name },
                        { header: "Category", value: (row) => row.category },
                        { header: "Unit", value: (row) => row.unit },
                        { header: "Purchases", value: (row) => row.purchases },
                        { header: "Quantity", value: (row) => row.quantity },
                        { header: "Pounds", value: (row) => row.pounds },
                        { header: "Average unit cost", value: (row) => row.averageUnitCost },
                        { header: "Spend", value: (row) => row.spend },
                      ],
                      feedRows,
                    )
                  }
                >
                  Export CSV
                </Button>
              }
            >
              <Card>
                <DataTable
                  caption="Feed spend by feed"
                  columns={feedColumns}
                  rows={feedRows}
                  rowKey={(row) => row.feedTypeId}
                  empty={
                    <EmptyState
                      title="No feed bought in this window"
                      detail="Purchases are recorded on the Feed inventory screen."
                    />
                  }
                />
              </Card>
            </Section>
          ) : active === "yields" ? (
            <Section
              title="Processing yields"
              description="Dressing percentage against the rail, cutting yield against the box, and what a pound actually realised. Sixty to sixty-four percent is the ordinary dressing range for a finished beef animal."
              actions={
                <Button
                  onClick={() =>
                    exportCsv<YieldRow>(
                      "Processing yields",
                      [
                        { header: "Animal", value: (row) => row.name },
                        { header: "Delivered", value: (row) => row.deliveredOn },
                        { header: "Live lb", value: (row) => row.liveWeightLb },
                        { header: "Hanging lb", value: (row) => row.hangingWeightLb },
                        { header: "Dressing %", value: (row) => row.dressingPercent?.toFixed(1) },
                        {
                          header: "Cutting yield %",
                          value: (row) => row.cuttingYieldPercent?.toFixed(1),
                        },
                        { header: "Kept lb", value: (row) => row.poundsKept },
                        { header: "Sold lb", value: (row) => row.poundsSold },
                        { header: "$/lb realised", value: (row) => row.pricePerLbSold },
                        { header: "Revenue", value: (row) => row.revenue },
                      ],
                      yields,
                    )
                  }
                >
                  Export CSV
                </Button>
              }
            >
              <Card>
                <DataTable
                  caption="Processing yields"
                  columns={yieldColumns}
                  rows={yields}
                  rowKey={(row) => row.recordId}
                  empty={
                    <EmptyState
                      title="Nothing processed in this window"
                      detail="Processing records are entered on the Sales screen."
                    />
                  }
                />
              </Card>
            </Section>
          ) : active === "roadmap" ? (
            <div className="flex flex-col gap-density">
              <Section
                title="Herd growth against the roadmap"
                description="Headcount at each milestone's year, read against the target in its title."
                actions={
                  <Button
                    onClick={() =>
                      exportCsv<GrowthRow>(
                        "Herd growth",
                        [
                          { header: "Year", value: (row) => row.year },
                          { header: "Milestone", value: (row) => row.title },
                          { header: "Target", value: (row) => row.target },
                          { header: "Head", value: (row) => row.actual },
                        ],
                        growth,
                      )
                    }
                  >
                    Export CSV
                  </Button>
                }
              >
                <Card>
                  <DataTable
                    caption="Herd growth against target"
                    columns={growthColumns}
                    rows={growth}
                    rowKey={(row) => `${row.year}-${row.title ?? ""}`}
                    empty={
                      <EmptyState
                        title="No milestones set"
                        detail="Herd-size milestones live on the cattle roadmap. One with a year and a head count in its title appears here."
                      />
                    }
                  />
                </Card>
              </Section>

              <Section
                title="Capital planning"
                description="Open wants, what was budgeted, and the cheapest true cost among the listings still in the running — hauling, inspection and immediate repairs included, because the sticker price never settles a purchase."
                actions={
                  <Button
                    onClick={() =>
                      exportCsv<CapitalRow>(
                        "Capital planning",
                        [
                          { header: "Want", value: (row) => row.title },
                          { header: "For", value: (row) => row.domain },
                          { header: "Priority", value: (row) => row.priority },
                          { header: "Budget", value: (row) => row.budget },
                          { header: "Candidates", value: (row) => row.candidates },
                          { header: "Cheapest true cost", value: (row) => row.best },
                          {
                            header: "Over budget",
                            value: (row) => (row.overBudget ? "yes" : "no"),
                          },
                        ],
                        capital,
                      )
                    }
                  >
                    Export CSV
                  </Button>
                }
              >
                <Card>
                  <DataTable
                    caption="Open wants and what is being looked at"
                    columns={capitalColumns}
                    rows={capital}
                    rowKey={(row) => row.itemId}
                    empty={
                      <EmptyState
                        title="Nothing on the wishlist"
                        detail="Wants live on the cattle, horse and equipment roadmaps. The candidates against them come from the candidate screens."
                      />
                    }
                  />
                </Card>
              </Section>
            </div>
          ) : (
            <Section
              title="What the place cost to run"
              description="Every category that has a record in this window. Records carrying no figure are counted and named rather than treated as free — the total is a floor wherever that count is not zero."
              actions={
                <Button
                  onClick={() =>
                    exportCsv<OperatingLine>(
                      "Operating cost",
                      [
                        { header: "Category", value: (row) => row.category },
                        { header: "Records", value: (row) => row.records },
                        { header: "Spend", value: (row) => row.spend },
                        { header: "Unpriced records", value: (row) => row.unpriced },
                      ],
                      operating,
                    )
                  }
                >
                  Export CSV
                </Button>
              }
            >
              <Card>
                <DataTable
                  caption="Operating cost by category"
                  columns={operatingColumns}
                  rows={operating}
                  rowKey={(row) => row.category}
                  empty={
                    <EmptyState
                      title="Nothing spent in this window"
                      detail="Feed purchases, treatments, animals bought, processing and pasture care all land here."
                    />
                  }
                />
              </Card>

              <p className="mt-density text-sm text-muted">
                Not whole-farm yet. These reports are waiting on a module whose records do not reach
                a device:
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
                {REPORTS_AWAITING_MODULES.map((entry) => (
                  <li key={entry.report}>
                    <span className="text-ink">{entry.report}</span> — {entry.waitingOn}
                  </li>
                ))}
              </ul>
            </Section>
          )
        }
      </Tabs>
    </PageBody>
  );
}
