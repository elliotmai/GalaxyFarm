import type { ReactNode } from "react";

import { Pill, type Tone } from "@galaxy-farm/ui";

/**
 * The pieces the three panes are built from.
 *
 * A pane is one step of the decision — cow, sire, result — and a pick row is
 * the same anatomy as a herd row: a bold name, one muted line, at most one
 * chip. The rows are buttons rather than links because picking one changes the
 * pane beside it, not the page.
 */

export function Pane({
  label,
  title,
  line,
  children,
}: {
  /** What a screen reader announces for the pane: "Cows to breed". */
  readonly label: string;
  readonly title: string;
  readonly line: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      // Three across on a desk, one under another on a phone: each pane wants
      // at least 18rem, so they wrap rather than squeeze.
      className="flex min-w-0 flex-1 basis-[18rem] flex-col overflow-hidden rounded-density border border-rule bg-panel"
    >
      <header className="flex flex-col gap-0.5 border-b border-rule px-4 py-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <span className="text-sm text-muted">{line}</span>
      </header>
      {children}
    </section>
  );
}

export function PickRow({
  title,
  line,
  chip,
  selected,
  onPick,
}: {
  readonly title: string;
  readonly line: string;
  readonly chip?: { readonly label: string; readonly tone: Tone } | undefined;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  return (
    <li className="border-t border-rule first:border-t-0">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onPick}
        className={
          "flex min-h-[58px] w-full items-center gap-3 py-2 pl-4 pr-4 text-left text-ink " +
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action " +
          (selected ? "bg-raised shadow-[inset_4px_0_0_var(--gf-action)]" : "hover:bg-canvas")
        }
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-semibold">{title}</span>
          {line === "" ? null : <span className="truncate text-sm text-muted">{line}</span>}
        </span>
        {chip === undefined ? null : (
          <span className="shrink-0">
            <Pill tone={chip.tone}>{chip.label}</Pill>
          </span>
        )}
      </button>
    </li>
  );
}

/** A pane's list, scrolling inside itself on a desk so the panes stay level. */
export const PICK_LIST = "flex flex-col lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto";

/** The chip-shaped toggle, as on the catalog. */
export const CHIP =
  "inline-flex min-h-target items-center rounded-full border px-4 text-sm font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

export const chipState = (on: boolean): string =>
  on ? "border-action bg-action text-action-ink" : "border-edge bg-panel text-ink hover:bg-canvas";
