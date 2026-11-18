/**
 * Sharing a screen with the rest of the household (spec §8).
 *
 * Everybody on the place has the app installed, so the useful share is not a
 * screenshot but a few lines that say what matters — "Bessie · tag 214 ·
 * North Trap · due to calve Mar 3" — and a link that opens the same screen,
 * on the same tab, in their own app. Pages that know what matters say it
 * (`ShareSummary`); every other page shares its heading and the line under it.
 *
 * Pure: the button (`share-button.tsx`) does the browser half.
 */

export interface ShareSummary {
  /** The heading: "Bessie", "Today's chores", "Up next in the garden". */
  readonly title: string;
  /** The few facts that matter, one per line, most important first. */
  readonly lines?: readonly (string | undefined | false | null)[];
}

/** At most this many lines: a share is a glance, not the page. */
export const MAX_SHARE_LINES = 8;

/** The lines worth sending: blanks dropped, trimmed, capped. */
export function shareLines(summary: ShareSummary): string[] {
  return (summary.lines ?? [])
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .slice(0, MAX_SHARE_LINES);
}

/**
 * The message body: the title, the lines, nothing else.
 *
 * The link is passed separately to the share sheet, which puts it where each
 * app expects it; `shareMessage` adds it for the copy fallback, where there
 * is no separate field.
 */
export function shareText(summary: ShareSummary): string {
  return [summary.title.trim(), ...shareLines(summary)].filter(Boolean).join("\n");
}

export function shareMessage(summary: ShareSummary, url: string): string {
  return `${shareText(summary)}\n${url}`;
}

/**
 * The link back to this spot: the page, its query, and the tab each tab strip
 * is on — as repeated `tab` values, which every strip reads on arrival and
 * takes the one that is its own.
 */
export function shareUrl(
  location: { readonly origin: string; readonly pathname: string; readonly search: string },
  activeTabs: readonly string[],
): string {
  const params = new URLSearchParams(location.search);
  // crud-guard: allow-unconfirmed — a query string being rebuilt, nothing persisted
  params.delete("tab");
  for (const tab of activeTabs) if (tab !== "") params.append("tab", tab);
  const query = params.toString();
  return `${location.origin}${location.pathname}${query === "" ? "" : `?${query}`}`;
}

/** The tabs a link asked for, in the order it gave them. */
export function requestedTabs(search: string): string[] {
  return new URLSearchParams(search).getAll("tab");
}
