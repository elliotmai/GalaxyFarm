"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import type { Animal, Ulid } from "@galaxy-farm/core";
import { Pill, Section, useToast, type Tone } from "@galaxy-farm/ui";

import { Row, Rows } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { useAttachPhotos } from "@/lib/photos/use-photos";

/**
 * The parts every animal's own page is built from (V2 Animal).
 *
 * The cow's page set the anatomy — who she is, big buttons for what people do
 * to her, "Coming up", one History newest first, and everything else behind
 * one disclosure. A dog's page and a horse's page are that same page with
 * different buttons and different records, so the shapes live here once and a
 * shot on the cat reads exactly like a shot on the cow.
 *
 * Nothing in this file reads or writes a record of its own. Each page decides
 * what its buttons open and which records become rows; these only draw them.
 */

// ── Action tiles ──────────────────────────────────────────────────────────

const TILE =
  "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-density border border-rule bg-panel px-1 text-center text-[13px] font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

/** The grid of big buttons under an animal's name: four across, always. */
export function ActionGrid({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <nav aria-label={label} className="grid grid-cols-4 gap-2">
      {children}
    </nav>
  );
}

/** A tile that goes somewhere — usually the ＋ Log flow, part-way in. */
export function ActionLink({
  href,
  icon,
  children,
}: {
  readonly href: string;
  readonly icon: ActionIconName;
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} className={TILE}>
      <ActionIcon name={icon} />
      {children}
    </Link>
  );
}

/** A tile that opens a form on this page, in a side panel (a sheet on a phone). */
export function ActionButton({
  onClick,
  icon,
  children,
}: {
  readonly onClick: () => void;
  readonly icon: ActionIconName;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className={TILE}>
      <ActionIcon name={icon} />
      {children}
    </button>
  );
}

/**
 * The camera, straight away (issue #9: a photo is ≤2 taps from the profile).
 *
 * Through the same photo pipeline the gallery uses, so the picture queues on
 * the device and works with no signal.
 */
export function PhotoAction({
  animalId,
  propertyId,
  actorId,
}: {
  readonly animalId: Ulid;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const intake = useAttachPhotos({ propertyId, actorId, ownerEntity: "Animal", ownerId: animalId });
  const id = useId();
  const { show } = useToast();

  // A photo that could not be added says so out loud: a tile that quietly
  // went back to "Photo" reads as a photo taken.
  const { problem, clearProblem } = intake;
  useEffect(() => {
    if (problem === undefined) return;
    show({ message: problem, tone: "danger" });
    // crud-guard: allow-unconfirmed — clears an error message; nothing persisted is touched
    clearProblem();
  }, [problem, clearProblem, show]);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Cleared first, so retaking a photo the phone names `image.jpg` both
    // times still fires a change.
    event.target.value = "";
    if (files.length > 0) void intake.attach(files);
  }

  return (
    <label
      htmlFor={id}
      className={`${TILE} relative cursor-pointer ${intake.busy ? "opacity-60" : ""}`}
    >
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        aria-label="Photo"
        aria-busy={intake.busy}
        disabled={intake.busy}
        onChange={pick}
        className="sr-only"
      />
      <ActionIcon name="photo" />
      {intake.busy ? "Adding…" : "Photo"}
    </label>
  );
}

export type ActionIconName =
  | "treatment"
  | "weight"
  | "calving"
  | "heat"
  | "breeding"
  | "move"
  | "photo"
  | "note"
  | "shot"
  | "medicine"
  | "worming"
  | "vet"
  | "food"
  | "edit";

const ICONS: Readonly<Record<ActionIconName, ReactNode>> = {
  treatment: (
    <>
      <path d="M18 2l4 4" />
      <path d="M17 7l3-3" />
      <path d="M19 9L9 19l-4 1 1-4L16 6z" />
      <path d="M11 11l2 2" />
    </>
  ),
  weight: (
    <>
      <path d="M6 20h12l-2-12H8z" />
      <circle cx="12" cy="5" r="2" />
    </>
  ),
  calving: <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />,
  heat: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 3s1-3 0-6z" />,
  breeding: (
    <>
      <circle cx="9" cy="12" r="5" />
      <circle cx="15" cy="12" r="5" />
    </>
  ),
  move: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  photo: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h5" />
    </>
  ),
  // The syringe again: a vaccination is a shot whichever animal takes it.
  shot: (
    <>
      <path d="M18 2l4 4" />
      <path d="M17 7l3-3" />
      <path d="M19 9L9 19l-4 1 1-4L16 6z" />
      <path d="M11 11l2 2" />
    </>
  ),
  medicine: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)" />
      <path d="M9.5 9.5l5 5" />
    </>
  ),
  worming: <path d="M4 16c2-4 4 0 6-4s4 0 6-4 2-2 4-2" />,
  vet: (
    <>
      <path d="M6 3v6a4 4 0 0 0 8 0V3" />
      <path d="M10 13v3a4 4 0 0 0 8 0v-2" />
      <circle cx="18" cy="12" r="2" />
    </>
  ),
  food: (
    <>
      <path d="M3 12h18a9 9 0 0 1-18 0z" />
      <path d="M8 8c0-2 2-2 2-4M13 8c0-2 2-2 2-4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
};

/** Line icons, one stroke weight, in the action colour. */
export function ActionIcon({ name }: { readonly name: ActionIconName }) {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-action"
    >
      {ICONS[name]}
    </svg>
  );
}

// ── Coming up and History ─────────────────────────────────────────────────

