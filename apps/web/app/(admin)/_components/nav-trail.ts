import {
  LOG_HREF,
  NAV,
  SUB_SECTIONS,
  UTILITY,
  destinationFor,
  sectionFor,
} from "@/app/(admin)/_components/nav-groups";

/**
 * The way back (spec §8): wherever you went, there is a Back to where you were
 * — unless you got there by changing tab.
 *
 * A tab change is a fresh start, the way it is in every phone app: tapping
 * Animals from deep inside Farm › Feed › a ration does not leave a trail back
 * into the ration, because the tab bar is already the way to Farm. Everything
 * else — a row opened from a list, a link from Today, a page from More, a
 * search result — is a step forward, and gets a step back.
 *
 * Moving along a section strip is a step *sideways* (Herd to Health, Cattle to
 * Horses): it replaces where you are rather than adding to the trail, because
 * the strip itself is how you go back sideways, and a Back that walks back
 * through six tabs you flicked across is a Back nobody can use.
 *
 * Pure, so the rules are pinned by a test rather than by clicking around.
 */

export interface TrailStep {
  /** The path, query included, exactly as it was visited. */
  readonly href: string;
  /** What the page called itself — its heading — for the Back label. */
  readonly title: string | undefined;
}

export type Move = "forward" | "tab" | "sideways";

/** Long enough for any real wander; short enough that sessionStorage never minds. */
const LONGEST = 30;

function pathOf(href: string): string {
  return href.split("?")[0] ?? href;
}

/**
 * The trail after arriving at `href`.
 *
 * Arriving where the step before the current one was is going back — by the
 * Back link or by the browser's — and pops. Arriving at the same page with a
 * new query (a filter, a tab inside the page) keeps your place.
 */
export function arrive(trail: readonly TrailStep[], href: string, move: Move): TrailStep[] {
  const here = trail.at(-1);
  if (move === "tab" || here === undefined) return [{ href, title: undefined }];
  if (trail.at(-2)?.href === href) return trail.slice(0, -1);
  if (here.href === href) return [...trail];
  if (move === "sideways" || pathOf(here.href) === pathOf(href)) {
    return [...trail.slice(0, -1), { href, title: undefined }];
  }
  return [...trail, { href, title: undefined }].slice(-LONGEST);
}

/**
 * Give a page its name once its heading has rendered.
 *
 * Only the step it was read for: a heading watcher can fire just after the
 * next page has drawn and before the trail has moved on to it, and naming the
 * step underneath with the new page's heading would make Back read as the
 * page you are already on.
 */
export function named(trail: readonly TrailStep[], href: string, title: string): TrailStep[] {
  const here = trail.at(-1);
  if (here === undefined || here.href !== href || here.title === title) return [...trail];
  return [...trail.slice(0, -1), { ...here, title }];
}

/** Where a page lives when there is no trail behind it — a link opened cold. */
export interface Parent {
  readonly href: string;
  readonly label: string;
}

/**
 * The page this one sits under, for a Back on a page opened from a link.
 *
 * A tab's own landing and a section in a strip have none: the tab bar and the
 * strip already say where they are. A record — a cow, a machine — sits under
 * its section's list. A page listed on More sits under More.
 */
export function parentOf(pathname: string): Parent | undefined {
  if (pathname === LOG_HREF || pathname.startsWith(`${LOG_HREF}/`)) return undefined;
  if (NAV.some((destination) => destination.href === pathname)) return undefined;

  const section = sectionFor(pathname);
  if (section !== undefined) {
    const subs = SUB_SECTIONS[section.href] ?? [];
    const destination = destinationFor(pathname);
    const isListed =
      pathname === section.href ||
      subs.some((sub) => sub.href === pathname) ||
      (destination?.sections ?? []).some((candidate) => candidate.href === pathname);
    if (isListed) return undefined;
    return { href: section.href, label: section.label };
  }

  const more = NAV.find((destination) => destination.href === "/admin/more");
  if (more !== undefined && UTILITY.some((item) => pathname === item.href)) {
    return { href: more.href, label: more.label };
  }
  return undefined;
}

/** The label after the chevron: the page's own heading, short. */
export function backLabel(title: string | undefined, fallback: string): string {
  const text = title?.trim() ?? "";
  if (text === "") return fallback;
  return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}
