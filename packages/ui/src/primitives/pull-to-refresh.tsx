"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * Pull down to refresh (spec §8, one-handed in a barn).
 *
 * The gesture people already have for "is this current?". It matters more here
 * than in most apps because every read comes from the device's own store
 * (§4.2) — the screen is always instant and is therefore always, silently,
 * possibly a few minutes stale. Pulling is how somebody asks.
 *
 * Ours rather than the browser's, for two reasons. The browser's reloads the
 * page, which on a local-first app throws away a warm IndexedDB connection to
 * re-render the same data; ours runs a sync, which is the thing actually being
 * asked for. And the browser's is disabled anyway — `overscroll-behavior-y:
 * contain` is what stops a scroll inside a list turning into a page reload.
 *
 * Touch only. A mouse has a scrollbar and a laptop has a refresh key, and a
 * drag-to-refresh on a trackpad fires by accident constantly.
 */

/** How far to pull before it will fire. Below this, it springs back. */
export const PULL_THRESHOLD = 72;

/** Past the threshold the rubber band stiffens rather than stopping dead. */
const RESISTANCE = 2.5;
const MAX_PULL = 120;

export interface PullToRefreshProps {
  readonly onRefresh: () => Promise<unknown>;
  readonly children: ReactNode;
  /** Announced while it runs, and read out by a screen reader. */
  readonly label?: string;
}

export function PullToRefresh({
  onRefresh,
  children,
  label = "Checking for changes",
}: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | undefined>(undefined);

  const begin = useCallback((event: React.TouchEvent) => {
    // Only from the very top. Starting a pull midway down a long list is
    // somebody scrolling up, and hijacking that would make the herd
    // unscrollable.
    if (window.scrollY > 0) return;
    startY.current = event.touches[0]?.clientY;
  }, []);

  const move = useCallback((event: React.TouchEvent) => {
    const origin = startY.current;
    const y = event.touches[0]?.clientY;
    if (origin === undefined || y === undefined) return;

    const travelled = y - origin;
    if (travelled <= 0) {
      // Pulled back up past where it started: abandon rather than sit at
      // zero, so the next downward move is a fresh scroll and not a
      // resumed pull.
      startY.current = undefined;
      setPull(0);
      return;
    }

    // Square-root resistance: the first pixels move nearly one-for-one and
    // it gets progressively heavier, which is what makes the gesture feel
    // attached to something rather than linear and slack.
    setPull(Math.min(MAX_PULL, Math.sqrt(travelled) * RESISTANCE + travelled / RESISTANCE));
  }, []);

  const end = useCallback(async () => {
    const travelled = pull;
    startY.current = undefined;

    if (travelled < PULL_THRESHOLD || busy) {
      setPull(0);
      return;
    }

    // Held open while it runs, so the spinner has somewhere to be and the
    // gesture does not appear to have been ignored.
    setBusy(true);
    setPull(PULL_THRESHOLD);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
      setPull(0);
    }
  }, [pull, busy, onRefresh]);

  const armed = pull >= PULL_THRESHOLD;

  return (
    <div
      onTouchStart={begin}
      onTouchMove={move}
      onTouchEnd={() => void end()}
      onTouchCancel={() => {
        startY.current = undefined;
        setPull(0);
      }}
      // Contained rather than `none`: the page still scrolls normally, it just
      // does not hand an overscroll to the browser's own reload.
      className="[overscroll-behavior-y:contain]"
    >
      <div
        aria-hidden={!busy}
        className="flex items-end justify-center overflow-hidden text-sm text-muted"
        style={{
          height: pull,
          // No transition mid-drag — the height should track the finger. The
          // spring back after release is where the easing belongs.
          transition: startY.current === undefined ? "height 220ms ease-out" : undefined,
        }}
      >
        <span className="flex items-center gap-2 pb-2">
          <span
            aria-hidden
            className={`inline-block h-4 w-4 rounded-full border-2 border-edge border-t-action ${
              busy ? "animate-spin" : ""
            }`}
            style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)` }}
          />
          {busy ? label : armed ? "Release to refresh" : "Pull to refresh"}
        </span>
      </div>

      {/* Announced separately, because the visual text above is decoration
          during the drag and only becomes a status once it fires. */}
      <span role="status" aria-live="polite" className="sr-only">
        {busy ? label : ""}
      </span>

      {children}
    </div>
  );
}
