"use client";

import { PageBody, PageHeader } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

import { ChoreBoard } from "@/app/(kiosk)/kiosk/_components/chore-board";
import { useTodayChores } from "@/app/(kiosk)/kiosk/_components/use-today-chores";
import { useSyncEngine } from "@/app/_components/sync-provider";

/**
 * Today's Chores (spec §4.4, §5.1) — the same day sheet the admin app and
 * `/sitter` derive, run against what this device has already pulled.
 *
 * Laid out by `ChoreBoard`: the parts of the day side by side, one row per
 * chore, finished work folded away so what is left is what is on screen.
 */
export function ChoresBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store } = useSyncEngine();
  const { entries, animals, zones, today, loading } = useTodayChores(propertyId);

  return (
    <PageBody>
      <PageHeader
        title="Today's Chores"
        subtitle={today.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />

      {loading || store === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <ChoreBoard entries={entries} animals={animals} zones={zones} day={today} />
      )}
    </PageBody>
  );
}
