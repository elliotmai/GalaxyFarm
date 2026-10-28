"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Select,
  TextArea,
  TextInput,
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
import { budgetOutlook, nextUp, shoppingFor } from "@galaxy-farm/module-horses";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { ListRow, PhoneAddButton, RowList } from "@/app/(admin)/admin/horses/_components/list-row";

/**
 * The horse roadmap (spec §5.9, §5.1's generic Roadmap with `domain: horses`).
 *
 * Live years before the module it belongs to, and deliberately so: §5.9 calls
 * horses "the purchase furthest out and the one most worth researching
 * slowly", which only works if there is somewhere to put the thinking down.
 * This is that place — what the horses are for, what has to be true before one
 * arrives, and what each of those is expected to cost.
 *
 * Lists of rows rather than grids of cards: the shopping list first, because
 * that is what the screen is opened for, then the reasons, then what is
 * settled, folded. Each item's detail and its actions — achieved, dropped,
 * edit, delete — wait on its own panel.
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
  /** The item whose panel is open, by id so it reads live. */
  const [looked, setLooked] = useState<Ulid | undefined>();

  const now = new Date();
  const items = allItems.filter((item) => item.domain === "horses");
  const outlook = budgetOutlook(items);
  const steps = nextUp(items, now);
  const shopping = shoppingFor(items, allCandidates);

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
   * A roadmap nobody can tick off is a list that only grows, and the totals
   * in the header read off `status` — an item left open after it happened keeps
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

  // The panel reads the item live by id, so a status changed in it shows at once.
  const looking = looked === undefined ? undefined : items.find((item) => item.id === looked);
  const lookingShop =
    looking === undefined ? undefined : shopping.find((entry) => entry.item.id === looking.id);
  const isOverdue = (item: RoadmapItem) =>
    steps.find((step) => step.item.id === item.id)?.overdue === true;

  /** When, the way it is planned: a season, a date, or both. */
  function whenOf(item: RoadmapItem, overdue: boolean): string | undefined {
    const date = formatDate(item.targetDate);
    return (
      [item.targetSeason, date === undefined ? undefined : `${overdue ? "was" : "by"} ${date}`]
        .filter((part) => part !== undefined)
        .join(", ") || undefined
    );
  }

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <PageHeader
          eyebrow="Horses"
          title="Roadmap"
          subtitle={[
            `${steps.length} open`,
            `${formatMoney(outlook.total)} planned`,
            outlook.byPriority.need.cents > 0
              ? `${formatMoney(outlook.byPriority.need)} needs`
              : undefined,
            // Unpriced items are left out of the total, so say so rather than
            // letting the sum look complete.
            outlook.unpriced === 0 ? undefined : `${outlook.unpriced} not priced`,
          ]
            .filter((part) => part !== undefined)
            .join(" · ")}
          actions={
            <span className="hidden sm:block">
              <Button variant="primary" onClick={() => startCreate("wishlist")}>
                <span aria-hidden="true">+</span> Add a want
              </Button>
            </span>
          }
        />

        {loading ? <p className="text-muted">Looking…</p> : null}

        {/*
          The shopping list first: it is what this screen is opened for. Each
          want with what is being looked at against it, priced on the all-in
          cost — the number §5.1 says decides things.
        */}
        <RoadmapSection
          title="Shopping list"
          count={shopping.length}
          action={
            <Button variant="ghost" onClick={() => startCreate("planned_action")}>
              + Planned step
            </Button>
          }
        >
          {shopping.length === 0 ? (
            <EmptyState
              title="Nothing on the list"
              detail="A want: “a quiet ranch gelding, under $6,000, by next spring”."
              action={
                <Button variant="primary" onClick={() => startCreate("wishlist")}>
                  Add a want
                </Button>
              }
            />
          ) : (
            <RowList label="Shopping list">
              {shopping.map(({ item, live, cheapest, overBudget }) => {
                const overdue = isOverdue(item);
                return (
                  <ListRow
                    key={item.id}
                    title={item.title}
                    onOpen={() => setLooked(item.id)}
                    line={[
                      // Only the planned steps are labelled; everything else
                      // here is a want, and "Want" beside "want" says nothing.
                      item.type === "wishlist" ? undefined : TYPE_LABEL[item.type],
                      capitalise(item.priority),
                      item.budgetEstimate === undefined
                        ? "no budget"
                        : `${formatMoney(item.budgetEstimate)} budget`,
                      live.length === 0
                        ? undefined
                        : `${live.length} looking, from ${formatMoney(
                            totalAcquisitionCost(cheapest as PurchaseCandidate),
                          )}`,
                      whenOf(item, overdue),
                    ]}
                    chip={
                      overBudget === true ? (
                        <Pill tone="danger">Over budget</Pill>
                      ) : overdue ? (
                        <Pill tone="danger" dot>
                          Overdue
                        </Pill>
                      ) : live.length === 0 ? (
                        <Pill tone="action">Not started</Pill>
                      ) : undefined
                    }
                  />
                );
              })}
            </RowList>
          )}
        </RoadmapSection>

        {/* The reasons, and what has to be in place first. A want with no
            reason behind it is how a horse gets bought twice. */}
        <RoadmapSection
          title="What the horses are for"
          count={intent.length}
          action={
            <Button variant="ghost" onClick={() => startCreate("goal")}>
              + Goal or milestone
            </Button>
          }
        >
          {intent.length === 0 ? (
            <EmptyState
              title="Nothing written down yet"
              detail="“Everyone can ride together” is a goal; “the north trap is fenced” is a milestone."
              action={<Button onClick={() => startCreate("goal")}>Add the first</Button>}
            />
          ) : (
            <RowList label="What the horses are for">
              {intent.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.title}
                  onOpen={() => setLooked(item.id)}
                  line={[
                    TYPE_LABEL[item.type],
                    capitalise(item.priority),
                    whenOf(item, isOverdue(item)),
                  ]}
                  chip={
                    item.status === "open" ? undefined : (
                      <Pill tone={item.status === "achieved" ? "calm" : "neutral"}>
                        {capitalise(item.status.replace(/_/g, " "))}
                      </Pill>
                    )
                  }
                />
              ))}
            </RowList>
          )}
        </RoadmapSection>

        {/*
          Achieved and dropped, kept — what was decided against is worth as
          much next year as what was done. Folded, because it is looked back
          at, not worked from.
        */}
        {closed.length === 0 ? null : (
          <details className="group flex flex-col gap-2.5">
            <summary className="inline-flex min-h-target cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink">
              Settled · {closed.length}
            </summary>
            <RowList label="Settled">
              {closed.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.title}
                  onOpen={() => setLooked(item.id)}
                  line={[TYPE_LABEL[item.type], item.detail]}
                  chip={
                    <Pill tone={item.status === "achieved" ? "calm" : "neutral"}>
                      {capitalise(item.status)}
                    </Pill>
                  }
                />
              ))}
            </RowList>
          </details>
        )}

        <PhoneAddButton onClick={() => startCreate("wishlist")}>Add a want</PhoneAddButton>
      </div>

      {looking === undefined ? null : (
        <Modal
          key={looking.id}
          placement="side"
          title={looking.title}
          description={[TYPE_LABEL[looking.type], capitalise(looking.priority)].join(" · ")}
          onClose={() => setLooked(undefined)}
          footer={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setLooked(undefined);
                  startEdit(looking);
                }}
              >
                Edit
              </Button>
              <Button onClick={() => setLooked(undefined)}>Close</Button>
              {/* The panel closes first, so the confirmation is the only
                  dialog on screen. */}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  setLooked(undefined);
                  void remove(looking);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          {looking.detail === undefined ? null : (
            <p className="whitespace-pre-line text-sm text-ink">{looking.detail}</p>
          )}
          <DetailList
            items={[
              { label: "Status", value: capitalise(looking.status.replace(/_/g, " ")) },
              {
                label: "Budget",
                value:
                  looking.budgetEstimate === undefined
                    ? "No budget set"
                    : formatMoney(looking.budgetEstimate),
              },
              { label: "When", value: whenOf(looking, isOverdue(looking)) ?? "—" },
              ...(lookingShop === undefined
                ? []
                : [
                    {
                      label: "Under consideration",
                      value:
                        lookingShop.live.length === 0
                          ? "Nothing yet"
                          : `${lookingShop.live.length} · cheapest all in ${formatMoney(
                              totalAcquisitionCost(lookingShop.cheapest as PurchaseCandidate),
                            )}${
                              lookingShop.overBudget === undefined
                                ? ""
                                : lookingShop.overBudget
                                  ? " — over the budget"
                                  : " — inside the budget"
                            }`,
                    },
                  ]),
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {/*
              Achieved, in one tap. A roadmap nobody can tick off is a list
              that only grows, and the totals read off `status`.
            */}
            {looking.status === "achieved" || looking.status === "dropped" ? (
              <Button onClick={() => void setStatus(looking, "open")}>Reopen</Button>
            ) : (
              <>
                <Button onClick={() => void setStatus(looking, "achieved")}>Achieved</Button>
                <Button onClick={() => void setStatus(looking, "dropped")}>Drop it</Button>
              </>
            )}
            {lookingShop === undefined ? null : (
              <Link
                href="/admin/horses/candidates"
                className="inline-flex min-h-target items-center rounded-density px-3 font-semibold text-action underline-offset-4 hover:underline"
              >
                {lookingShop.live.length === 0 ? "Find one" : "Compare them"}
              </Link>
            )}
          </div>
        </Modal>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={
            editing === undefined
              ? `New ${TYPE_LABEL[draft.type].toLowerCase()}`
              : `Editing ${editing.title}`
          }
          description="The horses themselves go on the candidates screen."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add it" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const item = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(item);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="What"
              required
              hint="“A quiet ranch gelding” · “Everyone can ride together”"
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
              hint="Needs, then wants, then somedays."
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
              options={PRIORITIES.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Budget ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              // Blank rather than a guess: an unpriced want is counted as
              // unpriced, not as free.
              hint="All in. Blank if unknown — it is not counted as free."
              value={draft.budget}
              error={errors["budgetEstimate"]}
              onChange={(event) => setDraft({ ...draft, budget: event.target.value })}
            />
            <TextInput
              label="Target season"
              hint="“Spring 2028”"
              value={draft.targetSeason}
              error={errors["targetSeason"]}
              onChange={(event) => setDraft({ ...draft, targetSeason: event.target.value })}
            />
            <TextInput
              label="Target date"
              type="date"
              hint="Only for a real date."
              value={draft.targetDate}
              error={errors["targetDate"]}
              onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
            />
            <TextArea
              label="Why"
              rows={3}
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
          </div>
        </Modal>
      )}
    </PageBody>
  );
}

/** A list heading with its count and one quiet add beside it. */
function RoadmapSection({
  title,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly action: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {title}
          {count === 0 ? "" : ` · ${count}`}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `2026-08-13`, in local time — what a `type="date"` input wants. */
function formatForDateInput(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
