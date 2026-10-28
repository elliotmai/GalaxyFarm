"use client";

import Link from "next/link";
import { useId, useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  PageBody,
  Pill,
  Select,
  TextInput,
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

import { AddFab, ChipRow, KitHeader, KitList, KitRow } from "../../_components/kit-controls";

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
 * made — which is why it is the muted line on every row, and "over budget" is
 * the one thing a row will put in a chip besides a need.
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
  // The editor is a side dialog now, so it needs an open state of its own —
  // `editing` alone cannot express \"adding a new one\".
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  /** A priority, "closed", or "" for everything still open. */
  const [view, setView] = useState("");
  const formId = useId();

  // One aggregate serves cattle, horses and equipment (§5.1). This screen owns
  // the equipment slice of it and nothing else.
  const items = allItems.filter((item) => item.domain === "equipment");
  const candidates = allCandidates.filter((entry) => entry.domain === "equipment");

  const open = items.filter(isRoadmapOpen);

  const budgeted: Money = {
    cents: open.reduce((total, item) => total + (item.budgetEstimate?.cents ?? 0), 0),
  };

  function openEditor(): void {
    setEditorOpen(true);
  }

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setDraft(BLANK);
    setError(undefined);
  }

  function startEdit(item: RoadmapItem) {
    setEditorOpen(true);
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

  const closed = items.filter((item) => !isRoadmapOpen(item));
  const count = (priority: Priority) => open.filter((item) => item.priority === priority).length;

  /**
   * The priority chips replace the tiles and the "show achieved" box: the
   * counts are the filter, and "Closed" is the way to the things that are
   * done or dropped, kept one press away rather than mixed into the list.
   */
  const chips = [
    { key: "", label: "Open", count: open.length },
    { key: "need", label: "Needs", count: count("need") },
    { key: "want", label: "Wants", count: count("want") },
    { key: "someday", label: "Somedays", count: count("someday") },
    ...(closed.length === 0 && view !== "closed"
      ? []
      : [{ key: "closed", label: "Achieved or dropped", count: closed.length }]),
  ];

  const visible = (
    view === "closed" ? closed : view === "" ? open : open.filter((item) => item.priority === view)
  )
    .slice()
    .sort(byPriority);

  /** What the candidates under a line add up to, against its budget. */
  function shopping(item: RoadmapItem) {
    const live = candidates.filter((entry) => entry.roadmapItemId === item.id && isActive(entry));
    const cheapest = live
      .map((entry) => ({ entry, total: totalAcquisitionCost(entry) }))
      .sort((left, right) => left.total.cents - right.total.cents)[0];
    const against =
      item.budgetEstimate === undefined || cheapest === undefined
        ? undefined
        : compareToBudget(cheapest.entry, item.budgetEstimate);
    return { live, cheapest, against };
  }

  /** The one muted line: budget, when, and what has been found against it. */
  function lineFor(item: RoadmapItem): string {
    const { live, cheapest, against } = shopping(item);
    return [
      item.priority === "need" ? undefined : item.priority,
      item.type === "wishlist" ? undefined : item.type.replace(/_/g, " "),
      item.budgetEstimate === undefined ? undefined : `${formatMoney(item.budgetEstimate)} budget`,
      item.targetDate === undefined ? undefined : `by ${formatDate(item.targetDate)}`,
      item.targetSeason,
      live.length === 0 || cheapest === undefined
        ? undefined
        : `${live.length} looked at, cheapest ${formatMoney(cheapest.total)}` +
          (against === undefined
            ? ""
            : against.overBudget
              ? ` (${formatMoney({ cents: against.difference.cents })} over)`
              : ` (${formatMoney({ cents: -against.difference.cents })} under)`),
    ]
      .filter((part): part is string => part !== undefined && part !== "")
      .join(" · ");
  }

  /** One chip: closed lines say how they closed; a need says so; an over-budget find says so. */
  function chipFor(item: RoadmapItem) {
    if (!isRoadmapOpen(item)) return <Pill>{item.status.replace(/_/g, " ")}</Pill>;
    if (shopping(item).against?.overBudget === true) return <Pill tone="danger">Over budget</Pill>;
    if (item.priority === "need") return <Pill tone={PRIORITY_TONE.need}>Need</Pill>;
    return null;
  }

  const facts = [
    count("need") > 0 ? `${count("need")} need${count("need") === 1 ? "" : "s"}` : undefined,
    `${open.length} open`,
    budgeted.cents > 0 ? `${formatMoney(budgeted)} budgeted` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader
          eyebrow="Farm"
          title="Equipment roadmap"
          facts={loading ? undefined : facts}
          action={
            <Button variant="primary" onClick={openEditor}>
              <span aria-hidden="true">+</span> Add to roadmap
            </Button>
          }
        />

        {items.length === 0 ? null : (
          <ChipRow label="Filter by priority" chips={chips} value={view} onChange={setView} />
        )}

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              items.length === 0
                ? "Nothing on the roadmap"
                : view === "closed"
                  ? "Nothing achieved or dropped yet"
                  : "Nothing open here"
            }
            detail={
              items.length === 0
                ? "The truck, the tractor, the ATV — with a budget, a candidate is judged against something rather than a feeling."
                : undefined
            }
            {...(items.length === 0
              ? {
                  action: (
                    <Button variant="primary" onClick={openEditor}>
                      Add the first line
                    </Button>
                  ),
                }
              : view !== ""
                ? { action: <Button onClick={() => setView("")}>Show everything open</Button> }
                : {})}
          />
        ) : (
          <KitList label="The equipment roadmap">
            {visible.map((item) => {
              const { live } = shopping(item);
              return (
                <KitRow
                  key={item.id}
                  title={item.title}
                  line={lineFor(item)}
                  chip={chipFor(item)}
                  onOpen={() => startEdit(item)}
                  openLabel={`Edit ${item.title}`}
                  trailing={
                    <Link
                      href={`/admin/equipment/candidates?item=${item.id}`}
                      className="inline-flex min-h-target items-center whitespace-nowrap rounded-density px-2 text-sm font-semibold text-action hover:bg-raised"
                    >
                      {live.length === 0 ? "Find one" : `Compare ${live.length}`}
                    </Link>
                  }
                />
              );
            })}
          </KitList>
        )}

        <AddFab label="Add to roadmap" onClick={openEditor} />
      </div>

      {editorOpen || editing !== undefined ? (
        <Modal
          placement="side"
          title={editing === undefined ? "Add to the roadmap" : `Edit ${editing.title}`}
          onClose={reset}
          footer={
            <>
              <Button type="submit" form={formId} variant="primary" busy={busy}>
                {editing === undefined ? "Add to roadmap" : "Save item"}
              </Button>
              <Button onClick={reset}>Cancel</Button>
              {editing === undefined ? null : (
                // The editor closes first, so the confirmation is the only
                // dialog on screen rather than a second one stacked on this.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const item = editing;
                    reset();
                    void remove(item);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-density sm:grid sm:grid-cols-2"
          >
            <TextInput
              label="What"
              className="sm:col-span-2"
              placeholder="Three-quarter-ton truck"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              required
            />
            <Select
              label="Priority"
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              options={PRIORITIES.map((value) => ({ value, label: value }))}
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
            <TextInput
              label="Budget ($)"
              hint="What a candidate's all-in cost is measured against."
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
              placeholder="Before hay season"
              value={draft.targetSeason}
              onChange={(event) => setDraft({ ...draft, targetSeason: event.target.value })}
            />
            <TextInput
              label="Why"
              className="sm:col-span-2"
              value={draft.detail}
              onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            />
            {/*
              The one-press closes the cards used to carry as a status select.
              They write at once, like that select did, rather than waiting on
              Save — closing a line is a decision, not an edit.
            */}
            {editing === undefined || !isRoadmapOpen(editing) ? null : (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {(["achieved", "dropped"] as const).map((status) => (
                  <Button
                    key={status}
                    onClick={() => {
                      const item = editing;
                      reset();
                      void setStatus(item, status);
                    }}
                  >
                    {status === "achieved" ? "Mark achieved" : "Drop it"}
                  </Button>
                ))}
              </div>
            )}
            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger sm:col-span-2">
                {error}
              </p>
            )}
          </form>
        </Modal>
      ) : null}
    </PageBody>
  );
}
