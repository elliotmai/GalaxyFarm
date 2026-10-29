import Link from "next/link";
import type { ReactNode } from "react";

import { KioskWeather } from "@/app/(kiosk)/kiosk/_components/kiosk-weather";

/**
 * The top of every barn board.
 *
 * Its own header rather than `PageHeader`, for two reasons that are both
 * about the distance it is read from. The way back to the boards is a 64px
 * square a gloved thumb can find, not a small eyebrow link — and `PageHeader`
 * hides its eyebrow on a phone, which is exactly where an owner opening a
 * board as themselves would lose the way out. And the one line under the
 * title is a fact ("Wed 28 Oct", "9 pens"), never an instruction: a board
 * that has to explain itself is read once and then skimmed past forever.
 */
export function KioskHeader({
  title,
  fact,
  back = true,
  actions,
}: {
  readonly title: string;
  /** One short fact under the title. Not a sentence. */
  readonly fact?: ReactNode;
  /** Off for the picker itself, which is where back would go. */
  readonly back?: boolean;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-density gap-y-2">
      {back ? <KioskBackLink /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="text-ink">{title}</h1>
        {fact === undefined ? null : <p className="text-density text-muted">{fact}</p>}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
      {/* On every board, always: the time, and what it is doing outside. */}
      <KioskWeather />
    </header>
  );
}

/**
 * The way back to the picker: a 64px square a gloved thumb can find.
 *
 * `prefetch`, because the picker is the one screen every board goes back to
 * and the barn is the place most likely to be out of signal.
 */
export function KioskBackLink() {
  return (
    <Link
      href="/kiosk"
      prefetch
      aria-label="All boards"
      className="inline-flex min-h-target min-w-target shrink-0 items-center justify-center self-start rounded-density border border-rule bg-panel text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          d="M15 6l-6 6 6 6"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

/** "Wed 28 Oct" — the fact under a board's title when the day is the point. */
export function kioskDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** The quiet line a board shows instead of a box when there is nothing to show. */
export function KioskQuiet({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-density border border-rule bg-panel px-5 py-4 text-density text-muted">
      {children}
    </p>
  );
}
