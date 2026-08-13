"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Button,
  CardGrid,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Select,
  TextArea,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  formatMoney,
  fromDollars,
  PRIORITIES,
  purchaseCandidateSchema,
  ROADMAP_ITEM_TYPES,
  ROADMAP_STATUSES,
  roadmapItemSchema,
  toDollars,
  totalAcquisitionCost,
  type Priority,
  type PurchaseCandidate,
  type RoadmapItem,
  type RoadmapItemType,
  type RoadmapStatus,
  type Ulid,
} from "@galaxy-farm/core";
import { budgetOutlook, nextUp, shoppingFor, unshopped } from "@galaxy-farm/module-horses";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The horse roadmap (spec §5.9, §5.1's generic Roadmap with `domain: horses`).
 *
 * Live years before the module it belongs to, and deliberately so: §5.9 calls
 * horses "the purchase furthest out and the one most worth researching
 * slowly", which only works if there is somewhere to put the thinking down.
 * This is that place — what the horses are for, what has to be true before one
 * arrives, and what each of those is expected to cost.
 *
 * No HorseRoadmap entity, because §5.9 asks for the same aggregate cattle and
 * equipment use. What is specific to horses is the reading, and that lives in
 * the module.
 */

const TYPE_LABEL: Readonly<Record<RoadmapItemType, string>> = {
  goal: "Goal",
  milestone: "Milestone",
  wishlist: "Want",
  planned_action: "Planned",
};

const PRIORITY_TONE: Readonly<Record<Priority, "danger" | "action" | "neutral">> = {
  need: "danger",
  want: "action",
  someday: "neutral",
};

/** Goals and milestones say where this is going; wants are what to shop for. */
const INTENT_TYPES: readonly RoadmapItemType[] = ["goal", "milestone"];

function formatDate(value: Date | undefined): string | undefined {
  return value === undefined
    ? undefined
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The form's state. Kept as strings — an empty box is not a zero. */
interface Draft {
  readonly type: RoadmapItemType;
  readonly title: string;
  readonly detail: string;
  readonly priority: Priority;
  readonly targetDate: string;
  readonly targetSeason: string;
  readonly budget: string;
  readonly status: RoadmapStatus;
}

const BLANK: Draft = {
  type: "wishlist",
  title: "",
  detail: "",
  priority: "want",
  targetDate: "",
  targetSeason: "",
  budget: "",
  status: "open",
};

export function HorseRoadmapScreen({
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
  // Deleting a want has to take it off the horses being compared against it,
  // or they are left pointing at a record that is gone.
  const candidateApi = useMutations<PurchaseCandidate>(
    "purchaseCandidates",
    "purchaseCandidates",
    purchaseCandidateSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<RoadmapItem | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const now = new Date();
  const items = allItems.filter((item) => item.domain === "horses");
  const outlook = budgetOutlook(items);
  const steps = nextUp(items, now);
  const shopping = shoppingFor(items, allCandidates);
  const notStarted = unshopped(items, allCandidates);

  const intent = items.filter((item) => INTENT_TYPES.includes(item.type));
  const closed = items.filter((item) => item.status === "achieved" || item.status === "dropped");

  function startCreate(type: RoadmapItemType) {
    setEditing(undefined);
    setDraft({ ...BLANK, type });
    setErrors({});
  }

  function startEdit(item: RoadmapItem) {
    setEditing(item);
    setDraft({
      type: item.type,
      title: item.title,
      detail: item.detail ?? "",
      priority: item.priority,
      // `toISOString` would shift a date typed as local into the previous day
      // for anyone west of Greenwich, which is everybody here.
      targetDate: item.targetDate === undefined ? "" : formatForDateInput(item.targetDate),
      targetSeason: item.targetSeason ?? "",
      budget: item.budgetEstimate === undefined ? "" : String(toDollars(item.budgetEstimate)),
      status: item.status,
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;

    const fields = {
      domain: "horses" as const,
      type: draft.type,
      title: draft.title.trim(),
      ...(draft.detail.trim() === "" ? {} : { detail: draft.detail.trim() }),
      priority: draft.priority,
      ...(draft.targetDate === "" ? {} : { targetDate: new Date(`${draft.targetDate}T12:00:00`) }),
      ...(draft.targetSeason.trim() === "" ? {} : { targetSeason: draft.targetSeason.trim() }),
      ...(draft.budget.trim() === "" ? {} : { budgetEstimate: fromDollars(Number(draft.budget)) }),
      status: draft.status,
    };

    const result =
      editing === undefined ? await api.create(fields) : await api.update(editing.id, fields);

    if (!result.ok) {
      // §4.5 clause 2: per field, so nobody has to guess which box is wrong.
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { title: "Could not save. Check the fields and try again." },
      );
      return;
    }

    show({ message: editing === undefined ? "Added to the roadmap" : "Saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Achieved, in one tap.
   *
   * A roadmap nobody can tick off is a list that only grows, and the tiles
   * above read off `status` — an item left open after it happened keeps
   * counting toward a budget that has already been spent.
   */
  async function setStatus(item: RoadmapItem, status: RoadmapStatus) {
    const result = await api.update(item.id, { status });
    if (!result.ok) {
      show({ message: "Could not change that", tone: "danger" });
      return;
    }
    show({
      message: `${item.title} · ${status.replace(/_/g, " ")}`,
      tone: status === "dropped" ? "warning" : "success",
    });
  }

  async function remove(item: RoadmapItem) {
    const attached = allCandidates.filter((candidate) => candidate.roadmapItemId === item.id);

    const confirmed = await confirmDelete({
      // Elevated when horses are being compared against it: the candidates
      // survive, but they lose the want that explains why they are on the list.
      tier: attached.length > 0 ? "elevated" : "standard",
      recordName: item.title,
      entity: "roadmap item",
      dependents: attached.map((candidate) => ({
        entity: "Candidate",
        label: candidate.title,
        effect: "detached" as const,
      })),
      consequence:
        attached.length > 0
          ? "Those horses stay under consideration, with nothing saying what they were for."
          : "Dropping it keeps the record and the reason. Deleting loses that you ever wanted it.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(item.id, "Removed from the horse roadmap");
    if (!result.ok) {
      show({ message: "Could not delete that", tone: "danger" });
      return;
    }

    // Nothing left pointing at a tombstone.
    for (const candidate of attached) {
      await candidateDetach(candidate);
    }

    show({
      message: `${item.title} deleted`,
      tone: "danger",
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(item.id);
            for (const candidate of attached) {
              await candidateAttach(candidate, item.id);
            }
          })();
        },
      },
    });
  }

  async function candidateDetach(candidate: PurchaseCandidate) {
    await candidateApi.update(candidate.id, { roadmapItemId: undefined });
  }

  async function candidateAttach(candidate: PurchaseCandidate, itemId: Ulid) {
    await candidateApi.update(candidate.id, { roadmapItemId: itemId });
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Horses"
        title="Roadmap"
        subtitle="What the horses are for, what has to be true before one arrives, and what that is expected to cost. Live years before the first horse, which is the point."
        actions={
          <Button variant="primary" onClick={() => startCreate("wishlist")}>
            Add a want
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open" value={steps.length} tone="identity" />
        <Tile
          label="Needs"
          value={formatMoney(outlook.byPriority.need)}
          tone="danger"
          emphasis={outlook.byPriority.need.cents > 0}
          hint="Before the wants and the somedays"
        />
        <Tile
          label="Whole plan"
          value={formatMoney(outlook.total)}
          hint={
            outlook.unpriced === 0
              ? "Everything open is priced"
              : `${outlook.unpriced} not priced — not counted here`
          }
        />
        <Tile
          label="Wants not started"
          value={notStarted.length}
          tone={notStarted.length > 0 ? "action" : "calm"}
          hint={
            notStarted.length > 0
              ? "Nothing under consideration yet"
              : "Every want has a horse against it"
          }
        />
      </div>

      {loading ? <p className="text-muted">Looking…</p> : null}

      <Section
        title="What the horses are for"
        description="The reasons, and what has to be in place first. A want with no reason behind it is how a horse gets bought twice."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startCreate("goal")}>Add a goal</Button>
            <Button onClick={() => startCreate("milestone")}>Add a milestone</Button>
          </div>
        }
      >
        {intent.length === 0 ? (
          <EmptyState
            title="Nothing written down yet"
            detail="&ldquo;Everyone can ride together&rdquo; is a goal; &ldquo;the north trap is fenced for horses&rdquo; is a milestone. Both are worth having before the shopping starts."
            action={
              <Button variant="primary" onClick={() => startCreate("goal")}>
                Add the first
              </Button>
            }
          />
        ) : (
          <CardGrid columns={3}>
            {intent.map((item) => (
              <RecordCard
                key={item.id}
                tone={item.status === "achieved" ? "calm" : "identity"}
                title={item.title}
                subtitle={item.detail}
                actions={<Pill tone="neutral">{TYPE_LABEL[item.type]}</Pill>}
                meta={
                  <>
                    <Pill tone={PRIORITY_TONE[item.priority]}>{item.priority}</Pill>
                    {item.targetSeason === undefined ? null : <Pill>{item.targetSeason}</Pill>}
                    {formatDate(item.targetDate) === undefined ? null : (
                      <Pill>by {formatDate(item.targetDate)}</Pill>
                    )}
                    {item.status === "open" ? null : <Pill tone="calm">{item.status}</Pill>}
                  </>
                }
              >
                <ItemActions
                  item={item}
                  onEdit={startEdit}
                  onStatus={setStatus}
                  onDelete={remove}
                />
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>

      <Section
        title="The shopping list"
        description="Each want with what is actually being looked at against it, priced on the all-in cost — the number §5.1 says decides things."
        actions={<Button onClick={() => startCreate("planned_action")}>Add a planned step</Button>}
      >
        {shopping.length === 0 ? (
          <EmptyState
            title="Nothing on the list"
            detail="A want says &ldquo;a quiet ranch gelding, under $6,000, by next spring&rdquo;. The horses you find against it go on the candidates screen."
            action={
              <Button variant="primary" onClick={() => startCreate("wishlist")}>
                Add a want
              </Button>
            }
          />
        ) : (
          <CardGrid columns={2}>
            {shopping.map(({ item, live, cheapest, overBudget }) => {
              const overdue = steps.find((step) => step.item.id === item.id)?.overdue === true;

              return (
                <RecordCard
                  key={item.id}
                  tone={overBudget === true ? "danger" : live.length > 0 ? "action" : "neutral"}
                  title={item.title}
                  subtitle={item.detail}
                  actions={<Pill tone={PRIORITY_TONE[item.priority]}>{item.priority}</Pill>}
                  meta={
                    <>
                      {/*
                        Only the planned steps are labelled. Everything else in
                        this section is a want, and a pill reading "Want" next
                        to a priority pill reading "want" says nothing twice.
                      */}
                      {item.type === "wishlist" ? null : (
                        <Pill tone="neutral">{TYPE_LABEL[item.type]}</Pill>
                      )}
                      {item.budgetEstimate === undefined ? (
                        <Pill tone="neutral">no budget set</Pill>
                      ) : (
                        <Pill tone="identity">{formatMoney(item.budgetEstimate)} budgeted</Pill>
                      )}
                      {item.targetSeason === undefined ? null : <Pill>{item.targetSeason}</Pill>}
                      {formatDate(item.targetDate) === undefined ? null : (
                        <Pill tone={overdue ? "danger" : "neutral"} dot={overdue}>
                          {overdue ? "was " : "by "}
                          {formatDate(item.targetDate)}
                        </Pill>
                      )}
                    </>
                  }
                >
                  <p className="text-sm text-muted">
                    {live.length === 0 ? (
                      <>Nothing under consideration yet.</>
                    ) : (
                      <>
                        {live.length} under consideration · cheapest all in{" "}
                        <span className="font-semibold text-ink">
                          {formatMoney(totalAcquisitionCost(cheapest as PurchaseCandidate))}
                        </span>
                        {overBudget === undefined
                          ? null
                          : overBudget
                            ? " — over the budget"
                            : " — inside the budget"}
                      </>
                    )}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/admin/horses/candidates"
                      className="inline-flex min-h-target items-center rounded-density px-3 text-density text-action underline underline-offset-4"
                    >
                      {live.length === 0 ? "Find one" : "Compare them"}
                    </Link>
                    <ItemActions
                      item={item}
                      onEdit={startEdit}
                      onStatus={setStatus}
                      onDelete={remove}
                    />
                  </div>
                </RecordCard>
              );
            })}
          </CardGrid>
        )}
      </Section>

      {closed.length === 0 ? null : (
        <Section
          title="Settled"
          description="Achieved and dropped, kept. What you decided against is worth as much next year as what you did."
        >
          <CardGrid columns={3}>
            {closed.map((item) => (
              <RecordCard
                key={item.id}
                tone="neutral"
                title={item.title}
                subtitle={item.detail}
                actions={
                  <Pill tone={item.status === "achieved" ? "calm" : "neutral"}>{item.status}</Pill>
                }
              >
                <ItemActions
                  item={item}
                  onEdit={startEdit}
                  onStatus={setStatus}
                  onDelete={remove}
                />
              </RecordCard>
            ))}
          </CardGrid>
        </Section>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          title={
            editing === undefined
              ? `New ${TYPE_LABEL[draft.type].toLowerCase()}`
              : `Editing ${editing.title}`
          }
          description="Everything here is a want or a reason for one. The horses themselves go on the candidates screen."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="What"
              required
              hint="&ldquo;A quiet ranch gelding&rdquo; · &ldquo;Everyone can ride together&rdquo;"
              value={draft.title}
              error={errors["title"]}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Select
              label="Kind"
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as RoadmapItemType })
              }
              options={ROADMAP_ITEM_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }))}
            />
            <Select
              label="How badly"
              hint="Needs first, then wants, then somedays — the order you actually shop in."
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              options={PRIORITIES.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Budget ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              hint="What you would pay all in. Leave blank rather than guessing — an unpriced want is counted as unpriced, not as free."
              value={draft.budget}
              error={errors["budgetEstimate"]}
              onChange={(event) => setDraft({ ...draft, budget: event.target.value })}
            />
            <TextInput
              label="Target season"
              hint="&ldquo;Spring 2028&rdquo; — how this is actually planned."
              value={draft.targetSeason}
              error={errors["targetSeason"]}
              onChange={(event) => setDraft({ ...draft, targetSeason: event.target.value })}
            />
            <TextInput
              label="Target date"
              type="date"
              hint="Only when there is a real date. A season is usually the honest answer."
              value={draft.targetDate}
              error={errors["targetDate"]}
              onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
            />
            <TextArea
              label="Why"
              rows={3}
              hint="The reasoning, so next year's version of you can argue with it."
              value={draft.detail}
              error={errors["detail"]}
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

            {/* Repeated where the button is, so a save that refuses says why
                without anybody scrolling back up the form. */}
            {Object.keys(errors).length === 0 ? null : (
              <p role="alert" className="text-sm text-danger">
                {Object.values(errors).join(" · ")}
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add it" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </PageBody>
  );
}

function ItemActions({
  item,
  onEdit,
  onStatus,
  onDelete,
}: {
  readonly item: RoadmapItem;
  readonly onEdit: (item: RoadmapItem) => void;
  readonly onStatus: (item: RoadmapItem, status: RoadmapStatus) => Promise<void>;
  readonly onDelete: (item: RoadmapItem) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {item.status === "achieved" || item.status === "dropped" ? (
        <Button variant="ghost" onClick={() => void onStatus(item, "open")}>
          Reopen
        </Button>
      ) : (
        <>
          <Button variant="ghost" onClick={() => void onStatus(item, "achieved")}>
            Achieved
          </Button>
          <Button variant="ghost" onClick={() => void onStatus(item, "dropped")}>
            Drop it
          </Button>
        </>
      )}
      <Button variant="ghost" onClick={() => onEdit(item)}>
        Edit
      </Button>
      <Button variant="ghost" onClick={() => void onDelete(item)}>
        Delete
      </Button>
    </div>
  );
}

/** `2026-08-13`, in local time — what a `type="date"` input wants. */
function formatForDateInput(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
