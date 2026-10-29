"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  Pill,
  Section,
  Select,
  TextArea,
  useToast,
} from "@galaxy-farm/ui";
import {
  dayKey,
  type Animal,
  type ChoreTemplate,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  flockSchema,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import { Row, Rows } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { ageLabel } from "@/app/(admin)/admin/cattle/_components/herd-row";
import {
  FlockActions,
  type FlockAction,
} from "@/app/(admin)/admin/chickens/flock/[id]/_components/flock-actions";
import {
  comingUp,
  eggTrend,
  formatDate,
  history,
  splitNotes,
  TREND_DAYS,
  withNote,
  type FlockRow,
} from "@/app/(admin)/admin/chickens/flock/[id]/_components/flock-history";
import {
  coopOptions,
  FlockEditor,
  SPECIES_LABEL,
} from "@/app/(admin)/admin/chickens/flock/_components/flock-editor";
import { RecordChange } from "@/app/(admin)/admin/chickens/flock/_components/headcount-panel";
import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { PhotoPanel } from "@/app/_components/photo-panel";
import { animalTitle } from "@/lib/animal-slug";
import { birdsOfFlock, flockHref, resolveFlockSlug } from "@/lib/flock-slug";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * One flock (spec §7 `/admin/chickens/flock/[id]`, §5.4; the cow page's V2).
 *
 * Read top to bottom it answers what the cow's page does: which birds these
 * are, what do I want to record about them, what is coming, how are they
 * laying, and what has happened. The top is the flock's row opened — the
 * count in the badge, the name, one line — then the big buttons, then
 * "Coming up" when the coop has chores on it, a week of eggs, the birds kept
 * by name, one History newest first, the photos, and the flock's fields behind
 * one disclosure where the editor and delete live.
 *
 * The headcount is never a field here either (§4.5). It is the opening count
 * plus the log, worked out as of tonight, and the History carries every entry
 * that moved it — so the number at the top always adds up from the list.
 *
 * The URL is the flock's name as a slug — see `lib/flock-slug.ts` — and the
 * record is found on the device, as the herd's are.
 */

/** How much History shows before "Show all" — about a phone screen. */
const HISTORY_PAGE = 12;

const BASE = "/admin/chickens/flock";

type Open = FlockAction | "edit" | undefined;

export function FlockRecordScreen({
  slug,
  propertyId,
  actorId,
}: {
  readonly slug: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const router = useRouter();
  const query = { propertyId };
  const { records: flocks, loading } = useRecords<Flock>("flocks", query);
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  const { records: eggLogs } = useRecords<EggLog>("eggLogs", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: chores } = useRecords<ChoreTemplate>("choreTemplates", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: placements } = useRecords<ZoneAssignment>("zoneAssignments", query);

  const [open, setOpen] = useState<Open>();
  const [showAll, setShowAll] = useState(false);

  // One clock for the whole render, so the count, the egg week and the chores
  // cannot disagree with each other at midnight.
  const asOf = useMemo(() => new Date(), []);

  const found = useMemo(() => resolveFlockSlug(slug, flocks), [slug, flocks]);

  // An old link (by id, or from before a rename) moves to the current one. In
  // an effect: navigating during render updates the router mid-render.
  const canonical = found === undefined ? undefined : flockHref(found.flock, flocks);
  const moveTo = found?.stale === true && canonical !== `${BASE}/${slug}` ? canonical : undefined;
  useEffect(() => {
    if (moveTo !== undefined) router.replace(moveTo);
  }, [moveTo, router]);

  if (loading) return <p className="text-muted">Looking…</p>;

  if (found === undefined) {
    return (
      <PageBody>
        <EmptyState
          title="No flock by that name"
          detail="Nothing on this device answers to that name."
          action={
            <Link href={BASE} className="text-action underline">
              Back to the flocks
            </Link>
          }
        />
      </PageBody>
    );
  }

  const flock = found.flock;
  const coop = zones.find((zone) => zone.id === flock.zoneId);
  const inputs = { flock, adjustments, eggLogs, chores, now: asOf };
  const trend = eggTrend(inputs);
  const count = trend.headCount;
  const ahead = comingUp(inputs);
  const past = history(inputs);
  const pastShown = showAll ? past : past.slice(0, HISTORY_PAGE);
  const birds = birdsOfFlock(flock, flocks, animals, placements);

  const facts = [
    flock.breedMix ?? SPECIES_LABEL[flock.species],
    `${count} ${flock.species === "quail" ? "quail" : count === 1 ? "bird" : "birds"} today`,
    coop?.name,
    // A flock has no hatch date, so its age is how long it has been on file.
    `kept since ${flock.createdAt.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  // The flock row's one chip, worked out the same way.
  const chip = !flock.active ? (
    <Pill tone="neutral">Switched off</Pill>
  ) : count === 0 ? (
    <Pill tone="danger">Empty</Pill>
  ) : coop === undefined ? (
    <Pill tone="danger">No coop</Pill>
  ) : undefined;

  const peak = trend.days.reduce((most, day) => Math.max(most, day.total), 0);

  return (
    <PageBody>
      <header className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {/* The count, where a cow's page has her tag: the number somebody
              at the coop door checks first. */}
          <span className="gf-numeric flex h-14 min-w-[3.5rem] max-w-[7rem] shrink-0 items-center justify-center rounded-full bg-raised px-2 font-semibold text-action">
            <span className="truncate">{count}</span>
            <span className="sr-only"> bird{count === 1 ? "" : "s"}</span>
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-ink">{flock.name}</h1>
              {chip}
            </div>
            <p className="text-sm text-muted">{facts}</p>
          </div>
        </div>
      </header>

      <FlockActions
        flockId={flock.id}
        propertyId={propertyId}
        actorId={actorId}
        onAction={setOpen}
      />

      {ahead.length === 0 ? null : (
        <Section title="Coming up">
          <Rows label="Coming up">
            {ahead.map((row) => (
              <FlockItem key={row.key} row={row} />
            ))}
          </Rows>
        </Section>
      )}

      <Section
        title="Eggs"
        description={`${trend.total} in the last ${TREND_DAYS} days`}
        actions={
          <Link
            href={`/admin/chickens/eggs?tab=trends&flock=${flock.id}`}
            className="inline-flex min-h-target items-center text-sm font-semibold text-action underline-offset-2 hover:underline"
          >
            Full trends
          </Link>
        }
      >
        <div className="flex flex-col gap-2 rounded-density border border-rule bg-panel p-density">
          <p className="text-sm text-muted">
            {[
              `${trend.today} today`,
              trend.rate === undefined ? undefined : `${trend.rate.toFixed(2)} per bird a day`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {/* A day per bar, oldest on the left. The numbers are written under
              each one, so the figure reads without a scale. */}
          <ol
            aria-label={`Eggs by day, last ${TREND_DAYS} days`}
            className="grid grid-cols-7 gap-1"
          >
            {trend.days.map((day) => (
              <li key={day.key} className="flex flex-col items-center gap-1">
                <span className="flex h-16 w-full items-end justify-center">
                  <span
                    aria-hidden="true"
                    className={`w-full max-w-[2rem] rounded-sm ${day.total === 0 ? "bg-raised" : "bg-action"}`}
                    style={{
                      height: peak === 0 ? "4px" : `${Math.max(4, (day.total / peak) * 64)}px`,
                    }}
                  />
                </span>
                <span className="gf-numeric text-xs font-semibold text-ink">{day.total}</span>
                <span className="text-xs text-muted">
                  {dayKey(day.date) === dayKey(asOf)
                    ? "Today"
                    : day.date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {birds.length === 0 ? null : (
        <Section
          title="Birds by name"
          description={`${birds.length} in ${coop?.name ?? "the coop"}`}
        >
          <BirdRows birds={birds} asOf={asOf} />
        </Section>
      )}

      <Section
        title="History"
        description={past.length === 0 ? undefined : `${past.length} on file`}
      >
        <div className="flex flex-col gap-2">
          <Rows label={`History for ${flock.name}`}>
            {pastShown.map((row) => (
              <FlockItem key={row.key} row={row} />
            ))}
          </Rows>
          {past.length > HISTORY_PAGE ? (
            <button
              type="button"
              onClick={() => setShowAll((was) => !was)}
              className="inline-flex min-h-target items-center self-start text-sm font-semibold text-action underline-offset-2 hover:underline"
            >
              {showAll ? "Show fewer" : `Show all ${past.length}`}
            </button>
          ) : null}
        </div>
      </Section>

      <PhotoPanel
        propertyId={propertyId}
        actorId={actorId}
        ownerEntity="Flock"
        ownerId={flock.id}
        recordName={flock.name}
      />

      <Details
        flock={flock}
        coop={coop}
        onEdit={() => setOpen("edit")}
        notes={splitNotes(flock.notes).rest}
      />

      {open === "headcount" ? (
        <RecordChange
          flocks={flocks}
          adjustments={adjustments}
          propertyId={propertyId}
          actorId={actorId}
          focusedFlockId={flock.id}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open === "move" ? (
        <MovePanel
          flock={flock}
          zones={zones}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open === "note" ? (
        <NotePanel
          flock={flock}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open === "edit" ? (
        <FlockEditor
          flock={flock}
          adjustments={adjustments}
          zones={zones}
          eggLogs={eggLogs}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setOpen(undefined)}
          // Nothing left to show here, so back to the list it came from.
          onDeleted={() => router.push(BASE)}
        />
      ) : null}
    </PageBody>
  );
}

function FlockItem({ row }: { readonly row: FlockRow }) {
  return (
    <Row
      title={
        row.direction === undefined ? (
          row.title
        ) : (
          // The sign is the point of a headcount row, so it says which way
          // the count went in colour, as it does in the headcount log.
          <>
            <span className={row.direction > 0 ? "text-calm" : "text-danger"}>
              {row.title.split(" ")[0]}
            </span>{" "}
            {row.title.split(" ").slice(1).join(" ")}
          </>
        )
      }
      line={row.line}
      notes={row.notes}
      chip={row.chip === undefined ? undefined : <Pill tone={row.chip.tone}>{row.chip.label}</Pill>}
    />
  );
}

/**
 * The birds in this coop that have records of their own — a named rooster,
 * the old hen. Each gets a note straight into the Log, which already writes
 * notes on any animal, closing back to this page.
 */
function BirdRows({ birds, asOf }: { readonly birds: readonly Animal[]; readonly asOf: Date }) {
  const from = usePathname();
  return (
    <Rows label="Birds by name">
      {birds.map((bird) => (
        <BirdRow key={bird.id} bird={bird} asOf={asOf} from={from} />
      ))}
    </Rows>
  );
}

function BirdRow({
  bird,
  asOf,
  from,
}: {
  readonly bird: Animal;
  readonly asOf: Date;
  readonly from: string | null;
}) {
  return (
    <Row
      title={animalTitle(bird)}
      line={[
        bird.species === "quail" ? "Quail" : bird.sex === "male" ? "Rooster" : "Hen",
        bird.tagNumber === undefined || bird.tagNumber === ""
          ? undefined
          : `Band ${bird.tagNumber}`,
        ageLabel(bird, asOf),
      ]
        .filter((part) => part !== undefined && part !== "")
        .join(" · ")}
      notes={bird.notes?.split("\n")[0]}
      action={
        <Link
          href={logHref({ kind: "note", animals: [bird.id], from })}
          aria-label={`Note on ${animalTitle(bird)}`}
          className="inline-flex min-h-target items-center px-3 text-sm font-semibold text-action underline-offset-2 hover:underline"
        >
          Note
        </Link>
      }
    />
  );
}

/**
 * What is on file about the flock, behind one disclosure.
 *
 * The header already says the name, the count and the coop; what is here is
 * what somebody reaches for when setting the flock up or correcting it, with
 * the editor (and the flock's delete) one tap further.
 */
function Details({
  flock,
  coop,
  notes,
  onEdit,
}: {
  readonly flock: Flock;
  readonly coop: Zone | undefined;
  /** The notes without the dated lines, which History already shows. */
  readonly notes: string;
  readonly onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const items = [
    { label: "Species", value: SPECIES_LABEL[flock.species] },
    { label: "Breed mix", value: flock.breedMix },
    { label: "Coop", value: coop?.name ?? "Not set" },
    { label: "Count to start from", value: String(flock.openingCount) },
    { label: "On file since", value: formatDate(flock.createdAt) },
    { label: "Status", value: flock.active ? "In the yard" : "Switched off" },
    { label: "Notes", value: notes === "" ? undefined : notes, wide: true },
  ].filter((item) => item.value !== undefined && item.value !== "");

  return (
    <div className="flex flex-col gap-density">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-target w-full items-center justify-between gap-3 rounded-density border border-rule bg-panel px-4 py-3 text-left font-semibold text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        Details
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open ? (
        <div id={panelId}>
          <Section
            title="Details"
            actions={
              <Button variant="ghost" aria-haspopup="dialog" onClick={onEdit}>
                Edit flock
              </Button>
            }
          >
            <DetailList items={items} />
          </Section>
        </div>
      ) : null}
    </div>
  );
}

/** Today as the Log writes it on a note: the date somebody would say. */
function todayValue(): string {
  return dayKey(new Date());
}

/**
 * Move the flock to another coop.
 *
 * A flock's coop is one field, so the move overwrites it — which on its own
 * would leave no trace of where the birds were. So the move also writes a
 * dated line into the flock's notes, as a note from this page does, and it
 * shows up in History as the day they went. If the notes are already full
 * the move still happens; only the line is left out.
 */
function MovePanel({
  flock,
  zones,
  propertyId,
  actorId,
  onClose,
}: {
  readonly flock: Flock;
  readonly zones: readonly Zone[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
}) {
  const mutations = useMutations<Flock>("flocks", "flocks", flockSchema, propertyId, actorId);
  const { show } = useToast();
  const options = coopOptions(zones).filter((option) => option.value !== flock.zoneId);
  const [zoneId, setZoneId] = useState(options[0]?.value ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const formId = useId();

  const from = zones.find((zone) => zone.id === flock.zoneId)?.name;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    const to = zones.find((zone) => zone.id === zoneId);
    if (to === undefined) {
      setError("Choose where they are going");
      return;
    }

    setBusy(true);
    try {
      const line = from === undefined ? `Moved to ${to.name}` : `Moved from ${from} to ${to.name}`;
      const notes = withNote(flock.notes, line, todayValue());
      const result = await mutations.update(flock.id, {
        zoneId: to.id,
        ...(notes === undefined ? {} : { notes }),
      } as Partial<Flock>);
      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      show({ message: `${flock.name} moved to ${to.name}`, tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title={`Move ${flock.name}`}
      description={from === undefined ? "No coop set yet." : `In ${from} now.`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            busy={busy}
            disabled={options.length === 0}
          >
            Move them
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      {options.length === 0 ? (
        <EmptyState
          title="Nowhere else to go"
          detail="Add a coop in Settings, under property and zones, to move the flock to it."
        />
      ) : (
        <form
          id={formId}
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-density"
        >
          <Select
            label="To"
            hint="Coops are listed first."
            value={zoneId}
            options={options}
            {...(error === undefined ? {} : { error })}
            onChange={(event) => setZoneId(event.target.value)}
          />
        </form>
      )}
    </Modal>
  );
}

/**
 * A dated note on the flock.
 *
 * Written the way the Log writes a note on an animal: one dated line added to
 * the top of the record's own `notes`, so what was there stays, the flock
 * editor still shows it as one block, and History reads each line back as
 * the day it was said.
 */
function NotePanel({
  flock,
  propertyId,
  actorId,
  onClose,
}: {
  readonly flock: Flock;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
}) {
  const mutations = useMutations<Flock>("flocks", "flocks", flockSchema, propertyId, actorId);
  const { show } = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const formId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (text.trim() === "") {
      setError("Write the note");
      return;
    }
    const notes = withNote(flock.notes, text, todayValue());
    if (notes === undefined) {
      setError("The flock's notes are full. Tidy them in Details, then add this.");
      return;
    }

    setBusy(true);
    try {
      const result = await mutations.update(flock.id, { notes } as Partial<Flock>);
      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      show({ message: "Note saved", tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title={`Note on ${flock.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            Save note
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <TextArea
          label="Note"
          rows={4}
          hint="Moulting, a broody hen, a new feeder. Dated today."
          value={text}
          {...(error === undefined ? {} : { error })}
          onChange={(event) => setText(event.target.value)}
        />
      </form>
    </Modal>
  );
}
