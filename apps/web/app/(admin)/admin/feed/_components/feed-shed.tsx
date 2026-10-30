"use client";

import { useState, type ReactNode } from "react";

import { Button, EmptyState } from "@galaxy-farm/ui";
import type { FeedProjection, FeedType } from "@galaxy-farm/module-feed";

import { formatDate, line, qty, unitLabel } from "./feed-format";

/**
 * What is in the shed, and when it runs out (Farm › Feed › Shed).
 *
 * One row a feed: how much is left, a small gauge, and "Restock" opening the
 * purchase form already on that feed. The row itself counts the feed — a
 * correction, which is where the projection restarts. "Add a feed" sits in
 * the header whatever the shed holds — it used to appear only on an empty
 * shed, so the second feed anybody bought had nowhere to go. The logs behind the
 * numbers (purchases, counts, feed types, cost a head) fold underneath, as
 * `history`, because they are looked at when something does not add up rather
 * than every time somebody restocks.
 */

/** Days of cover a full gauge stands for — a month of hay is a full barn. */
const FULL_DAYS = 30;

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** "today", "Fri" within the week, a date after that. */
function runsOut(date: Date, now: Date): string {
  const days = daysUntil(date, now);
  if (days <= 0) return "runs out today";
  if (days < 7) return `runs out ${date.toLocaleDateString(undefined, { weekday: "short" })}`;
  return `runs out ${formatDate(date)}`;
}

export interface ShedRow {
  readonly feed: FeedType;
  readonly projection: FeedProjection;
}

/**
 * Low enough to say so: the order-by date has come, it is under the reorder
 * point, it runs out within the week, or the records went below zero.
 */
export function isLow({ projection }: ShedRow, now: Date): boolean {
  return (
    projection.onHand < 0 ||
    projection.orderNow ||
    projection.belowThreshold ||
    (projection.runsOutOn !== undefined && daysUntil(projection.runsOutOn, now) <= 7)
  );
}

/** How full the gauge is: days of cover where the plans eat it, else the reorder point. */
function fullness({ feed, projection }: ShedRow, now: Date): number {
  if (projection.onHand <= 0) return 0;
  if (projection.runsOutOn !== undefined) {
    return daysUntil(projection.runsOutOn, now) / FULL_DAYS;
  }
  if (feed.reorderThreshold !== undefined && feed.reorderThreshold > 0) {
    return projection.onHand / (feed.reorderThreshold * 3);
  }
  return 1;
}

export function ShedView({
  rows,
  now,
  loading,
  onRestock,
  onCount,
  onAddFeed,
  history,
}: {
  readonly rows: readonly ShedRow[];
  readonly now: Date;
  readonly loading: boolean;
  readonly onRestock: (feed?: FeedType) => void;
  /** Count one feed, or the whole shed. */
  readonly onCount: (feed?: FeedType) => void;
  /** A new feed type: the first thing an empty shed needs, and always on offer. */
  readonly onAddFeed: () => void;
  readonly history: ReactNode;
}) {
  // The logs mount only once opened. Folded, they were still rendered — every
  // purchase and count, re-rendered on every save — for nobody to see.
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="flex flex-col gap-density">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Bought, less logged, less what the plans ate</p>
        <span className="flex flex-wrap gap-2">
          {/* The empty shed's own call to action says the same thing. */}
          {!loading && rows.length === 0 ? null : (
            <Button aria-haspopup="dialog" onClick={onAddFeed}>
              <span aria-hidden="true">+</span> Add a feed
            </Button>
          )}
          <Button aria-haspopup="dialog" onClick={() => onCount()}>
            Count the shed
          </Button>
          <span className="hidden sm:block">
            <Button variant="primary" aria-haspopup="dialog" onClick={() => onRestock()}>
              <span aria-hidden="true">+</span> Record purchase
            </Button>
          </span>
        </span>
      </div>

      {loading ? (
        <p className="text-muted">Looking…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No feed on file"
          detail="Add the feeds you buy, then record a purchase. The run-out date follows from the plans."
          action={
            <Button variant="primary" aria-haspopup="dialog" onClick={onAddFeed}>
              Add a feed
            </Button>
          }
        />
      ) : (
        <ul
          aria-label="In the shed"
          className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
        >
          {rows.map((row) => {
            const { feed, projection } = row;
            const low = isLow(row, now);
            const fill = Math.round(Math.max(0, Math.min(1, fullness(row, now))) * 100);
            const left = line(
              // Not clamped at zero: below zero means the records disagree
              // with the shed, which is worth seeing.
              `${qty(projection.onHand)} ${unitLabel(feed.unit)}`,
              low && projection.runsOutOn !== undefined && runsOut(projection.runsOutOn, now),
              projection.onHand < 0 && "count it",
              projection.dailyDemand === 0 && "no plan eats it",
            );
            return (
              <li key={feed.id} className="flex items-center gap-1 bg-panel pr-2">
                <button
                  type="button"
                  onClick={() => onCount(feed)}
                  aria-label={`Count ${feed.name}`}
                  className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-1.5 py-2 pl-4 pr-2 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
                >
                  <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
                    <span className="truncate font-semibold text-ink">{feed.name}</span>
                    <span className={`text-sm ${low ? "text-danger" : "text-muted"}`}>{left}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="block h-1.5 w-full overflow-hidden rounded-full bg-raised"
                  >
                    <span
                      className={`block h-full rounded-full ${low ? "bg-danger" : "bg-calm"}`}
                      style={{ width: `${fill}%` }}
                    />
                  </span>
                </button>
                <Button
                  aria-haspopup="dialog"
                  aria-label={`Restock ${feed.name}`}
                  onClick={() => onRestock(feed)}
                >
                  Restock
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {/* The logs behind the numbers, folded: every purchase, count and feed
          type is still here to correct, just not in the way of a restock. */}
      <details
        className="group rounded-density border border-rule bg-panel"
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-target cursor-pointer list-none flex-wrap items-center justify-between gap-x-2 px-4 py-2 text-density font-semibold text-ink">
          History
          <span className="text-sm font-normal text-muted">
            Purchases, counts, feed types, cost
          </span>
        </summary>
        <div className="border-t border-rule p-density">{historyOpen ? history : null}</div>
      </details>
    </div>
  );
}
