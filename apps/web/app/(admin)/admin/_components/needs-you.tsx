"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

/**
 * The "Needs you" list on the Today screen.
 *
 * Status by exception: a row exists only when something is owed, so an empty
 * list is the good news and says so in one green line rather than a stack of
 * cards each reading "nothing due". A row is a dot, a title, one line of
 * facts and one action — the detail behind it is a tap away, not on screen.
 */

export interface Need {
  readonly key: string;
  /** `urgent` is today or already late; `soon` is this week's work. */
  readonly urgency: "soon" | "urgent";
  readonly title: string;
  /** One line of facts. Not a sentence about why. */
  readonly line: string;
  /** The verb on the desktop button, and the accessible name's last word. */
  readonly action: string;
  /** Where the row goes, for a need dealt with on another screen. */
  readonly href?: string;
  /** What the row opens onto in place, for a need dealt with right here. */
  readonly detail?: ReactNode;
}

// Amber is not in the palette, which keeps colour to three meanings. It is
// here only as a dot beside words that already say "soon", and the dot is
// named for screen readers, so it never carries the meaning on its own.
const DOT = {
  soon: "bg-[#b26b00]",
  urgent: "bg-danger",
} as const;

const SPOKEN = { soon: "Soon", urgent: "Urgent" } as const;

/** The row's face — shared by the link and the disclosure button. */
function Face({ need, open }: { readonly need: Need; readonly open?: boolean }) {
  return (
    <>
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[need.urgency]}`} />
      <span className="sr-only">{SPOKEN[need.urgency]}: </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-density font-semibold text-ink">{need.title}</span>
        <span className="text-sm text-muted">{need.line}</span>
      </span>
      {/*
        One action on a wide screen, a chevron on a phone. Both are the same
        control — the whole row — so there is never a button inside a button.
      */}
      <span
        aria-hidden
        className="hidden h-9 shrink-0 items-center whitespace-nowrap rounded-density border border-action px-3.5 text-sm font-semibold text-action sm:inline-flex"
      >
        {need.action}
      </span>
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        className={`shrink-0 text-muted transition-transform sm:hidden ${open === true ? "rotate-90" : ""}`}
      >
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </>
  );
}

const ROW =
  "flex min-h-[64px] w-full items-center gap-3.5 px-4 py-3 hover:bg-canvas " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action";

function NeedRow({ need }: { readonly need: Need }) {
  const [open, setOpen] = useState(false);
  const panel = useId();

  if (need.detail === undefined) {
    return (
      <li>
        <Link href={need.href ?? "#"} className={ROW}>
          <Face need={need} />
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={`${ROW} cursor-pointer`}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((was) => !was)}
      >
        <Face need={need} open={open} />
      </button>
      {open ? (
        <div id={panel} className="border-t border-rule bg-canvas/60 px-4 py-density">
          {need.detail}
        </div>
      ) : null}
    </li>
  );
}

/** The one green line that stands in for every card with nothing to say. */
export function AllClear({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 rounded-density bg-calm/15 px-4 py-3 text-sm text-calm">
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path
          d="M5 12l5 5 9-10"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{children}</span>
    </p>
  );
}

export function NeedsYou({
  needs,
  allClear,
}: {
  readonly needs: readonly Need[];
  /** What was checked and found fine, already phrased. */
  readonly allClear?: string | undefined;
}) {
  return (
    <section aria-labelledby="today-needs" className="flex min-w-0 flex-col gap-2.5">
      <h2 id="today-needs" className="text-xs font-semibold uppercase tracking-wide text-muted">
        Needs you{needs.length === 0 ? "" : ` · ${needs.length}`}
      </h2>

      {needs.length === 0 ? null : (
        <ul className="divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
          {needs.map((need) => (
            <NeedRow key={need.key} need={need} />
          ))}
        </ul>
      )}

      {allClear === undefined ? null : <AllClear>{allClear}</AllClear>}
    </section>
  );
}
