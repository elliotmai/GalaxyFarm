"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import { useToast } from "@galaxy-farm/ui";

import { shareMessage, shareText, shareUrl, type ShareSummary } from "@/lib/share";

/**
 * The share button, on every screen (spec §8).
 *
 * One button in the app's own bar rather than one per page: there are five
 * kinds of page header, and a share that is on some screens and not others is
 * one nobody learns. The page says what matters with `useShareSummary`; a page
 * that says nothing shares its heading and the line under it, which is always
 * something.
 *
 * The phone's share sheet when there is one — the installed app on Android
 * and iOS has it — so it goes to Messages, WhatsApp or wherever the household
 * talks. Elsewhere the same words and link are copied, and a toast says so.
 */

interface ShareRegistry {
  readonly set: (summary: ShareSummary | undefined) => void;
  readonly current: () => ShareSummary | undefined;
}

const ShareContext = createContext<ShareRegistry | undefined>(undefined);

export function ShareProvider({ children }: { readonly children: ReactNode }) {
  const summary = useRef<ShareSummary | undefined>(undefined);
  const registry = useMemo<ShareRegistry>(
    () => ({
      set: (next) => {
        summary.current = next;
      },
      current: () => summary.current,
    }),
    [],
  );
  return <ShareContext.Provider value={registry}>{children}</ShareContext.Provider>;
}

/**
 * What this page shares. Pass `undefined` while the page is still loading;
 * the heading stands in until it says.
 */
export function useShareSummary(summary: ShareSummary | undefined): void {
  const registry = useContext(ShareContext);
  // Keyed on the words, so a summary rebuilt every render does not churn.
  const key = summary === undefined ? "" : JSON.stringify(summary);
  useEffect(() => {
    if (registry === undefined) return;
    registry.set(summary);
    return () => registry.set(undefined);
    // Keyed on `key`, the words: `summary` is a new object every render.
  }, [registry, key]);
}

/** The page's own heading and the line under it, for a page that said nothing. */
function fromPage(): ShareSummary {
  const main = document.querySelector("main") ?? document.body;
  const heading = main.querySelector("h1")?.textContent?.trim();
  const detail = main.querySelector("[data-share-detail]")?.textContent?.trim();
  return {
    title: heading !== undefined && heading !== "" ? heading : document.title,
    lines: [detail],
  };
}

function openTabs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]')]
    .map((tab) => tab.dataset["tabId"] ?? "")
    .filter((id) => id !== "");
}

function ShareIcon() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

export function ShareButton({ variant }: { readonly variant: "bar" | "rail" }) {
  const registry = useContext(ShareContext);
  const { show } = useToast();
  // Re-read on every press, but named here so a navigation re-renders it.
  usePathname();

  const share = useCallback(async () => {
    const summary = registry?.current() ?? fromPage();
    const url = shareUrl(window.location, openTabs());
    const text = shareText(summary);

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: summary.title, text, url });
        return;
      } catch (error) {
        // Closing the sheet is not a failure, and needs no message.
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.warn("Share sheet unavailable", error);
      }
    }

    try {
      await navigator.clipboard.writeText(shareMessage(summary, url));
      show({ message: "Copied — paste it to whoever needs it", tone: "success" });
    } catch (error) {
      console.warn("Clipboard unavailable", error);
      show({ message: "Could not share from this browser", tone: "danger" });
    }
  }, [registry, show]);

  if (variant === "bar") {
    return (
      <button
        type="button"
        onClick={() => void share()}
        aria-label="Share this screen"
        className="flex min-h-target min-w-target items-center justify-center rounded-full border border-rule bg-panel text-ink"
      >
        <ShareIcon />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="flex h-10 items-center gap-2 rounded-density border border-rule bg-canvas px-3 text-sm text-muted hover:text-ink"
    >
      <ShareIcon />
      <span className="flex-1 text-left">Share this screen</span>
    </button>
  );
}
