"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * List rows for the other-animal screens — horses, the flock, eggs, pets.
 *
 * The herd row's anatomy (`cattle/_components/herd-row.tsx`) without the ear
 * tag: the name, one muted line of facts, at most one chip, and the whole row
 * is the target — a link when the record has a page of its own, a button when
 * it opens a panel in place. Facts are passed as parts and joined here, so a
 * missing one drops out instead of leaving a stray "·" behind.
 *
 * Lives under horses only because that screen came first; chickens and pets
 * import it from here rather than keeping three copies that drift.
 */
export function ListRow({
  title,
  line,
  chip,
  href,
  onOpen,
  label,
  lead,
  trailing,
}: {
  readonly title: ReactNode;
  readonly line: readonly (string | undefined | false)[];
  readonly chip?: ReactNode;
  /** Where the row goes. One of `href` or `onOpen`. */
  readonly href?: string;
  /** What the row opens in place. */
  readonly onOpen?: () => void;
  /** The accessible name, when the visible title alone would be ambiguous. */
  readonly label?: string;
  /** A round badge before the name — a count, where the herd row has a tag. */
  readonly lead?: ReactNode;
  /**
   * One more control beside the row, never inside it: a button nested in the
   * row's own target is two targets the browser has to guess between.
   */
  readonly trailing?: ReactNode;
}) {
  const facts = line.filter((part): part is string => typeof part === "string" && part !== "");
  const face = (
    <>
      {lead === undefined ? null : (
        <span className="gf-numeric flex h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-full bg-raised px-2 text-[13px] font-semibold text-action">
          {lead}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate font-semibold text-ink">{title}</span>
        {facts.length === 0 ? null : (
          <span className="truncate text-sm text-muted">{facts.join(" · ")}</span>
        )}
      </span>
      {chip === undefined || chip === null ? null : <span className="shrink-0">{chip}</span>}
      {trailing === undefined ? (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          className="shrink-0 text-muted"
        >
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : null}
    </>
  );
  const className =
    "flex min-h-[64px] w-full min-w-0 flex-1 items-center gap-3 px-4 py-2 text-ink hover:bg-canvas " +
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action";

  return (
    <li className="flex items-center bg-panel">
      {href !== undefined ? (
        <Link href={href} className={className} aria-label={label}>
          {face}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className={`${className} cursor-pointer`}
          aria-label={label}
          aria-haspopup="dialog"
        >
          {face}
        </button>
      )}
      {trailing}
    </li>
  );
}

/** The bordered list the rows sit in. */
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

/**
 * The floating add button on a phone, clear of the tab bar — the herd screen's.
 *
 * A plain button rather than `Button`: its shape and shadow are its own, and
 * overriding a primitive's radius from outside is a fight over class order.
 */
export function PhoneAddButton({
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
      className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
    >
      <span aria-hidden="true" className="text-xl leading-none">
        +
      </span>
      {children}
    </button>
  );
}

/** A row of aria-pressed pill toggles — the herd screen's class chips. */
export function ChipRow<K extends string>({
  label,
  chips,
  value,
  onChange,
}: {
  readonly label: string;
  readonly chips: readonly { key: K; label: string; count?: number | undefined }[];
  readonly value: K;
  readonly onChange: (key: K) => void;
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
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(chip.key)}
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
    </div>
  );
}

/** "Showing 3 of 9 · Passed · Clear" — said whenever a list is narrowed. */
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

/** A round icon button beside a row — the herd row's edit pencil. */
export function RowIconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  /** The icon, already `aria-hidden`. */
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="mr-1 inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
    >
      {children}
    </button>
  );
}

/** The pencil the herd row uses for its edit button. */
export function PencilIcon() {
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