/** One thing that happened, or will: the row both lists are made of. */
export interface TimelineRow {
  readonly key: string;
  readonly date: Date;
  readonly title: string;
  readonly line: string;
  readonly chip?: { readonly tone: Tone; readonly label: string } | undefined;
  /** Opens the record behind the row — its editor — when the page has one. */
  readonly onSelect?: (() => void) | undefined;
  /** What pressing the row does, for a screen reader. */
  readonly selectLabel?: string | undefined;
}

function TimelineItem({ row }: { readonly row: TimelineRow }) {
  return (
    <Row
      title={row.title}
      line={row.line}
      chip={row.chip === undefined ? undefined : <Pill tone={row.chip.tone}>{row.chip.label}</Pill>}
      onSelect={row.onSelect}
      selectLabel={row.selectLabel}
    />
  );
}

/** "Coming up": the next few things to be ready for, soonest first. */
export function ComingUpSection({ rows }: { readonly rows: readonly TimelineRow[] }) {
  return (
    <Section title="Coming up">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing coming up.</p>
      ) : (
        <Rows label="Coming up">
          {rows.map((row) => (
            <TimelineItem key={row.key} row={row} />
          ))}
        </Rows>
      )}
    </Section>
  );
}

/** How much History shows before "Show all" — about a phone screen. */
export const HISTORY_PAGE = 12;

/** One History, newest first, every kind of record in it. */
export function HistorySection({
  rows,
  name,
}: {
  readonly rows: readonly TimelineRow[];
  /** The animal's name, so the list announces whose history it is. */
  readonly name: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, HISTORY_PAGE);

  return (
    <Section title="History" description={rows.length === 0 ? undefined : `${rows.length} on file`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Rows label={`History for ${name}`}>
            {shown.map((row) => (
              <TimelineItem key={row.key} row={row} />
            ))}
          </Rows>
          {rows.length > HISTORY_PAGE ? (
            <button
              type="button"
              onClick={() => setShowAll((was) => !was)}
              className="inline-flex min-h-target items-center self-start text-sm font-semibold text-action underline-offset-2 hover:underline"
            >
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/**
 * The dated lines the Log's Note writes, as History rows.
 *
 * A note is added to the top of the animal's `notes` as `YYYY-MM-DD: text`
 * (see the Log's note form), so the field is itself a dated log. Undated text —
 * whatever somebody typed into the editor — is left for the details, where it
 * reads as a description rather than an event.
 */
export function noteRows(animal: Pick<Animal, "notes">): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const [index, raw] of (animal.notes ?? "").split("\n").entries()) {
    const match = /^(\d{4})-(\d{2})-(\d{2}): (.+)$/.exec(raw.trim());
    if (match === null) continue;
    const [, year, month, day, text] = match;
    // Noon, like every other date the Log writes, so no time zone moves it a day.
    const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
    rows.push({
      key: `note:${index}`,
      date,
      title: text ?? "",
      line: `Note · ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`,
    });
  }
  return rows;
}

/** The notes somebody typed by hand, without the Log's dated lines (those are History). */
export function undatedNotes(animal: Pick<Animal, "notes">): string | undefined {
  const text = (animal.notes ?? "")
    .split("\n")
    .filter((raw) => !/^\d{4}-\d{2}-\d{2}: /.test(raw.trim()))
    .join("\n")
    .trim();
  return text === "" ? undefined : text;
}

// ── The disclosure ────────────────────────────────────────────────────────

/**
 * Everything a working week does not reach for, behind one button.
 *
 * Closed by default, and the label says what is inside, so nobody has to open
 * it to find out whether the thing they want is there.
 */
export function MoreDisclosure({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col gap-density">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-target w-full items-center justify-between gap-3 rounded-density border border-rule bg-panel px-4 py-3 text-left font-semibold text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        {label}
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
        <div id={panelId} className="flex flex-col gap-density">
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ── The header ────────────────────────────────────────────────────────────

/**
 * Who this is: the round badge, the name, one line of facts and
 * at most one chip — the animal's list row, opened.
 */
export function AnimalHeader({
  back,
  badge,
  title,
  chip,
  facts,
  children,
}: {
  /**
   * A trail drawn above the name. Optional and left off the pet and horse
   * pages: the admin layout draws one Back link above every page, labelled
   * with the previous page's h1, so the name must stay the page's h1.
   */
  readonly back?: { readonly href: string; readonly label: string } | undefined;
  /** What sits in the round badge: the tag, or a stand-in where there is none. */
  readonly badge: string | undefined;
  readonly title: string;
  readonly chip?: ReactNode;
  readonly facts: string;
  /** Anything that must be said before anybody opens the gate. */
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {back === undefined ? null : (
        <p className="text-xs font-medium text-muted">
          <Link
            href={back.href}
            className="inline-flex min-h-target items-center hover:text-ink md:min-h-0"
          >
            <span aria-hidden="true">‹</span>&nbsp;{back.label}
          </Link>
        </p>
      )}
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden={badge === undefined || badge === "" ? true : undefined}
          className="gf-numeric flex h-14 min-w-[3.5rem] max-w-[7rem] shrink-0 items-center justify-center rounded-full bg-raised px-2 font-semibold text-action"
        >
          <span className="truncate">{badge === undefined || badge === "" ? "–" : badge}</span>
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-ink">{title}</h1>
            {chip ?? null}
          </div>
          {facts === "" ? null : <p className="text-sm text-muted">{facts}</p>}
        </div>
      </div>
      {children}
    </header>
  );
}
