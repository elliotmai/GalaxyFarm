"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  arrive,
  backLabel,
  named,
  parentOf,
  readdressed,
  type Move,
  type TrailStep,
} from "@/app/(admin)/_components/nav-trail";
import { LOG_HREF } from "@/app/(admin)/_components/nav-groups";

/**
 * "‹ Andromeda" — the step back, above every page that has one (see
 * `nav-trail.ts` for which do).
 *
 * In the layout rather than in each screen, so no page can forget it and every
 * page puts it in the same place. The trail lives in sessionStorage: it
 * survives a reload, and it is per tab, so two windows open on the farm keep
 * their own way back.
 */

const KEY = "gf-trail";

/**
 * How the next arrival happened, set by whatever was tapped.
 *
 * Module state rather than context: it is written by a click and read by the
 * very next navigation, and nothing renders from it.
 */
let pending: Move | undefined;

/**
 * The tab bar and the rail call this with "tab", a section strip with
 * "sideways", and anything that returns somewhere — the Back link, the Log's
 * Close — with "back". Unmarked arrivals are steps forward.
 */
export function markMove(move: Move): void {
  pending = move;
}

/**
 * A page changed its own address without leaving — a filter applied — and the
 * trail should remember it, so coming Back lands on the list as it was left.
 */
export function noteAddress(href: string): void {
  write(readdressed(read(), href));
}

function read(): TrailStep[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrailStep[]) : [];
  } catch {
    // Private windows and blocked storage: no trail, only the parent fallback.
    return [];
  }
}

function write(trail: readonly TrailStep[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(trail));
  } catch {
    // As above — the Back still works within this page's lifetime.
  }
}

/** The page's own name: its first heading inside the content column. */
function headingNow(): string | undefined {
  return document.querySelector("main h1")?.textContent?.trim() || undefined;
}

export function BackLink() {
  const pathname = usePathname();
  const [trail, setTrail] = useState<readonly TrailStep[]>([]);

  // The browser's own back (and forward — indistinguishable here, and rare on
  // a phone) walks the trail rather than adding to it.
  useEffect(() => {
    const onPop = () => {
      pending = "back";
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const move = pending ?? "forward";
    pending = undefined;
    const href = `${pathname}${window.location.search}`;
    const next = arrive(read(), href, move);
    write(next);
    setTrail(next);

    // The heading renders when the page's records arrive, which can be a beat
    // after the route does — so it is watched for rather than read once.
    const main = document.querySelector("main");
    if (main === null) return;
    const name = () => {
      // The URL moves with the commit that draws the next page, before this
      // effect is torn down — so a heading seen after it is not this page's.
      if (`${window.location.pathname}${window.location.search}` !== href) return;
      const title = headingNow();
      if (title === undefined) return;
      const renamed = named(read(), href, title);
      write(renamed);
      setTrail(renamed);
    };
    name();
    const watcher = new MutationObserver(name);
    watcher.observe(main, { childList: true, subtree: true, characterData: true });
    return () => watcher.disconnect();
  }, [pathname]);

  // The Log is a full-screen task with its own Close.
  if (pathname === LOG_HREF) return null;

  const previous = trail.length >= 2 ? trail.at(-2) : undefined;
  if (previous !== undefined) {
    return (
      <Back
        href={previous.href}
        label={backLabel(previous.title, "Back")}
        onClick={() => markMove("back")}
      />
    );
  }

  // Opened cold — a link from a message, a bookmark, a reload with no trail.
  // The page it sits under, as a fresh start rather than a step: going "back"
  // to somewhere you never were should not then offer a Back to here.
  const parent = parentOf(pathname);
  if (parent === undefined) return null;
  return <Back href={parent.href} label={parent.label} onClick={() => markMove("tab")} />;
}

function Back({
  href,
  label,
  onClick,
}: {
  readonly href: string;
  readonly label: string;
  readonly onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      {...(onClick === undefined ? {} : { onClick })}
      className="-ml-1 mb-1 inline-flex min-h-target max-w-full items-center gap-1 self-start rounded-density px-1 text-sm font-medium text-action hover:underline focus-visible:outline-2 focus-visible:outline-action"
    >
      <span aria-hidden="true" className="text-lg leading-none">
        ‹
      </span>
      <span className="truncate">{label}</span>
      <span className="sr-only"> — back</span>
    </Link>
  );
}
