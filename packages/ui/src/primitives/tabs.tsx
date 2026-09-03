"use client";

import { useCallback, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

/**
 * Tabs (spec §8).
 *
 * Keyboard behaviour follows the WAI-ARIA tabs pattern: one stop in the tab
 * order for the whole strip, arrows to move between tabs, Home and End to
 * jump. Tabs that are each individually tabbable turn an eleven-tab animal
 * profile into eleven presses to reach the panel.
 */

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  /**
   * A count beside the label — open jobs, people, paired screens — or a short
   * marker like `!` for when the number could not be read.
   *
   * **The strip draws the chrome, and that is the point.** Handed straight
   * into the button, as this used to be, a bare number lands in the label's
   * own size and weight with nothing but a gap in front of it, and stops
   * reading as a count at all: "People 5" and "Notifications 2" read as tabs
   * somebody named badly, and get asked about as names. Wrapping it here is
   * what makes that unsayable — there is no way to pass a count and have it
   * come out welded to the name.
   */
  readonly adornment?: ReactNode;
}

export interface TabsProps {
  readonly tabs: readonly TabDefinition[];
  readonly children: (activeId: string) => ReactNode;
  readonly defaultTab?: string;
  /** Lift the state out when the URL owns which tab is open. */
  readonly activeTab?: string;
  readonly onTabChange?: (id: string) => void;
  readonly label: string;
}

export function Tabs({ tabs, children, defaultTab, activeTab, onTabChange, label }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const active = activeTab ?? internal;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = useCallback(
    (id: string) => {
      if (activeTab === undefined) setInternal(id);
      onTabChange?.(id);
    },
    [activeTab, onTabChange],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    if (index === -1) return;

    const move = (to: number) => {
      const next = tabs[(to + tabs.length) % tabs.length];
      if (next === undefined) return;
      event.preventDefault();
      select(next.id);
      // Focus follows selection, which is what the pattern specifies for
      // automatic tabs and what makes arrowing through them feel direct.
      refs.current.get(next.id)?.focus();
    };

    if (event.key === "ArrowRight") move(index + 1);
    else if (event.key === "ArrowLeft") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(tabs.length - 1);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-edge"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                // crud-guard: allow-unconfirmed — a ref map of DOM nodes, nothing persisted
                if (node === null) refs.current.delete(tab.id);
                else refs.current.set(tab.id, node);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              // One stop for the strip: the selected tab is the only one in
              // the tab order, and the arrows do the rest.
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              className={[
                "inline-flex min-h-target items-center gap-2 whitespace-nowrap px-3 text-density",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-action",
                selected
                  ? "border-b-2 border-action font-semibold text-ink"
                  : "border-b-2 border-transparent text-muted hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
              {tab.adornment === undefined ? null : (
                <span
                  className={[
                    "gf-numeric inline-flex min-w-[1.5em] items-center justify-center",
                    "rounded-full border px-1.5 text-xs leading-5",
                    selected ? "border-action text-action" : "border-edge text-muted",
                  ].join(" ")}
                >
                  {tab.adornment}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
        // Focusable so a keyboard user landing here from the strip has
        // somewhere to be, per the pattern's note on panels without controls.
        tabIndex={0}
        className="pt-density"
      >
        {children(active)}
      </div>
    </div>
  );
}
