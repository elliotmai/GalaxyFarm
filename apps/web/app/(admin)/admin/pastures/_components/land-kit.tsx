"use client";

import type { ReactNode } from "react";

import { Pill, type Tone } from "@galaxy-farm/ui";

/**
 * The small parts every Land screen is built from — pastures, the property
 * map's lists, and the garden (spec §8).
 *
 * The same anatomy as the herd list (`cattle/_components/herd-row.tsx`): a
 * bold name, one muted line of facts, at most one chip, and the editor one tap
 * away in a side panel. Kept here rather than per panel so eight lists on four
 * screens cannot drift into eight slightly different rows.
 */

/** The single state a row is allowed to shout about. */
export interface RowChip {
  readonly tone: Tone;
  readonly label: string;
}

/** The list a run of `LandRow`s sits in: one surface, hairlines between. */
export function RowList({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
    >
      {children}
    </ul>
  );
}

export interface LandRowProps {
  readonly title: ReactNode;
  /** "Pen · outside · 4 / 6 · North tank" — already joined, so the row stays dumb. */
  readonly line?: ReactNode;
  readonly chip?: RowChip | undefined;
  /** What tapping the row does — nearly always opening the editor. */
  readonly onOpen?: () => void;
  /** The accessible name for that, when the title alone does not say it. */
  readonly openLabel?: string;
  /** One quick action beside the row: the one-tap toggle a panel keeps. */
  readonly action?: ReactNode;
  /** Dimmed — stowed, resting, finished. Still listed, still editable. */
  readonly quiet?: boolean;
}

/**
 * One record in a Land list.
 *
 * The whole face is the button, so a thumb landing on the muted line still
 * opens the record. The quick action sits beside it rather than inside — a
 * button nested in a button is two targets the browser has to guess between.
 */
export function LandRow({ title, line, chip, onOpen, openLabel, action, quiet }: LandRowProps) {
  const face = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`truncate font-semibold ${quiet === true ? "text-muted" : "text-ink"}`}>
          {title}
        </span>
        {line === undefined || line === "" ? null : (
          <span className="truncate text-sm text-muted">{line}</span>
        )}
      </span>
      {chip === undefined ? null : (
        <span className="shrink-0">
          <Pill tone={chip.tone}>{chip.label}</Pill>
        </span>
      )}
    </>
  );

  const faceClass = "flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left";

  return (
    <li className="flex items-center bg-panel">
      {onOpen === undefined ? (
        <div className={faceClass}>{face}</div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className={`${faceClass} hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action`}
        >
          {face}
        </button>
      )}
      {action === undefined ? null : <span className="mr-2 shrink-0">{action}</span>}
    </li>
  );
}

/** A quiet, compact button for a row's one quick action. */
export function RowAction({
  children,
  onClick,
  label,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  /** The accessible name, naming the record — "Rest North Trap". */
  readonly label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-target items-center whitespace-nowrap rounded-density px-3 text-sm font-semibold text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-action"
    >
      {children}
    </button>
  );
}

export interface Chip {
  readonly key: string;
  readonly label: string;
  readonly count?: number | undefined;
}

/**
 * The filters people reach for, as one row of toggles.
 *
 * A single row that scrolls sideways on a phone, because a row that wraps
 * pushes the list down. Pressing the chip already on goes back to everything,
 * so the row is a way out as well as a way in.
 */
export function ChipGroup({
  label,
  chips,
  value,
  onChange,
  trailing,
}: {
  readonly label: string;
  readonly chips: readonly Chip[];
  readonly value: string;
  readonly onChange: (key: string) => void;
  readonly trailing?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
    >
      {chips.map((chip) => {
        const on = value === chip.key;
        return (
          <button
            key={chip.key === "" ? "all" : chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? "" : chip.key)}
            className={[
              "inline-flex min-h-target shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
              on
                ? "bg-action/15 font-semibold text-action"
                : "font-medium text-muted hover:bg-raised hover:text-ink",
            ].join(" ")}
          >
            {chip.label}
            {chip.count === undefined ? null : (
              <span className="gf-numeric text-xs opacity-80">{chip.count}</span>
            )}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}

/**
 * What is on, whenever anything is.
 *
 * A narrowed list that does not say so is a screen that lies: somebody looks
 * for the north tank, does not find it, and concludes it was deleted.
 */
export function FilteredLine({
  shown,
  total,
  labels,
  onClear,
}: {
  readonly shown: number;
  readonly total: number;
  readonly labels: readonly string[];
  readonly onClear: () => void;
}) {
  if (labels.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
      <span>
        Showing {shown} of {total}
      </span>
      <span aria-hidden="true">·</span>
      <span>{labels.join(" · ")}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
      >
        Clear
      </button>
    </p>
  );
}

/**
 * The primary action, twice: in the toolbar on anything wider than a phone,
 * floating bottom-right on one, where a thumb already is and clear of the tab
 * bar. The toolbar copy is hidden by a wrapper, not a class on the button —
 * the button's own `inline-flex` would win over a `hidden` passed in.
 */
export function AddAction({
  label,
  onClick,
  disabled = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  /** When there is nothing yet to add against — no beds, no varieties. */
  readonly disabled?: boolean;
}) {
  return (
    <>
      <span className="hidden sm:block">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="inline-flex min-h-target items-center gap-2 whitespace-nowrap rounded-density bg-action px-4 font-medium text-action-ink hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">+</span> {label}
        </button>
      </span>
      {/* A plain button rather than `Button`: its shape and shadow are its
          own, and overriding a primitive's radius from outside is a fight over
          class order the stylesheet decides. */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:opacity-50 sm:hidden"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        {label}
      </button>
    </>
  );
}

/**
 * One line of status, said once — the replacement for a stack of callouts.
 *
 * Danger for what has to happen before somebody leaves the house, action for
 * what is owed soon, calm for "all fine", which is said quietly or not at all.
 */
export function StatusLine({
  tone,
  children,
}: {
  readonly tone: "danger" | "action" | "calm";
  readonly children: ReactNode;
}) {
  const dot = tone === "danger" ? "bg-danger" : tone === "action" ? "bg-action" : "bg-calm";
  return (
    <p className="flex items-start gap-2 text-sm text-ink">
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
