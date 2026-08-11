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
      className={["rounded-density border border-edge bg-panel p-density text-ink", className ?? ""]
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

const TONES: Record<BadgeTone, string> = {
  neutral: "border-edge text-muted",
  action: "border-action text-action",
  calm: "border-calm text-calm",
  danger: "border-danger text-danger",
  identity: "border-identity text-identity",
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
        "inline-flex items-center rounded-full border px-2 py-0.5 text-sm",
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

  return (
    // Wide tables scroll inside their own box. Letting the page scroll
    // sideways instead makes every other column on the screen move with it.
    <div className="w-full overflow-x-auto">
      <table
        className={["w-full border-collapse text-density", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {/* Named for screen readers; a page of unlabelled tables is a maze. */}
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-edge text-left text-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={["py-2 pr-3 font-medium", column.numeric ? "text-right" : ""]
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
            <tr key={rowKey(row)} className="border-b border-edge/40 last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={["py-2 pr-3", column.numeric ? "gf-numeric text-right" : ""]
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
    <div className="flex flex-col items-center gap-3 rounded-density border border-dashed border-edge p-8 text-center">
      <h3 className="text-density font-semibold text-ink">{title}</h3>
      {detail === undefined ? null : <p className="max-w-prose text-sm text-muted">{detail}</p>}
      {action}
    </div>
  );
}
