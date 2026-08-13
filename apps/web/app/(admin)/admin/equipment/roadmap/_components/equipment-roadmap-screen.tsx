"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Button,
  CardGrid,
  Checkbox,
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
} from "@galaxy-farm/ui";
import {
  byPriority,
  compareToBudget,
  formatMoney,
  fromDollars,
  isActive,
  isRoadmapOpen,
  PRIORITIES,
  ROADMAP_ITEM_TYPES,
  ROADMAP_STATUSES,
  roadmapItemSchema,
  totalAcquisitionCost,
  type Money,
  type Priority,
  type PurchaseCandidate,
  type RoadmapItem,
  type RoadmapItemType,
  type RoadmapStatus,
  type Ulid,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * What the place still needs (spec §5.6, §7's `/admin/equipment/roadmap`).
 *
 * The same generic Roadmap aggregate the herd and the horses use, filtered to
 * `domain: equipment` — §5.6 adds one thing to it, which is that **candidates
 * hang off these items**. So the truck line does not just say "truck, need,
 * ASAP": it accumulates the actual trucks that have been looked at, and shows
 * the cheapest all-in figure among them against the budget written here.
 *
 * That comparison is the point. A wishlist with a budget and no candidates is
 * a wish; a budget with three real trucks under it is a decision that can be
 * made.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const PRIORITY_TONE: Record<Priority, "danger" | "action" | "neutral"> = {
  need: "danger",
  want: "action",
  someday: "neutral",
};

interface Draft {
  readonly type: RoadmapItemType;
  readonly title: string;
  readonly detail: string;
  readonly priority: Priority;
  readonly budgetEstimate: string;
  readonly targetDate: string;
  readonly targetSeason: string;
  readonly status: RoadmapStatus;
}

const BLANK: Draft = {
  type: "wishlist",
  title: "",
  detail: "",
  priority: "want",
  budgetEstimate: "",
  targetDate: "",
  targetSeason: "",
  status: "open",
};

export function EquipmentRoadmapScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: allItems, loading } = useRecords<RoadmapItem>("roadmapItems", query);
  const { records: allCandidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);

  const api = useMutations<RoadmapItem>(
    "roadmapItems",
    "roadmapItems",
    roadmapItemSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<RoadmapItem | undefined>();
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  // One aggregate serves cattle, horses and equipment (§5.1). This screen owns
  // the equipment slice of it and nothing else.
  const items = allItems.filter((item) => item.domain === "equipment");
  const candidates = allCandidates.filter((entry) => entry.domain === "equipment");

  const open = items.filter(isRoadmapOpen);
  const visible = (showClosed ? items : open).slice().sort(byPriority);

  const budgeted: Money = {
    cents: open.reduce((total, item) => total + (item.budgetEstimate?.cents ?? 0), 0),
  };

  function reset() {
    setEditing(undefined);
    setDraft(BLANK);
    setError(undefined);
  }

  function startEdit(item: RoadmapItem) {
    setEditing(item);
    setDraft({
      type: item.type,
      title: item.title,
      detail: item.detail ?? "",
      priority: item.priority,
      budgetEstimate:
        item.budgetEstimate === undefined ? "" : (item.budgetEstimate.cents / 100).toFixed(2),
      targetDate: item.targetDate === undefined ? "" : item.targetDate.toISOString().slice(0, 10),
      targetSeason: item.targetSeason ?? "",
      status: item.status,
    });
    setError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        domain: "equipment" as const,
        type: draft.type,
        title: draft.title.trim(),
        detail: draft.detail.trim() === "" ? undefined : draft.detail.trim(),
        priority: draft.priority,
        budgetEstimate:
          draft.budgetEstimate === "" ? undefined : fromDollars(Number(draft.budgetEstimate)),
        targetDate: draft.targetDate === "" ? undefined : new Date(`${draft.targetDate}T12:00:00`),
        targetSeason: draft.targetSeason.trim() === "" ? undefined : draft.targetSeason.trim(),
        status: draft.status,
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<RoadmapItem>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: editing === undefined ? "Added to the roadmap" : "Roadmap item updated" });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(item: RoadmapItem, status: RoadmapStatus) {
    await api.update(item.id, { status } as Partial<RoadmapItem>);
    show({
      message: `${item.title} · ${status.replace(/_/g, " ")}`,
      tone: status === "achieved" ? "success" : status === "dropped" ? "warning" : "info",
    });
  }

  /**
   * Detach, not cascade (§4.5).
   *
   * A candidate outlives the want it was found for: the trucks you looked at
   * and passed on are worth as much next year as the wishlist line that sent
   * you looking, and deleting the line should not take the record of what you
   * turned down with it.
   *
   * Nothing is written to the candidates to achieve that. They keep pointing
   * at a tombstone, which reads as unattached everywhere because every screen
   * resolves the reference against the live items — and it is what makes the
   * undo whole rather than leaving five candidates orphaned behind a restored
   * wishlist line.
   */
  async function remove(item: RoadmapItem) {
    const attached = candidates.filter((entry) => entry.roadmapItemId === item.id);

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: item.title,
      entity: "roadmap item",
      dependents: attached.map((entry) => ({
        entity: "Candidate",
        label: entry.title,
        effect: "detached" as const,
      })),
      consequence:
        attached.length === 0
          ? undefined
          : "The candidates stay, with their prices and their notes. They stop being counted against this budget, and are counted again if you restore it.",
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === item.id) reset();
    await api.remove(item.id, "Removed from the equipment roadmap");
    show({
      message: `${item.title} deleted`,
      tone: "danger",
      action: { label: "Undo", onAct: () => void api.restoreRecord(item.id) },
    });
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Kit"
        title="Equipment roadmap"
        subtitle="What the place still needs, in the order it is actually shopped for. Candidates hang off these lines, so a want accumulates the real machines you looked at."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Needs"
          value={open.filter((item) => item.priority === "need").length}
          tone="danger"
          emphasis={open.some((item) => item.priority === "need")}
        />
        <Tile
          label="Wants"
          value={open.filter((item) => item.priority === "want").length}
          tone="action"
        />
        <Tile label="Somedays" value={open.filter((item) => item.priority === "someday").length} />
        <Tile label="Budgeted" value={formatMoney(budgeted)} hint="Across everything still open" />
      </div>

      <Section
        title={editing === undefined ? "Add to the roadmap" : `Edit ${editing.title}`}
        description="A wishlist line is a want — &ldquo;truck, need, ASAP&rdquo;. What you are actually looking at goes on the candidates screen."
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              label="What"
              hint="&ldquo;Three-quarter-ton truck&rdquo;, &ldquo;Compact tractor with a loader&rdquo;"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              required
            />
            <Select
              label="Kind"
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as RoadmapItemType })
              }
              options={ROADMAP_ITEM_TYPES.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
            <Select
              label="Priority"
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              options={PRIORITIES.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Budget ($)"
              hint="What a candidate's all-in cost gets measured against."
              type="number"
              inputMode="decimal"
              step="0.01"
              numeric
              value={draft.budgetEstimate}
              onChange={(event) => setDraft({ ...draft, budgetEstimate: event.target.value })}
            />
            <TextInput
              label="Target date"
              type="date"
              value={draft.targetDate}
              onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
            />
            <TextInput
              label="…or season"
              hint="&ldquo;Before hay season&rdquo; is how this is usually said."
              value={draft.targetSeason}
              onChange={(event) => setDraft({ ...draft, targetSeason: event.target.value })}
            />
            <TextInput
              label="Why"
              value={draft.detail}
              onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            />
            <Select
              label="Status"
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as RoadmapStatus })
              }
              options={ROADMAP_STATUSES.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy}>
              {editing === undefined ? "Add to roadmap" : "Save item"}
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
        title="The list"
        description="Needs first, then wants, then somedays — the order you actually shop in."
        actions={
          <Checkbox
            label="Show achieved and dropped"
            checked={showClosed}
            onChange={(event) => setShowClosed(event.target.checked)}
          />
        }
      >
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? "Nothing on the roadmap" : "Nothing open"}
            detail={
              items.length === 0
                ? "The truck, the tractor, the ATV — writing them down with a budget is what lets a candidate be judged against something rather than against a feeling."
                : "Everything here has been achieved or dropped. Tick the box to see it."
            }
          />
        ) : (
          <CardGrid columns={2}>
            {visible.map((item) => {
              const attached = candidates.filter((entry) => entry.roadmapItemId === item.id);
              const live = attached.filter(isActive);
              const cheapest = live
                .map((entry) => ({ entry, total: totalAcquisitionCost(entry) }))
                .sort((left, right) => left.total.cents - right.total.cents)[0];
              const against =
                item.budgetEstimate === undefined || cheapest === undefined
                  ? undefined
                  : compareToBudget(cheapest.entry, item.budgetEstimate);

              return (
                <RecordCard
                  key={item.id}
                  tone={
                    !isRoadmapOpen(item)
                      ? "neutral"
                      : item.priority === "need"
                        ? "danger"
                        : item.priority === "want"
                          ? "action"
                          : "identity"
                  }
                  title={item.title}
                  subtitle={item.detail}
                  actions={<Pill tone={PRIORITY_TONE[item.priority]}>{item.priority}</Pill>}
                  meta={
                    <>
                      <Pill tone="identity">{item.type.replace(/_/g, " ")}</Pill>
                      <Pill>{item.status.replace(/_/g, " ")}</Pill>
                      {item.budgetEstimate === undefined ? null : (
                        <Pill>{formatMoney(item.budgetEstimate)} budget</Pill>
                      )}
                      {item.targetDate === undefined ? null : (
                        <Pill tone="action">by {formatDate(item.targetDate)}</Pill>
                      )}
                      {item.targetSeason === undefined ? null : (
                        <Pill tone="action">{item.targetSeason}</Pill>
                      )}
                    </>
                  }
                >
                  {live.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nothing under consideration against this yet.
                    </p>
                  ) : (
                    <p className="text-sm text-ink">
                      {live.length} under consideration · cheapest all in{" "}
                      <span className="font-semibold">
                        {formatMoney(cheapest?.total ?? { cents: 0 })}
                      </span>
                      {against === undefined ? null : (
                        <span className={against.overBudget ? " text-danger" : " text-muted"}>
                          {against.overBudget
                            ? ` · ${formatMoney({ cents: against.difference.cents })} over budget`
                            : ` · ${formatMoney({ cents: -against.difference.cents })} under`}
                        </span>
                      )}
                    </p>
                  )}

                  <div className="flex flex-wrap items-end gap-2">
                    <Link
                      href={`/admin/equipment/candidates?item=${item.id}`}
                      className="inline-flex min-h-target items-center rounded-density border border-edge px-density text-sm font-medium text-ink hover:border-action"
                    >
                      {live.length === 0 ? "Find one" : `Compare ${live.length}`}
                    </Link>
                    <Select
                      label={`Status for ${item.title}`}
                      hideLabel
                      value={item.status}
                      onChange={(event) =>
                        void setStatus(item, event.target.value as RoadmapStatus)
                      }
                      options={ROADMAP_STATUSES.map((value) => ({
                        value,
                        label: value.replace(/_/g, " "),
                      }))}
                    />
                    <Button variant="ghost" onClick={() => startEdit(item)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(item)}>
                      Delete
                    </Button>
                  </div>
                </RecordCard>
              );
            })}
          </CardGrid>
        )}
      </Section>
    </PageBody>
  );
}
