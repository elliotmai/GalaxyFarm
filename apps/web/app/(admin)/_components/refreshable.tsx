"use client";

import { PullToRefresh } from "@galaxy-farm/ui";

import { useSync } from "@/app/_components/sync-provider";

/**
 * The admin surface's pull-to-refresh (spec §8, §4.2).
 *
 * A thin client wrapper so the layout can stay a server component. What it
 * refreshes is a **sync**, not the page: every read already comes from the
 * device's own store, so reloading would throw away a warm IndexedDB
 * connection to re-render exactly the same rows. Pulling asks the question
 * somebody actually has, which is "is there anything I have not seen".
 *
 * Nothing awaits this to render. If the sync fails the screen is unchanged and
 * still correct, and the sync badge in the nav is where that is reported.
 */
export function Refreshable({ children }: { readonly children: React.ReactNode }) {
  const { syncNow } = useSync();

  return (
    <PullToRefresh onRefresh={syncNow} label="Checking the farm for changes">
      {children}
    </PullToRefresh>
  );
}
