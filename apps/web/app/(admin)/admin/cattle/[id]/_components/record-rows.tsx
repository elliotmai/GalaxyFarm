"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The record-list pieces the cattle screens share (spec §8).
 *
 * The herd list set the anatomy — a bold title, one muted line of facts, at
 * most one chip — and every log on these screens is the same shape: a
 * treatment, a weighing, a sale, a feeding. Written once here so a health
 * record and a weight read as the same kind of thing, rather than as a table
 * on one screen and a card grid on the next.
 */

/** Joins the facts that are there, so a missing one leaves no stray dot. */
export function facts(...parts: readonly (string | number | undefined | false | null)[]): string {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== false && part !== "")
    .join(" · ");
}

/** A bordered list of rows, the one container every record list here uses. */
export function Rows({
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

export interface RowProps {
  readonly title: ReactNode;
  readonly line?: string | undefined;
  readonly chip?: ReactNode;
  /** Wraps rather than truncates: a note cut mid-word loses the point. */
  readonly notes?: string | undefined;
  /** The whole row is a link to this, when given. */
  readonly href?: string | undefined;
  /** The whole row opens this, when given — usually the record's editor. */
  readonly onSelect?: (() => void) | undefined;
  /** Names what pressing the row does, for a screen reader. */
  readonly selectLabel?: string | undefined;
  /** Beside the row rather than inside it, so there are never two nested targets. */
  readonly action?: ReactNode;
}

const ROW_BODY =
  "flex min-h-[3.5rem] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left text-ink";
const ROW_TARGET =
  "hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action";

/** One record: a bold title, one muted line, at most one chip. */
export function Row({ title, line, chip, notes, href, onSelect, selectLabel, action }: RowProps) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold">{title}</span>
        {line === undefined || line === "" ? null : (
          <span className="truncate text-sm text-muted">{line}</span>
        )}
        {notes === undefined || notes === "" ? null : (
          <span className="text-sm text-muted">{notes}</span>
        )}
      </span>
      {chip === undefined || chip === null ? null : <span className="shrink-0">{chip}</span>}
    </>
  );

  return (
    <li className="flex items-center bg-panel">
      {href !== undefined ? (
        <Link href={href} className={`${ROW_BODY} ${ROW_TARGET}`}>
          {body}
        </Link>
      ) : onSelect !== undefined ? (
        <button
          type="button"
          onClick={onSelect}
          aria-haspopup="dialog"
          {...(selectLabel === undefined ? {} : { "aria-label": selectLabel })}
          className={`${ROW_BODY} ${ROW_TARGET}`}
        >
          {body}
        </button>
      ) : (
        <div className={ROW_BODY}>{body}</div>
      )}
      {action === undefined ? null : <span className="mr-1 shrink-0">{action}</span>}
    </li>
  );
}

/** A pill toggle — the herd screen's class chip. */
export function Chip({
  on,
  onClick,
  children,
}: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={[
        "inline-flex min-h-target shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
        on
          ? "bg-action/15 font-semibold text-action"
          : "font-medium text-muted hover:bg-raised hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** A row of chips that scrolls sideways on a phone rather than wrapping. */
export function ChipRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
    >
      {children}
    </div>
  );
}

/**
 * "Showing 4 of 30 · Under withdrawal · Clear" — said whenever a list is
 * narrowed, because a filtered list that does not say so reads as a short one.
 */
export function FilteredLine({
  shown,
  total,
  what,
  onClear,
}: {
  readonly shown: number;
  readonly total: number;
  readonly what: string;
  readonly onClear: () => void;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
      <span>
        Showing {shown} of {total}
      </span>
      <span aria-hidden="true">·</span>
      <span>{what}</span>
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
 * The phone's add button, floating bottom-right where a thumb already is and
 * clear of the tab bar. Not drawn on anything wider, where the same action
 * sits in the header.
 *
 * A plain button rather than `Button`: its shape and shadow are its own, and
 * overriding a primitive's radius from outside is a fight over class order.
 */
export function AddFab({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
    >
      <span aria-hidden="true" className="text-xl leading-none">
        +
      </span>
      {children}
    </button>
  );
}

/** A screen's title with its facts beside it and one action opposite. */
export function ScreenHeader({
  title,
  facts: line,
  action,
}: {
  readonly title: string;
  readonly facts?: string | undefined;
  readonly action?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-density">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
        <h1 className="text-ink">{title}</h1>
        {line === undefined || line === "" ? null : (
          <span className="text-sm text-muted">{line}</span>
        )}
      </div>
      {/* A screen with a floating add button hides this one on a phone by
          wrapping it in `hidden sm:block` — a wrapper, because the button's
          own `inline-flex` wins over a `hidden` passed in. */}
      {action === undefined ? null : <span className="shrink-0">{action}</span>}
    </header>
  );
}
