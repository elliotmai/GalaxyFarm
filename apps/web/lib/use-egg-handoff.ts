"use client";

import { usePathname, useRouter } from "next/navigation";

import type { ChoreEntry } from "@galaxy-farm/core";

import { eggEntryHref, isEggCollectionChore } from "@/lib/chores";

/**
 * Ticking off the egg round opens Egg Quick-Entry (spec §4.4, §5.4).
 *
 * One rule for every screen a chore is ticked on — the kiosk boards, the home
 * screen, the chores page — so the count is taken while the basket is still in
 * hand, wherever the tick happened. The egg screen hands back to the screen it
 * came from.
 *
 * Call it once the tick has been accepted, with whether the chore was done
 * before: only the way to done counts, so un-ticking a mistaken tick never
 * opens anything, and a refused tick leaves you where you were.
 */
export function useEggHandoff(): (entry: Pick<ChoreEntry, "title">, wasDone: boolean) => void {
  const router = useRouter();
  const pathname = usePathname();

  return (entry, wasDone) => {
    if (wasDone || !isEggCollectionChore(entry)) return;
    router.push(eggEntryHref(pathname ?? undefined));
  };
}
