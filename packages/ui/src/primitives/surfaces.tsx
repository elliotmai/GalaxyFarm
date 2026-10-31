import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";

/**
 * The containers everything else sits in (spec §8).
 *
 * Card, Badge, and DataTable, plus `EmptyState` — which is here rather than
 * left to each screen because "no records" is the state a new install spends
 * its first week in, and a bare blank panel teaches nobody what the screen is
 * for or how to put something in it.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly title?: string;
  /** Buttons, a menu, a count — rendered opposite the title. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function Card({ title, actions, children, className, ...rest }: CardProps) {
  return (
    <section
      className={[
        // `rule`, not `edge`. A card is not a control: its boundary separates
        // one group of content from the next, and holding that to the 3:1 a
        // control needs is what made the old screens read as a grid of
        // outlines. The panel is white on a light grey canvas, so the surface
        // itself now does the separating and the hairline only tidies it.
        "rounded-density border border-rule bg-panel p-density text-ink",
        "shadow-[0_1px_2px_rgba(20,23,27,0.04),0_8px_20px_-14px_rgba(20,23,27,0.16)]",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {title === undefined && actions === undefined ? null : (
        <header className="mb-density flex items-center justify-between gap-3">
          {title === undefined ? <span /> : <h2 className="text-density font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export type BadgeTone = "neutral" | "action" | "calm" | "danger" | "identity";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

// Filled with a tint of the tone rather than outlined. An outline is the
// border a control wears, so a row of outlined badges read as a row of buttons
// nobody could press — and six small outlines in one row is most of what
// "chip soup" meant.
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-raised text-muted",
  action: "bg-action/10 text-action",
  calm: "bg-calm/15 text-calm",
  danger: "bg-danger/10 text-danger",
  identity: "bg-identity/10 text-identity",
};

/**
 * A badge is outlined, not filled.
 *
 * Filled badges in five tones would compete with the safety chips, which are
 * the one place on these screens where a saturated block of colour means
 * something specific. Outline keeps that signal exclusive.
 */
export function Badge({ tone = "neutral", children, className, ...rest }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium",
        TONES[tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  /** Right-aligned and tabular — weights, counts, money. */
  readonly numeric?: boolean;
  /**
   * The column that says which row this is — the animal, the zone, the dam.
   *
   * On a phone it becomes the heading of the row's card. Without one the
   * first column is used, which is right often enough that marking it is
   * only necessary when the identity is not first.
   */
  readonly primary?: boolean;
}

export interface DataTableProps<T> extends Omit<TableHTMLAttributes<HTMLTableElement>, "children"> {
  readonly caption: string;
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** Shown in place of the table body when there is nothing yet. */
  readonly empty?: ReactNode;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  className,
  ...rest
}: DataTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;

  const identity = columns.find((column) => column.primary) ?? columns[0];
  const others = columns.filter((column) => column !== identity);

  return (
    <>
      {/*
        A phone gets one card per row (spec §8, "usable one-handed in a barn").
        A seven-column table on a 375px screen is a table you read by dragging
        sideways, and the moment you drag, the name of the animal the row is
        about scrolls off the left — so every value you are looking at belongs
        to a row you can no longer identify. The card keeps the name at the top
        and puts the rest underneath as labelled pairs.

        Built from the same `columns`, so a screen cannot add a column to one
        layout and forget the other.
      */}
      {/*
        One panel with hairlines between the rows, not a card per row: a stack
        of separate boxes is a page of outlines before it is a list. The pairs
        flow on one or two lines under the name rather than one per line, so a
        row is a name and a sentence of facts — the shape a phone list reads in.
      */}
      <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel sm:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex flex-col gap-1 px-density py-3">
            {identity === undefined ? null : (
              <div className="text-density font-semibold text-ink">{identity.render(row)}</div>
            )}
            <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              {others.map((column) =>
                // An empty header is the actions column. A label of "" above a
                // row of buttons is noise, so it gets the full width instead.
                column.header === "" ? (
                  <dd key={column.key} className="flex w-full flex-wrap gap-2 pt-1">
                    {column.render(row)}
                  </dd>
                ) : (
                  <div key={column.key} className="flex min-w-0 items-baseline gap-1">
                    <dt className="shrink-0 text-muted">{column.header}</dt>
                    <dd
                      className={`min-w-0 break-words text-ink ${
                        column.numeric === true ? "gf-numeric" : ""
                      }`}
                    >
                      {column.render(row)}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          </li>
        ))}
      </ul>

      {/* Wide tables scroll inside their own box. Letting the page scroll
          sideways instead makes every other column on the screen move with it. */}
      <div className="hidden w-full overflow-x-auto sm:block">
        <table
          className={["w-full border-collapse text-density", className ?? ""]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        >
          {/* Named for screen readers; a page of unlabelled tables is a maze. */}
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-muted">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={["py-2.5 pr-3 font-semibold", column.numeric ? "text-right" : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-rule/70 last:border-0 hover:bg-canvas"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={["py-3 pr-3", column.numeric ? "gf-numeric text-right" : ""]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  /** What this screen is for, in a sentence. */
  readonly detail?: string;
  /** The one thing to do next — usually the create button. */
  readonly action?: ReactNode;
}

export function EmptyState({ title, detail, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-density border border-dashed border-rule p-8 text-center">
      <h3 className="text-density font-semibold text-ink">{title}</h3>
      {detail === undefined ? null : <p className="max-w-prose text-sm text-muted">{detail}</p>}
      {action}
    </div>
  );
}
