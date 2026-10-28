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
 * Whether a piece of text is a fact or an explanation (spec §8 v0.9).
 *
 * `subtitle` and `description` were documented as one line and handed
 * paragraphs: a hundred and ninety-nine of them, median 116 characters. The
 * first fix folded everything after the first sentence behind "More", which
 * still left a grey sentence above every heading on every screen.
 *
 * So a header now carries facts only — "42 head", "Deleted records" — and an
 * explanation goes behind a `?` beside the title. Short single-sentence text is
 * a fact and stays on screen; anything longer, or with a second sentence, is
 * an explanation. Something that is not a string (a count, a chip) is always a
 * fact, because a screen built it from data.
 *
 * Nothing is deleted. The arithmetic behind an on-hand count is genuinely
 * non-obvious, and a farm app that hides why a number moved is worse than a
 * wordy one — it is just read once, not every day.
 */
const SECOND_SENTENCE = /[.?!]\s+\S/;
const FACT_LENGTH = 70;

export function isExplanation(text: ReactNode): text is string {
  return typeof text === "string" && (text.length > FACT_LENGTH || SECOND_SENTENCE.test(text));
}

/**
 * The `?` beside a title, and the explanation it opens.
 *
 * A `<details>` rather than a popover with state: it opens and closes without
 * any script, and the summary is a real button to a keyboard and a screen
 * reader.
 */
export function HelpToggle({
  about,
  children,
}: {
  /** Names what is being explained, for the button's accessible name. */
  readonly about: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="gf-help group relative inline-block align-middle">
      <summary
        aria-label={`About ${about}`}
        className={[
          "gf-summary flex h-7 w-7 cursor-pointer list-none items-center justify-center",
          "rounded-full border border-rule bg-panel text-sm font-semibold text-muted",
          "hover:text-ink group-open:border-action group-open:text-action",
          "[&::-webkit-details-marker]:hidden",
        ].join(" ")}
      >
        ?
      </summary>
      <div
        className={[
          // Not drawn at all while closed: a closed `<details>` still lays its
          // content out in Chromium, and a 22rem box beside a ? near the edge
          // of a phone widened the page. Open, it is pinned inside the
          // viewport on a phone and hangs off the ? on anything wider.
          "fixed inset-x-4 top-24 z-30 hidden group-open:block rounded-density",
          "md:absolute md:inset-x-auto md:left-0 md:top-9 md:w-[22rem]",
          "border border-rule bg-panel p-density text-sm font-normal leading-relaxed text-ink",
          "shadow-[0_12px_32px_-12px_rgba(20,23,27,0.35)]",
        ].join(" ")}
      >
        {children}
      </div>
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
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {/* Not on a phone, where the tab strips right above already say
              "Cattle" — the same word twice in a 390px column is a row lost. */}
          {eyebrow === undefined ? null : (
            <p className="hidden text-xs font-medium text-muted md:block">{eyebrow}</p>
          )}
          <div className="flex items-center gap-2">
            <h1 className="text-ink">{title}</h1>
            {isExplanation(subtitle) ? <HelpToggle about={title}>{subtitle}</HelpToggle> : null}
          </div>
          {subtitle === undefined || isExplanation(subtitle) ? null : (
            <div className="max-w-prose text-sm text-muted">{subtitle}</div>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
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
          <div className="flex items-center gap-2">
            <h2 className="text-ink">{title}</h2>
            {isExplanation(description) ? (
              <HelpToggle about={title}>{description}</HelpToggle>
            ) : null}
          </div>
          {description === undefined || isExplanation(description) ? null : (
            <div className="max-w-prose text-sm text-muted">{description}</div>
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
 * A responsive rank of numbers. One swipeable row on a phone, four up on a
 * laptop.
 *
 * Two up on a phone was five tiles in three rows — a screenful of numbers
 * before the first record, most of them zero on a quiet day. As a single row
 * that scrolls sideways it costs one row whatever the count, and the list the
 * screen is actually for starts above the fold.
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
  return <div className="gf-stat-row">{children}</div>;
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
