"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "./button.js";

/**
 * Filters, folded away until they are wanted (spec §8).
 *
 * Six controls above a table are read once, on the day somebody meets the
 * screen, and are in the way every day after — the same argument `Explainer`
 * makes about a paragraph of description, and the same answer: fold it, do not
 * delete it. What is actually wanted on opening the herd is the herd.
 *
 * ## The one thing this must never do
 *
 * Hide a filter that is *on*. A collapsed panel over a narrowed list is a
 * screen that lies: eight of twenty-six animals, no visible reason, and the
 * missing eighteen look like animals that do not exist. Somebody checks
 * whether a cow is on the place, does not find her, and concludes wrongly.
 *
 * So the summary always carries how many filters are set and what they are,
 * and the button to clear them is reachable **without opening the panel** —
 * one press from any state, because the state that needs it most is the one
 * where somebody has not realised yet.
 *
 * ## Why it opens itself
 *
 * A panel that arrives with filters already applied — from a saved view, or a
 * link somebody was sent — starts open, since in that case the filters are the
 * explanation for what is on screen and burying them is the whole failure
 * above.
 */

export interface FilterPanelProps {
  /** The controls. Rendered only when open, so nothing tabbable hides. */
  readonly children: ReactNode;
  /**
   * How many filters are currently set.
   *
   * The caller counts them, because only the caller knows which of its fields
   * are filters and what "unset" means for each — a blank string for one, a
   * false for the next.
   */
  readonly active: number;
  /** "Pen: North · Sex: bull" — what is on, in the words the controls use. */
  readonly summary?: string | undefined;
  /** Shown whatever the state: "Showing 8 of 26." */
  readonly count?: ReactNode;
  readonly onClear?: (() => void) | undefined;
  readonly title?: string;
}

export function FilterPanel({
  children,
  active,
  summary,
  count,
  onClear,
  title = "Filters",
}: FilterPanelProps) {
  // Open if anything is already on, for the reason in the docstring above.
  const [open, setOpen] = useState(active > 0);
  const bodyId = useId();

  return (
    <section className="rounded-density border border-rule bg-panel text-ink">
      <div className="flex flex-wrap items-center justify-between gap-3 p-density">
        <div className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((was) => !was)}
            className="cursor-pointer text-density font-semibold text-action underline-offset-2 hover:underline"
          >
            {/* A caret rather than a word: this genuinely is a panel opening
                and closing, unlike the one extra line `Explainer` reveals. */}
            <span aria-hidden="true">{open ? "▾" : "▸"}</span> {title}
            {active === 0 ? "" : ` (${active})`}
          </button>

          {/* The load-bearing part. Present whether the panel is open or shut,
              so a narrowed list always says why it is narrowed. */}
          {active > 0 && summary !== undefined && summary !== "" ? (
            <span className="text-sm text-muted">{summary}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {count === undefined ? null : <span className="text-sm text-muted">{count}</span>}
          {active > 0 && onClear !== undefined ? (
            <Button variant="ghost" onClick={onClear}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      {/* Unmounted rather than hidden with CSS: a `display:none` subtree keeps
          its focus order in some browsers, and tabbing into a control nobody
          can see is worse than the clutter this was closed to avoid. */}
      {open ? (
        <div id={bodyId} className="border-t border-rule p-density">
          {children}
        </div>
      ) : null}
    </section>
  );
}
