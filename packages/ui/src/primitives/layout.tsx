import type { HTMLAttributes, ReactNode } from "react";

/**
 * Structure, as opposed to containers (spec §8).
 *
 * `Card` gives a screen a box. What was missing is everything that divides the
 * *inside* of one: a page needs a head, a head needs a rank of facts under it,
 * and a long form needs to be readable as three or four named parts rather
 * than as forty controls in a rectangle.
 *
 * §8 asks for "generous whitespace; no template feel". Whitespace alone does
 * not do that — a plain box with more padding is a plainer box. What reads as
 * designed is hierarchy: sizes and weights that differ enough to be scanned,
 * rules that separate groups rather than outline them, and numbers set in
 * tabular figures so a column of weights lines up.
 */

/**
 * The first sentence, and everything after it.
 *
 * Deliberately conservative: it needs a terminator followed by whitespace and
 * a non-space, so a decimal, a version or a §-reference is never a break. The
 * whole corpus was checked for the case that would defeat it — an abbreviation
 * ending in a full stop, "Dr.", "a.m.", "e.g." — and there is not one. If one
 * is written later it splits a sentence in half, which is visible the moment
 * the screen is opened rather than silent.
 */
const SENTENCE = /^(.+?[.?!])\s+(\S[\s\S]*)$/;

/**
 * The explanation, folded (spec §8 v0.9).
 *
 * `subtitle` is documented below as "one line under the title", and `Section`
 * says much the same. What they were actually passed is a paragraph: a hundred
 * and ninety-nine of them, median 116 characters, up to 283 — so the Supplies
 * screen opened with three lines about how a running total is computed before
 * a single supply appeared. Two grey lines above every heading on every screen
 * is most of what "cluttered" meant.
 *
 * None of it is deleted, because none of it is padding. The arithmetic behind
 * an on-hand count is genuinely non-obvious, and a farm app that hides why a
 * number moved is worse than a wordy one. But it is read once, on the day
 * somebody meets the screen, and it competes with the records every day after.
 *
 * So the first sentence stays — it names the thing, which is what the prop
 * promised — and the rest goes behind a disclosure. On paper the whole text
 * prints, since a folded explanation is no use to somebody holding a sheet.
 *
 * A description with only one sentence is already within its contract and is
 * left exactly as it was, toggle and all.
 */
function Explainer({ children, className }: { readonly children: ReactNode; className: string }) {
  const split = typeof children === "string" ? SENTENCE.exec(children) : null;
  if (split === null) return <p className={className}>{children}</p>;

  return (
    <details className={className}>
      <summary
        // The native marker is dropped for a word. A triangle beside a
        // sentence reads as a tree node — as though the section itself
        // collapsed — and this only ever opens one more line of prose.
        className="gf-summary cursor-pointer list-none [&::-webkit-details-marker]:hidden"
      >
        {split[1]}{" "}
        <span className="whitespace-nowrap text-action underline decoration-dotted underline-offset-2">
          More
        </span>
      </summary>
      <p className="mt-1">{split[2]}</p>
    </details>
  );
}

export interface PageHeaderProps {
  readonly title: string;
  /** One line under the title — a count, a status, where this sits. */
  readonly subtitle?: ReactNode;
  /** Rendered above the title, small: "Cattle · Herd". */
  readonly eyebrow?: ReactNode;
  /** Buttons, opposite the title. */
  readonly actions?: ReactNode;
  /** Badges and chips, under the subtitle. */
  readonly meta?: ReactNode;
}

/**
 * The top of a screen.
 *
 * One component rather than an `h1` per page, so the vertical rhythm is the
 * same everywhere. The eyebrow carries the trail — a detail page reached from
 * a list should say where it came from without a full breadcrumb bar eating a
 * row of a phone screen.
 */
export function PageHeader({ title, subtitle, eyebrow, actions, meta }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-rule pb-density">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow === undefined ? null : (
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">{eyebrow}</p>
          )}
          <h1 className="text-ink">{title}</h1>
          {subtitle === undefined ? null : (
            <Explainer className="max-w-prose text-sm text-muted">{subtitle}</Explainer>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {meta === undefined ? null : <div className="flex flex-wrap items-center gap-2">{meta}</div>}
    </header>
  );
}

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A named part of a screen.
 *
 * Deliberately not a Card. Nesting boxes inside boxes is what makes an
 * interface look boxy, and a heading with a hairline above it separates two
 * groups just as clearly while leaving the page one surface deep.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  ...rest
}: SectionProps) {
  return (
    <section
      className={["flex flex-col gap-density", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-ink">{title}</h2>
          {description === undefined ? null : (
            <Explainer className="max-w-prose text-sm text-muted">{description}</Explainer>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface DetailItem {
  readonly label: string;
  readonly value: ReactNode;
  /** Spans the full width — for notes and instructions. */
  readonly wide?: boolean;
}

export interface DetailListProps {
  readonly items: readonly DetailItem[];
  /** Columns at desktop width. Two reads best for facts, one for prose. */
  readonly columns?: 1 | 2 | 3;
}

/**
 * Label-and-value pairs, which is most of what a detail page is.
 *
 * A `dl`, not a table: these are attributes of one record rather than rows of
 * many, and a screen reader announces the pairing correctly. An empty value
 * renders an em dash rather than a blank, because a blank cell is ambiguous
 * between "nothing here" and "the page failed to load it".
 */
export function DetailList({ items, columns = 2 }: DetailListProps) {
  const grid =
    columns === 1
      ? "sm:grid-cols-1"
      : columns === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2";

  return (
    <dl className={`grid grid-cols-1 gap-x-density gap-y-4 ${grid}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex flex-col gap-1 ${item.wide === true ? "sm:col-span-full" : ""}`}
        >
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="text-density text-ink [font-variant-numeric:tabular-nums]">
            {item.value === undefined || item.value === null || item.value === "" ? (
              <span className="text-muted">—</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A responsive rank of numbers. Two up on a phone, four on a laptop.
 *
 * Distinct from `CardGrid`, which goes one up on a phone: two small numbers
 * side by side are readable on a 375px screen and two record cards are not.
 * What goes inside is `Tile`.
 *
 * There used to be a `Stat` to put in it, which was `Tile` with the tone edge
 * and the badge slot removed and every other line the same — same wrapper,
 * same label, same figure, same hint. Two components that differ by three
 * pixels are not two components; they are one component and a screen that
 * looks subtly unlike its neighbour for no reason anybody can name.
 */
export function StatRow({ children }: { readonly children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/**
 * A hairline with a word on it.
 *
 * For splitting a long form without giving each part a border of its own.
 */
export function Divider({ label }: { readonly label?: string }) {
  if (label === undefined) return <hr className="border-rule" />;

  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}

/**
 * The page's own column.
 *
 * Caps the measure so a definition list on a wide monitor does not run to
 * eighteen hundred pixels, which is the other half of why a screen reads as
 * unstyled.
 */
export function PageBody({ children }: { readonly children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-density">{children}</div>;
}
