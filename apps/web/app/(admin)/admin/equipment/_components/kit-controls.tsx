"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";

import { Button, Modal } from "@galaxy-farm/ui";

/**
 * The few pieces every Kit screen is built from (spec §8).
 *
 * The fleet, the feed shed and the supplies cupboard are three lists of the
 * same shape — a row per thing, one muted line, at most one chip, a row of
 * filter chips above and an add button that opens a side panel — so the shape
 * is written once here rather than three slightly different times. The herd
 * screen is the pattern; these are its parts, minus the cattle.
 */

export interface Chip {
  /** "" is the "everything" chip. */
  readonly key: string;
  readonly label: string;
  readonly count?: number | undefined;
}

/**
 * One row of pill toggles that are also the counts.
 *
 * A single row that scrolls sideways on a phone, because a row that wraps
 * pushes the list down. Pressing the chip that is on goes back to "All", so
 * the row is a way out of a filter as well as a way in.
 */
export function ChipRow({
  label,
  chips,
  value,
  onChange,
  after,
}: {
  readonly label: string;
  readonly chips: readonly Chip[];
  readonly value: string;
  readonly onChange: (key: string) => void;
  /** Something quiet at the end of the row — a count that is not a filter. */
  readonly after?: ReactNode;
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
      {after}
    </div>
  );
}

/**
 * "Showing 3 of 11 · Down · Clear".
 *
 * Whenever a list is narrowed it says so, in one line, with the way back. A
 * filtered list that does not say so reads as a shorter list, and somebody
 * concludes the thing they were looking for is not on the place.
 */
export function FilteredLine({
  shown,
  total,
  parts,
  onClear,
}: {
  readonly shown: number;
  readonly total: number;
  readonly parts: readonly string[];
  readonly onClear: () => void;
}) {
  if (parts.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
      <span>
        Showing {shown} of {total}
      </span>
      <span aria-hidden="true">·</span>
      <span>{parts.join(" · ")}</span>
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
 * The add button that floats bottom-right on a phone.
 *
 * Where a thumb already is, and clear of the tab bar below it. On anything
 * wider the header carries the button and this one is not drawn. A plain
 * button rather than `Button`: its shape and shadow are its own, and
 * overriding a primitive's radius from outside is a fight over class order.
 */
export function AddFab({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
    >
      <span aria-hidden="true" className="text-xl leading-none">
        +
      </span>
      {label}
    </button>
  );
}

/** The list a run of `KitRow`s sits in: one surface, hairlines between. */
export function KitList({
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

/**
 * One thing in a Kit list: the name, one muted line, at most one chip.
 *
 * The whole row is the target — a link when the thing has a page of its own,
 * a button that opens its panel when it does not. The pencil sits beside it
 * rather than inside it, because a button nested in an anchor is two targets
 * the browser has to guess between.
 */
export function KitRow({
  title,
  line,
  chip,
  href,
  onOpen,
  openLabel,
  onEdit,
  editLabel,
  lead,
  trailing,
}: {
  readonly title: string;
  readonly line?: string | undefined;
  readonly chip?: ReactNode;
  readonly href?: string;
  readonly onOpen?: () => void;
  /** The accessible name of the row when it is a button, if not the title. */
  readonly openLabel?: string;
  readonly onEdit?: () => void;
  readonly editLabel?: string;
  /** Something small before the name — a meter, a swatch. */
  readonly lead?: ReactNode;
  /** A second action beside the pencil — "Record", "Log use". */
  readonly trailing?: ReactNode;
}) {
  const inner = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate font-semibold">{title}</span>
        {line === undefined || line === "" ? null : (
          <span className="truncate text-sm text-muted">{line}</span>
        )}
      </span>
      {chip === undefined || chip === null ? null : <span className="shrink-0">{chip}</span>}
    </>
  );
  const target =
    "flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action";

  return (
    <li className="flex items-center bg-panel">
      {href !== undefined ? (
        <Link href={href} className={target}>
          {inner}
        </Link>
      ) : onOpen !== undefined ? (
        <button type="button" onClick={onOpen} aria-label={openLabel} className={target}>
          {inner}
        </button>
      ) : (
        <div className={target}>{inner}</div>
      )}
      {trailing === undefined ? null : <span className="shrink-0 px-1">{trailing}</span>}
      {onEdit === undefined ? null : (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel ?? `Edit ${title}`}
          className="mr-1 inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
        >
          <PencilIcon />
        </button>
      )}
    </li>
  );
}

function PencilIcon() {
  return (
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
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/**
 * The top of a Kit screen: title, the facts beside it, one primary action.
 *
 * The action is hidden on a phone by a wrapper, not a class on the button —
 * the button's own `inline-flex` wins over a `hidden` passed in — because the
 * floating `AddFab` is the phone's version of it.
 */
export function KitHeader({
  title,
  facts,
  action,
  eyebrow,
  phoneAction = false,
}: {
  readonly title: string;
  readonly facts?: string | undefined;
  readonly action?: ReactNode;
  readonly eyebrow?: ReactNode;
  /** Keep the action on a phone too — for a screen with no floating button. */
  readonly phoneAction?: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-density">
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow === undefined ? null : <span className="text-xs text-muted">{eyebrow}</span>}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <h1 className="text-ink">{title}</h1>
          {facts === undefined || facts === "" ? null : (
            <span className="text-sm text-muted">{facts}</span>
          )}
        </div>
      </div>
      {action === undefined ? null : (
        <span className={phoneAction ? "shrink-0" : "hidden shrink-0 sm:block"}>{action}</span>
      )}
    </header>
  );
}

/**
 * The side panel every Kit form sits in — the same footer, the same error line.
 *
 * Save first, Cancel beside it, Delete on the far side when editing. The form
 * is two columns from a tablet up and one on a phone, where the panel is a
 * bottom sheet, and it is submitted by the footer button through `form=`, so
 * Enter in any field still saves.
 */
export function KitFormPanel({
  title,
  description,
  submitLabel,
  busy,
  error,
  onSubmit,
  onClose,
  onDelete,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onSubmit: (event: React.FormEvent) => void;
  readonly onClose: () => void;
  readonly onDelete?: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const formId = useId();
  return (
    <Modal
      title={title}
      {...(description === undefined ? {} : { description })}
      placement="side"
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            {submitLabel}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {onDelete === undefined ? null : (
            <Button variant="danger" className="ml-auto" onClick={onDelete}>
              Delete
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        onSubmit={onSubmit}
        className="flex flex-col gap-density sm:grid sm:grid-cols-2"
      >
        {children}
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * A short vertical gauge: on hand against three times the reorder point.
 *
 * Small enough to sit beside a name, and hidden from a screen reader because
 * the muted line beside it says the same thing in numbers.
 */
export function KitGauge({ value, danger }: { readonly value: number; readonly danger: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative flex h-10 w-1.5 shrink-0 overflow-hidden rounded-full bg-raised"
    >
      <span
        className={`absolute inset-x-0 bottom-0 rounded-full ${danger ? "bg-danger" : "bg-calm"}`}
        style={{ height: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </span>
  );
}
