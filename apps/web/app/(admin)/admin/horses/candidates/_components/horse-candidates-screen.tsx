"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Select,
  TagInput,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  optionLabel,
} from "@galaxy-farm/ui";
import {
  CANDIDATE_STATUSES,
  encodeUlid,
  formatMoney,
  fromDollars,
  isExpiring,
  isRoadmapOpen,
  purchaseCandidateSchema,
  toDollars,
  totalAcquisitionCost,
  validate,
  type CandidateStatus,
  type Money,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";
import {
  concerns,
  describeHeight,
  describeHorse,
  DISCIPLINES,
  HORSE_SEXES,
  horseCandidateSchema,
  isHandsFraction,
  SOUNDNESS_STATUSES,
  TRAINING_LEVELS,
  type Discipline,
  type HorseCandidateDetail,
  type HorseSex,
  type SoundnessStatus,
  type TrainingLevel,
} from "@galaxy-farm/module-horses";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import {
  ChipRow,
  FilteredLine,
  ListRow,
  PhoneAddButton,
  RowList,
} from "@/app/(admin)/admin/horses/_components/list-row";

/**
 * Horses under consideration (spec §5.9, extending §5.1's comparison view).
 *
 * §5.9 puts this screen years ahead of the module it belongs to: horses are
 * "the purchase furthest out and the one most worth researching slowly, so the
 * shopping surface is live long before the module is". Nothing here needs a
 * horse on the place.
 *
 * Two things it does that a list of listings does not:
 *
 *   - **Sorts on total acquisition cost.** A gelding four hundred miles away
 *     with a pre-purchase exam on top is not the cheaper horse, and a table
 *     sorted on the asking price says he is.
 *   - **Says what to ask before driving out.** `concerns` is a list, not a
 *     score — soundness not stated is a different problem from unsound, and a
 *     number would blur them into one.
 *
 * The list is rows, not a table: the name, one line (status, the horse, the
 * all-in figure) and one chip for whatever is most worth knowing. Everything
 * else — soundness, disciplines, pros and cons, the status ladder — is on the
 * horse's own panel, a side panel on a laptop and a bottom sheet on a phone.
 *
 * The shared aggregate holds price, seller, distance, pros and cons. The horse
 * half rides in `domainDetail` and is validated by the module's own schema,
 * which is where the rule that a height runs .0 to .3 gets enforced.
 */

const COST_HAUL = "Hauling";
const COST_EXAM = "Pre-purchase exam";

/** The pipeline a candidate walks, most hopeful first for the tiles. */
const OPEN_STATUSES: readonly CandidateStatus[] = [
  "watching",
  "contacted",
  "inspected",
  "offer_made",
];

const SOUNDNESS_TONE: Readonly<Record<SoundnessStatus, "calm" | "action" | "danger" | "neutral">> =
  {
    sound: "calm",
    serviceably_sound: "action",
    unsound: "danger",
    unknown: "neutral",
  };

/**
 * The horse half, read back.
 *
 * Checked on the way out as well as on the way in. `domainDetail` is an opaque
 * record to the kernel, so nothing but this module knows what shape it should
 * be — and a candidate written by an older version of this screen, or by a
 * device that has not been updated, would otherwise reach `concerns` missing a
 * field it reads. Undefined here means "not recorded", which the table says
 * rather than guesses at.
 */
function parseDetail(candidate: PurchaseCandidate): HorseCandidateDetail | undefined {
  const parsed = horseCandidateSchema.safeParse({
    ...(candidate.domainDetail ?? {}),
    candidateId: candidate.id,
  });
  return parsed.success ? parsed.data : undefined;
}

function costOf(candidate: PurchaseCandidate, label: string): string {
  const line = candidate.additionalCosts.find((cost) => cost.label === label);
  return line === undefined ? "" : String(toDollars(line.amount));
}

function isOpen(candidate: PurchaseCandidate): boolean {
  return OPEN_STATUSES.includes(candidate.status);
}

/** The status chips: the views of the comparison that get asked for. */
type View = "all" | "open" | "ask" | "passed";

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

interface Draft {
  readonly title: string;
  readonly roadmapItemId: string;
  readonly status: CandidateStatus;
  readonly asking: string;
  readonly haul: string;
  readonly exam: string;
  readonly location: string;
  readonly distance: string;
  readonly listingUrl: string;
  readonly expiresAt: string;
  readonly notes: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  // The horse half.
  readonly breed: string;
  readonly sex: HorseSex;
  readonly ageYears: string;
  readonly heightHands: string;
  readonly trainingLevel: string;
  readonly disciplines: readonly Discipline[];
  readonly soundness: SoundnessStatus;
  readonly vetCheckDone: boolean;
  readonly vetCheckNotes: string;
  readonly temperament: string;
  readonly association: string;
  readonly regNumber: string;
}

const BLANK: Draft = {
  title: "",
  roadmapItemId: "",
  status: "watching",
  asking: "",
  haul: "",
  exam: "",
  location: "",
  distance: "",
  listingUrl: "",
  expiresAt: "",
  notes: "",
  pros: [],
  cons: [],
  breed: "",
  sex: "gelding",
  ageYears: "",
  heightHands: "",
  trainingLevel: "",
  disciplines: [],
  soundness: "unknown",
  vetCheckDone: false,
  vetCheckNotes: "",
  temperament: "",
  association: "",
  regNumber: "",
};

export function HorseCandidatesScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: all, loading } = useRecords<PurchaseCandidate>("purchaseCandidates", query);
  const { records: roadmap } = useRecords<RoadmapItem>("roadmapItems", query);

  const api = useMutations<PurchaseCandidate>(
    "purchaseCandidates",
    "purchaseCandidates",
    purchaseCandidateSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<PurchaseCandidate | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("all");
  /** The candidate whose panel is open, by id so it reads live. */
  const [looked, setLooked] = useState<Ulid | undefined>();

  // Only the horses. The same aggregate serves cattle and equipment (§5.9).
  const candidates = useMemo(() => all.filter((candidate) => candidate.domain === "horses"), [all]);
  const details = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, parseDetail(candidate)])),
    [candidates],
  );
  const detailOf = (candidate: PurchaseCandidate) => details.get(candidate.id);

  const now = new Date();
  const open = candidates.filter(isOpen);
  const wants = roadmap.filter((item) => item.domain === "horses" && isRoadmapOpen(item));

  /** What to ask about before spending a Saturday driving (§5.9). */
  const toAsk = open
    .map((candidate) => {
      const detail = detailOf(candidate);
      return { candidate, found: detail === undefined ? [] : concerns(detail) };
    })
    .filter((entry) => entry.found.length > 0);
  const askById = new Map(toAsk.map((entry) => [entry.candidate.id, entry.found]));

  const cheapest = open
    .map((candidate) => totalAcquisitionCost(candidate))
    .sort((left, right) => left.cents - right.cents)[0] as Money | undefined;

  /** The height rule, checked while it is being typed rather than on save. */
  const heightIssue =
    draft === undefined || draft.heightHands === "" || isHandsFraction(Number(draft.heightHands))
      ? undefined
      : "A hand is four inches — the decimal runs .0 to .3";

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(candidate: PurchaseCandidate) {
    // What is on the record, not what parsed — an unrecorded detail should
    // open the form with the boxes it did have filled in, so the fix is typing
    // the missing one rather than the whole horse again.
    const detail = (candidate.domainDetail ?? {}) as Partial<HorseCandidateDetail>;
    setEditing(candidate);
    setDraft({
      title: candidate.title,
      roadmapItemId: candidate.roadmapItemId ?? "",
      status: candidate.status,
      asking: candidate.askingPrice === undefined ? "" : String(toDollars(candidate.askingPrice)),
      haul: costOf(candidate, COST_HAUL),
      exam: costOf(candidate, COST_EXAM),
      location: candidate.location ?? "",
      distance: candidate.distanceMiles === undefined ? "" : String(candidate.distanceMiles),
      listingUrl: candidate.listingUrl ?? "",
      expiresAt: candidate.expiresAt === undefined ? "" : forDateInput(candidate.expiresAt),
      notes: candidate.notes ?? "",
      pros: candidate.pros,
      cons: candidate.cons,
      breed: detail.breed ?? "",
      sex: detail.sex ?? "gelding",
      ageYears: detail.ageYears === undefined ? "" : String(detail.ageYears),
      heightHands: detail.heightHands === undefined ? "" : String(detail.heightHands),
      trainingLevel: detail.trainingLevel ?? "",
      disciplines: detail.disciplines ?? [],
      soundness: detail.soundness ?? "unknown",
      vetCheckDone: detail.vetCheckDone ?? false,
      vetCheckNotes: detail.vetCheckNotes ?? "",
      temperament: detail.temperament ?? "",
      association: detail.association ?? "",
      regNumber: detail.regNumber ?? "",
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    // The id has to exist before the detail does — `candidateId` ties the horse
    // half to the record it describes, and on a new candidate nothing has
    // minted one yet. Minting it here rather than after the write also means
    // the two halves cannot disagree about which record they belong to.
    const id = editing?.id ?? (encodeUlid(Date.now()) as Ulid);

    const detail = {
      candidateId: id,
      ...(draft.breed.trim() === "" ? {} : { breed: draft.breed.trim() }),
      sex: draft.sex,
      ...(draft.ageYears === "" ? {} : { ageYears: Number(draft.ageYears) }),
      ...(draft.heightHands === "" ? {} : { heightHands: Number(draft.heightHands) }),
      ...(draft.trainingLevel === ""
        ? {}
        : { trainingLevel: draft.trainingLevel as TrainingLevel }),
      disciplines: draft.disciplines,
      soundness: draft.soundness,
      vetCheckDone: draft.vetCheckDone,
      ...(draft.vetCheckNotes.trim() === "" ? {} : { vetCheckNotes: draft.vetCheckNotes.trim() }),
      ...(draft.temperament.trim() === "" ? {} : { temperament: draft.temperament.trim() }),
      ...(draft.association.trim() === "" ? {} : { association: draft.association.trim() }),
      ...(draft.regNumber.trim() === "" ? {} : { regNumber: draft.regNumber.trim() }),
    };

    // §5.9: the owning module validates its own half. This is where "a height
    // runs .0 to .3" and "no vet notes without a vet check" are enforced —
    // the kernel holds `domainDetail` as an opaque record on purpose.
    const checked = validate(horseCandidateSchema, detail);
    if (!checked.ok) {
      setErrors(
        checked.error.kind === "validation"
          ? Object.fromEntries(
              checked.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { title: "Could not save that" },
      );
      return;
    }

    // Costs somebody typed elsewhere are kept: this form knows two of them,
    // and dropping the rest on every edit would lose a repair estimate.
    const others = (editing?.additionalCosts ?? []).filter(
      (cost) => cost.label !== COST_HAUL && cost.label !== COST_EXAM,
    );

    const fields = {
      domain: "horses" as const,
      title: draft.title.trim(),
      ...(draft.roadmapItemId === "" ? {} : { roadmapItemId: draft.roadmapItemId as Ulid }),
      status: draft.status,
      askingPrice: fromDollars(Number(draft.asking || "0")),
      // Itemised rather than folded into the price, so the comparison can show
      // why one horse is dearer than his sticker suggests (§5.1).
      additionalCosts: [
        ...others,
        ...(draft.haul === ""
          ? []
          : [{ label: COST_HAUL, amount: fromDollars(Number(draft.haul)) }]),
        ...(draft.exam === ""
          ? []
          : [{ label: COST_EXAM, amount: fromDollars(Number(draft.exam)) }]),
      ],
      ...(draft.location.trim() === "" ? {} : { location: draft.location.trim() }),
      ...(draft.distance === "" ? {} : { distanceMiles: Number(draft.distance) }),
      ...(draft.listingUrl.trim() === "" ? {} : { listingUrl: draft.listingUrl.trim() }),
      ...(draft.expiresAt === "" ? {} : { expiresAt: new Date(`${draft.expiresAt}T12:00:00`) }),
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
      pros: [...draft.pros],
      cons: [...draft.cons],
      domainDetail: checked.value as unknown as Record<string, unknown>,
    };

    const result =
      editing === undefined
        ? await api.create({
            id,
            firstSeen: new Date(),
            photoKeys: [],
            planStatus: "open",
            ...fields,
          } as never)
        : await api.update(editing.id, fields as Partial<PurchaseCandidate>);

    if (!result.ok) {
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { title: "Could not save. Check the fields and try again." },
      );
      return;
    }

    show({
      message: editing === undefined ? "Added to the comparison" : "Saved",
      tone: "success",
    });
    setDraft(undefined);
    setEditing(undefined);
  }

  async function setStatus(candidate: PurchaseCandidate, status: CandidateStatus) {
    const result = await api.update(candidate.id, { status } as Partial<PurchaseCandidate>);
    if (!result.ok) {
      show({ message: "Could not change that", tone: "danger" });
      return;
    }
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
      dependents: [],
      // §5.9: what you turned down and why is worth as much next year as what
      // you bought. Passing keeps that; deleting throws it away.
      consequence:
        "Marking it passed keeps the record and the reason. Deleting loses what you turned down and why.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(candidate.id, "Removed from the horse candidates");
    if (!result.ok) {
      show({ message: "Could not delete that", tone: "danger" });
      return;
    }

    show({
      message: `${candidate.title} deleted`,
      tone: "danger",
      action: { label: "Undo", onAct: () => void api.restoreRecord(candidate.id) },
    });
  }

  /** The one chip a row may carry, in the order it matters. */
  function chipFor(candidate: PurchaseCandidate) {
    // §6 raises a notification for a listing about to expire. It belongs on
    // the screen as well: a listing that closes on Friday is the one fact on
    // the row that stops being true on its own.
    if (isOpen(candidate) && isExpiring(candidate, now)) {
      return (
        <Pill tone="danger" dot>
          closes {daysUntil(candidate.expiresAt as Date, now) === 0 ? "today" : "soon"}
        </Pill>
      );
    }
    const detail = detailOf(candidate);
    if (detail?.soundness === "unsound") return <Pill tone="danger">unsound</Pill>;
    const asks = askById.get(candidate.id);
    if (asks !== undefined) return <Pill tone="action">{asks.length} to ask</Pill>;
    return undefined;
  }

  /** Status, the horse, and the number the decision is made on (§5.1). */
  function lineFor(candidate: PurchaseCandidate) {
    const detail = detailOf(candidate);
    return [
      capitalise(candidate.status.replace(/_/g, " ")),
      detail === undefined ? "details not recorded" : describeHorse(detail),
      `${formatMoney(totalAcquisitionCost(candidate))} all in`,
      candidate.distanceMiles === undefined ? undefined : `${candidate.distanceMiles} mi`,
    ];
  }

  // Sorted on total acquisition cost: a cheaper horse four hundred miles away,
  // with an exam and a haul on top, is often not the cheaper horse.
  const sorted = [...candidates].sort(
    (left, right) => totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents,
  );
  const passedCount = candidates.filter((candidate) => candidate.status === "passed").length;
  const shown = sorted.filter((candidate) => {
    if (view === "open") return isOpen(candidate);
    if (view === "ask") return askById.has(candidate.id);
    if (view === "passed") return candidate.status === "passed";
    return true;
  });
  const viewChips: readonly { key: View; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "In play", count: open.length },
    ...(toAsk.length === 0 ? [] : [{ key: "ask" as const, label: "To ask", count: toAsk.length }]),
    { key: "passed", label: "Passed", count: passedCount },
  ];
  const viewLabel = viewChips.find((chip) => chip.key === view)?.label ?? "";

  // Read live from the list, so a status changed in the panel shows at once.
  const looking = looked === undefined ? undefined : candidates.find((c) => c.id === looked);
  const lookingDetail = looking === undefined ? undefined : detailOf(looking);
  const lookingWant =
    looking === undefined ? undefined : wants.find((item) => item.id === looking.roadmapItemId);

  return (
    // Bottom clearance on a phone for the floating add button.
    <PageBody>
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <PageHeader
          eyebrow="Horses"
          title="Candidates"
          subtitle={[
            `${open.length} in play`,
            cheapest === undefined ? undefined : `cheapest ${formatMoney(cheapest)} all in`,
            passedCount === 0 ? undefined : `${passedCount} passed`,
          ]
            .filter((part) => part !== undefined)
            .join(" · ")}
          actions={
            // Hidden on a phone by a wrapper: the button's own `inline-flex`
            // wins over a `hidden` passed in.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={startCreate}>
                <span aria-hidden="true">+</span> Add a horse
              </Button>
            </span>
          }
        />

        {/*
          What to ask before driving out, as one line rather than a callout of
          its own. The questions themselves are on each horse's panel, and the
          line is the way to the horses concerned.
        */}
        {toAsk.length === 0 || view === "ask" ? null : (
          <p className="text-sm text-action">
            {toAsk.length} worth asking about before you drive out.{" "}
            <button
              type="button"
              onClick={() => setView("ask")}
              className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
            >
              Show them
            </button>
          </p>
        )}

        {candidates.length === 0 ? null : (
          <ChipRow label="Filter by status" chips={viewChips} value={view} onChange={setView} />
        )}

        {view === "all" ? null : (
          <FilteredLine
            shown={shown.length}
            total={candidates.length}
            what={viewLabel}
            onClear={() => setView("all")}
          />
        )}

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            title={candidates.length === 0 ? "Nothing under consideration" : "None here"}
            {...(candidates.length === 0
              ? {
                  detail:
                    "Add a horse you have seen listed. Hauling and the exam count in the total.",
                  action: (
                    <Button variant="primary" onClick={startCreate}>
                      Add the first
                    </Button>
                  ),
                }
              : { action: <Button onClick={() => setView("all")}>Show all</Button> })}
          />
        ) : (
          <RowList label="Horses under consideration">
            {shown.map((candidate) => (
              <ListRow
                key={candidate.id}
                title={candidate.title}
                line={lineFor(candidate)}
                chip={chipFor(candidate)}
                onOpen={() => setLooked(candidate.id)}
              />
            ))}
          </RowList>
        )}

        <p className="text-sm text-muted">
          What you are shopping <em>for</em> is on the{" "}
          <Link href="/admin/horses/roadmap" className="text-action underline underline-offset-4">
            horse roadmap
          </Link>
          .
        </p>

        <PhoneAddButton onClick={startCreate}>Add a horse</PhoneAddButton>
      </div>

      {looking === undefined ? null : (
        <Modal
          key={looking.id}
          placement="side"
          title={looking.title}
          description={
            lookingDetail === undefined ? "Details not recorded" : describeHorse(lookingDetail)
          }
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
                  dialog on screen rather than a second one stacked on this. */}
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
          {/*
            A candidate walks watching → contacted → inspected → offer_made and
            ends at purchased, passed or gone. A Pass button alone would record
            only the endings, so the whole ladder is here.
          */}
          <Select
            label="Status"
            value={looking.status}
            onChange={(event) => void setStatus(looking, event.target.value as CandidateStatus)}
            options={CANDIDATE_STATUSES.map((value) => ({
              value,
              label: optionLabel(value),
            }))}
          />

          {(askById.get(looking.id) ?? []).length === 0 ? null : (
            <div className="rounded-density bg-action/10 px-3 py-2 text-sm text-action">
              <p className="font-semibold">Ask before you drive out</p>
              <p>{(askById.get(looking.id) ?? []).join(" · ")}</p>
            </div>
          )}

          <DetailList
            items={[
              {
                label: "Asking",
                value:
                  looking.askingPrice === undefined
                    ? "No price yet"
                    : formatMoney(looking.askingPrice),
              },
              {
                label: "All in",
                value: (
                  <span className="font-semibold">
                    {formatMoney(totalAcquisitionCost(looking))}
                  </span>
                ),
              },
              {
                label: "Where",
                value:
                  [
                    looking.location,
                    looking.distanceMiles === undefined ? undefined : `${looking.distanceMiles} mi`,
                  ]
                    .filter((part) => part !== undefined)
                    .join(" · ") || "—",
              },
              { label: "For", value: lookingWant?.title ?? "—" },
              {
                label: "Soundness",
                value:
                  lookingDetail === undefined ? (
                    "—"
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      <Pill tone={SOUNDNESS_TONE[lookingDetail.soundness]}>
                        {lookingDetail.soundness.replace(/_/g, " ")}
                      </Pill>
                      {lookingDetail.vetCheckDone ? null : <Pill tone="danger">no vet check</Pill>}
                    </span>
                  ),
              },
              {
                label: "Does",
                // Not the same as "does nothing" — nobody has said.
                // `disciplineFit` draws the same distinction for anyone
                // filtering on it.
                value:
                  lookingDetail === undefined || lookingDetail.disciplines.length === 0
                    ? "not stated"
                    : lookingDetail.disciplines.join(", "),
              },
              ...(looking.expiresAt === undefined
                ? []
                : [{ label: "Listing closes", value: looking.expiresAt.toLocaleDateString() }]),
              ...(looking.listingUrl === undefined
                ? []
                : [
                    {
                      label: "Listing",
                      wide: true,
                      value: (
                        <a
                          href={looking.listingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-action underline underline-offset-4"
                        >
                          {looking.listingUrl}
                        </a>
                      ),
                    },
                  ]),
            ]}
          />

          {/* Yours, not the seller's (§5.1) — the decision gets made away
              from the screen, so these travel with the horse. */}
          {looking.pros.length + looking.cons.length === 0 ? null : (
            <ul className="flex flex-col gap-1 text-sm">
              {looking.pros.map((pro) => (
                <li key={pro} className="text-ink">
                  + {pro}
                </li>
              ))}
              {looking.cons.map((con) => (
                <li key={con} className="text-muted">
                  − {con}
                </li>
              ))}
            </ul>
          )}

          {looking.notes === undefined ? null : (
            <p className="whitespace-pre-line text-sm text-muted">{looking.notes}</p>
          )}
        </Modal>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "A horse worth looking at" : `Editing ${editing.title}`}
          description="A name and a price is enough to start."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add to the comparison" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const candidate = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(candidate);
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
              label="Which horse"
              required
              hint="How you would say it: “Bay ranch gelding, Weatherford”."
              value={draft.title}
              error={errors["title"]}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Select
              label="Against which want"
              hint="From the roadmap. Blank is fine."
              value={draft.roadmapItemId}
              onChange={(event) => setDraft({ ...draft, roadmapItemId: event.target.value })}
              // A real option rather than a disabled placeholder, so a link
              // put on by mistake can be taken off again.
              options={[
                { value: "", label: "Not against anything in particular" },
                ...wants.map((item) => ({ value: item.id, label: item.title })),
              ]}
            />

            <div className="grid grid-cols-1 gap-density sm:grid-cols-3">
              <TextInput
                label="Asking ($)"
                required
                type="number"
                inputMode="decimal"
                step="0.01"
                value={draft.asking}
                error={errors["askingPrice"]}
                onChange={(event) => setDraft({ ...draft, asking: event.target.value })}
              />
              <TextInput
                label="Hauling ($)"
                type="number"
                inputMode="decimal"
                step="0.01"
                hint="Counted in the all-in figure."
                value={draft.haul}
                onChange={(event) => setDraft({ ...draft, haul: event.target.value })}
              />
              <TextInput
                label="Pre-purchase exam ($)"
                type="number"
                inputMode="decimal"
                step="0.01"
                hint="The vet you send, not the seller's."
                value={draft.exam}
                onChange={(event) => setDraft({ ...draft, exam: event.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-density sm:grid-cols-3">
              <TextInput
                label="Where"
                value={draft.location}
                error={errors["location"]}
                onChange={(event) => setDraft({ ...draft, location: event.target.value })}
              />
              <TextInput
                label="Miles away"
                type="number"
                inputMode="numeric"
                value={draft.distance}
                error={errors["distanceMiles"]}
                onChange={(event) => setDraft({ ...draft, distance: event.target.value })}
              />
              <TextInput
                label="Listing closes"
                type="date"
                hint="A sale date is a deadline. Blank for a private treaty."
                value={draft.expiresAt}
                error={errors["expiresAt"]}
                onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
              />
            </div>

            <TextInput
              label="Link to the listing"
              type="url"
              placeholder="https://"
              value={draft.listingUrl}
              error={errors["listingUrl"]}
              onChange={(event) => setDraft({ ...draft, listingUrl: event.target.value })}
            />

            <div className="grid grid-cols-1 gap-density sm:grid-cols-3">
              <TextInput
                label="Breed"
                value={draft.breed}
                error={errors["breed"]}
                onChange={(event) => setDraft({ ...draft, breed: event.target.value })}
              />
              <Select
                label="Sex"
                value={draft.sex}
                onChange={(event) => setDraft({ ...draft, sex: event.target.value as HorseSex })}
                options={HORSE_SEXES.map((value) => ({ value, label: value }))}
              />
              <TextInput
                label="Age (years)"
                type="number"
                inputMode="numeric"
                value={draft.ageYears}
                error={errors["ageYears"]}
                onChange={(event) => setDraft({ ...draft, ageYears: event.target.value })}
              />
              <TextInput
                label="Height (hands)"
                type="number"
                inputMode="decimal"
                step="0.1"
                hint="15.2 is fifteen hands two inches; runs .0 to .3."
                value={draft.heightHands}
                // Checked as it is typed, against the same rule the schema
                // enforces. Waiting for the save to complain means scrolling
                // back up a long form to find out what it complained about.
                error={errors["heightHands"] ?? heightIssue}
                onChange={(event) => setDraft({ ...draft, heightHands: event.target.value })}
              />
              <Select
                label="Training"
                value={draft.trainingLevel}
                onChange={(event) => setDraft({ ...draft, trainingLevel: event.target.value })}
                options={[
                  { value: "", label: "Not stated" },
                  ...TRAINING_LEVELS.map((value) => ({
                    value,
                    label: optionLabel(value),
                  })),
                ]}
              />
              <Select
                label="Soundness"
                value={draft.soundness}
                onChange={(event) =>
                  setDraft({ ...draft, soundness: event.target.value as SoundnessStatus })
                }
                options={SOUNDNESS_STATUSES.map((value) => ({
                  value,
                  label: optionLabel(value),
                }))}
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink">What he is broke to do</legend>
              {/* Every box clear reads as "nobody has said", not "none of these". */}
              <p className="text-xs text-muted">Leave clear if the listing does not say.</p>
              <div className="flex flex-wrap gap-x-density gap-y-1">
                {DISCIPLINES.map((discipline) => (
                  <Checkbox
                    key={discipline}
                    label={discipline}
                    checked={draft.disciplines.includes(discipline)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        disciplines: event.target.checked
                          ? [...draft.disciplines, discipline]
                          : draft.disciplines.filter((entry) => entry !== discipline),
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>

            <Checkbox
              label="Pre-purchase exam done"
              hint="Until ticked, he stays on the list to ask about."
              checked={draft.vetCheckDone}
              error={errors["vetCheckDone"]}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  vetCheckDone: event.target.checked,
                  // Findings without an exam is what the module's schema
                  // refuses, and the box holding them is hidden the moment
                  // this is unticked — so clear them here rather than failing
                  // the save with an error nobody can see.
                  vetCheckNotes: event.target.checked ? draft.vetCheckNotes : "",
                })
              }
            />
            {draft.vetCheckDone ? (
              <TextArea
                label="What the vet found"
                rows={3}
                value={draft.vetCheckNotes}
                error={errors["vetCheckNotes"]}
                onChange={(event) => setDraft({ ...draft, vetCheckNotes: event.target.value })}
              />
            ) : null}

            <TextArea
              label="Temperament"
              rows={2}
              hint="To catch, to tie, to load."
              value={draft.temperament}
              error={errors["temperament"]}
              onChange={(event) => setDraft({ ...draft, temperament: event.target.value })}
            />

            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Association"
                hint="AQHA, APHA — blank if he is grade."
                value={draft.association}
                error={errors["association"]}
                onChange={(event) => setDraft({ ...draft, association: event.target.value })}
              />
              <TextInput
                label="Registration number"
                value={draft.regNumber}
                error={errors["regNumber"]}
                onChange={(event) => setDraft({ ...draft, regNumber: event.target.value })}
              />
            </div>

            <TagInput
              label="Pros"
              value={draft.pros}
              onChange={(pros) => setDraft({ ...draft, pros })}
              placeholder="Loads and hauls quiet"
            />
            <TagInput
              label="Cons"
              value={draft.cons}
              onChange={(cons) => setDraft({ ...draft, cons })}
              placeholder="Barn sour"
            />

            <TextArea
              label="Notes"
              rows={3}
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <Select
              label="Where this stands"
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as CandidateStatus })
              }
              options={CANDIDATE_STATUSES.map((value) => ({
                value,
                label: optionLabel(value),
              }))}
            />

            {draft.heightHands === "" || heightIssue !== undefined ? null : (
              <p className="text-sm text-muted">
                {/* Said out loud, so a slip is visible before it is saved. */}
                {describeHeight(Number(draft.heightHands))}
              </p>
            )}

            {/*
              The same complaints as the fields carry, repeated where the save
              button is. This form is long enough that a message attached to
              the height box, eleven fields up, is a form that refuses to save
              for no visible reason.
            */}
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

/** `2026-08-13`, in local time — what a `type="date"` input wants. */
function forDateInput(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
