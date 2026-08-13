"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TagInput,
  TextArea,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
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
      asking: String(toDollars(candidate.askingPrice)),
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

  const columns: readonly Column<PurchaseCandidate>[] = [
    {
      key: "horse",
      header: "Horse",
      primary: true,
      render: (candidate) => {
        const detail = detailOf(candidate);
        return (
          <span className="flex flex-col">
            <span className="font-medium text-ink">{candidate.title}</span>
            <span className="text-xs text-muted">
              {detail === undefined ? "details not recorded" : describeHorse(detail)}
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (candidate) => (
        <span className="flex flex-wrap gap-1.5">
          <Pill tone={isOpen(candidate) ? "action" : "neutral"}>
            {candidate.status.replace(/_/g, " ")}
          </Pill>
          {/*
            §6 raises a notification for a listing about to expire. It belongs
            on the screen as well: a listing that closes on Friday is the one
            fact on the row that stops being true on its own.
          */}
          {isExpiring(candidate, now) ? (
            <Pill tone="danger" dot>
              closes {daysUntil(candidate.expiresAt as Date, now) === 0 ? "today" : "soon"}
            </Pill>
          ) : null}
        </span>
      ),
    },
    {
      key: "soundness",
      header: "Soundness",
      render: (candidate) => {
        const detail = detailOf(candidate);
        if (detail === undefined) return <span className="text-muted">—</span>;

        return (
          <span className="flex flex-wrap gap-1.5">
            <Pill tone={SOUNDNESS_TONE[detail.soundness]}>
              {detail.soundness.replace(/_/g, " ")}
            </Pill>
            {detail.vetCheckDone ? null : <Pill tone="danger">no vet check</Pill>}
          </span>
        );
      },
    },
    {
      key: "does",
      header: "Does",
      render: (candidate) => {
        const detail = detailOf(candidate);
        return detail === undefined || detail.disciplines.length === 0 ? (
          // Not the same as "does nothing" — nobody has said. `disciplineFit`
          // draws the same distinction for anyone filtering on it.
          <span className="text-muted">not stated</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {detail.disciplines.map((discipline) => (
              <Pill key={discipline}>{discipline}</Pill>
            ))}
          </span>
        );
      },
    },
    {
      key: "asking",
      header: "Asking",
      numeric: true,
      render: (candidate) => formatMoney(candidate.askingPrice),
    },
    {
      key: "total",
      header: "All in",
      numeric: true,
      // The number the decision is actually made on (§5.1).
      render: (candidate) => (
        <span className="font-semibold">{formatMoney(totalAcquisitionCost(candidate))}</span>
      ),
    },
    {
      key: "where",
      header: "Where",
      render: (candidate) => (
        <span className="flex flex-col">
          <span>{candidate.location ?? "—"}</span>
          {candidate.distanceMiles === undefined ? null : (
            <span className="text-xs text-muted">{candidate.distanceMiles} mi</span>
          )}
        </span>
      ),
    },
    {
      key: "for",
      header: "For",
      render: (candidate) => {
        const want = wants.find((item) => item.id === candidate.roadmapItemId);
        return want === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <Pill tone="identity">{want.title}</Pill>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (candidate) => (
        <span className="flex flex-wrap items-end gap-2">
          {/*
            A candidate walks watching → contacted → inspected → offer_made and
            ends at purchased, passed or gone. A Pass button alone would record
            only the endings, so the whole ladder is here.
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
          <Button variant="ghost" onClick={() => startEdit(candidate)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(candidate)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Horses"
        title="Candidates"
        subtitle="Horses under consideration, compared on what one would actually cost to get here. Live years before the module, because this is the purchase most worth taking slowly."
        actions={
          <Button variant="primary" onClick={startCreate}>
            Add a horse
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Under consideration" value={open.length} tone="identity" />
        <Tile
          label="Worth asking about"
          value={toAsk.length}
          tone={toAsk.length > 0 ? "action" : "calm"}
          emphasis={toAsk.length > 0}
          hint={toAsk.length > 0 ? "Before you drive out" : "Nothing outstanding"}
        />
        <Tile
          label="Cheapest all in"
          value={cheapest === undefined ? "—" : formatMoney(cheapest)}
        />
        <Tile
          label="Passed"
          value={candidates.filter((candidate) => candidate.status === "passed").length}
          hint="Kept, with the reason"
        />
      </div>

      {toAsk.length === 0 ? null : (
        <Callout tone="action" title="Ask before you drive out">
          <ul className="flex flex-col gap-1">
            {toAsk.map(({ candidate, found }) => (
              <li key={candidate.id}>
                <span className="font-semibold">{candidate.title}</span> — {found.join(" · ")}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Section
        title="Comparison"
        description="Sorted on total acquisition cost. A cheaper horse four hundred miles away, with an exam and a haul on top, is often not the cheaper horse."
      >
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="Horses under consideration"
              columns={columns}
              rows={[...candidates].sort(
                (left, right) =>
                  totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents,
              )}
              rowKey={(candidate) => candidate.id}
              empty={
                <EmptyState
                  title="Nothing under consideration"
                  detail="Add a horse you have seen listed. Hauling and the pre-purchase exam go on the record, so the comparison is on what it would really cost."
                  action={
                    <Button variant="primary" onClick={startCreate}>
                      Add the first
                    </Button>
                  }
                />
              }
            />
          </Card>
        )}
      </Section>

      {candidates.some((candidate) => candidate.pros.length + candidate.cons.length > 0) ? (
        <Section
          title="Pros and cons"
          description="Yours, not the seller's. §5.1 puts these on the comparison because the decision gets made away from the screen."
        >
          <div className="grid grid-cols-1 gap-density md:grid-cols-2 xl:grid-cols-3">
            {candidates
              .filter((candidate) => candidate.pros.length + candidate.cons.length > 0)
              .map((candidate) => (
                <Card key={candidate.id} title={candidate.title}>
                  <ul className="flex flex-col gap-1 text-sm">
                    {candidate.pros.map((pro) => (
                      <li key={pro} className="text-ink">
                        + {pro}
                      </li>
                    ))}
                    {candidate.cons.map((con) => (
                      <li key={con} className="text-muted">
                        − {con}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
          </div>
        </Section>
      ) : null}

      <p className="text-sm text-muted">
        What you are shopping <em>for</em> lives on the{" "}
        <Link href="/admin/horses/roadmap" className="text-action underline underline-offset-4">
          horse roadmap
        </Link>
        , and each want there shows the cheapest horse standing against it.
      </p>

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          title={editing === undefined ? "A horse worth looking at" : `Editing ${editing.title}`}
          description="Most listings start sparse. Everything but a name and a price can be filled in after the phone call."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="Which horse"
              required
              hint="&ldquo;Bay ranch gelding, Weatherford&rdquo; — how you would refer to him out loud."
              value={draft.title}
              error={errors["title"]}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Select
              label="Against which want"
              hint="From the roadmap. Leaving it blank is fine — some horses turn up before the want does."
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
                hint="15.2 is fifteen hands two inches. A hand is four inches, so it runs .0 to .3."
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
                    label: value.replace(/_/g, " "),
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
                  label: value.replace(/_/g, " "),
                }))}
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink">What he is broke to do</legend>
              <p className="text-xs text-muted">
                Leave every box clear when the listing does not say — that reads as &ldquo;nobody
                has said&rdquo;, not as &ldquo;none of these&rdquo;.
              </p>
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
              hint="Until this is ticked, he shows on the list of horses worth asking about."
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
              hint="How he was to catch, to tie, to load. The part no listing photograph shows."
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
              hint="What the seller said, who has ridden him, what was agreed on the phone."
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
                label: value.replace(/_/g, " "),
              }))}
            />

            {draft.heightHands === "" || heightIssue !== undefined ? null : (
              <p className="text-sm text-muted">
                {describeHeight(Number(draft.heightHands))} — said out loud, so a slip is visible
                before it is saved.
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

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add to the comparison" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
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
