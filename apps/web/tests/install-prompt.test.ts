import { describe, expect, it } from "vitest";

import {
  DISMISSAL_HOLDS_MS,
  INSTALL_DISMISSED_KEY,
  installOfferIsDue,
  isRunningInstalled,
  readDismissal,
  recordDismissal,
  type DismissalStore,
} from "../lib/install-prompt.js";

/**
 * Asking to be installed, without becoming the thing people close (spec §3).
 *
 * Everything here is about the second half of that. The prompt itself is three
 * lines of browser API; the part that needs to be right is when it is allowed
 * to appear, and what happens when the place it remembers the answer refuses to
 * play along — which on a locked-down kiosk profile or in private browsing is
 * not hypothetical.
 */

function storeHolding(value: string | null): DismissalStore & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    getItem: () => value,
    setItem: (_key, next) => {
      written.push(next);
    },
  };
}

/** A storage that throws rather than answering — Safari, with cookies blocked. */
const hostileStore: DismissalStore = {
  getItem: () => {
    throw new Error("access denied");
  },
  setItem: () => {
    throw new Error("access denied");
  },
};

describe("readDismissal", () => {
  it("reads back a timestamp that was written", () => {
    const at = new Date("2026-03-01T09:00:00Z");
    expect(readDismissal(storeHolding(String(at.getTime())))).toEqual(at);
  });

  it("treats nothing stored as never having been asked", () => {
    expect(readDismissal(storeHolding(null))).toBeUndefined();
  });

  it.each([
    ["a value that is not a number", "soon"],
    ["an empty string", ""],
    ["a nonsense date", "0"],
    ["a negative timestamp", "-1"],
  ])("treats %s as never having been asked", (_label, stored) => {
    // Erring towards one prompt too many. The other way round, a single stray
    // value means the app can never be installed and nothing says why.
    expect(readDismissal(storeHolding(stored))).toBeUndefined();
  });

  it("survives a storage that refuses to be read", () => {
    expect(readDismissal(hostileStore)).toBeUndefined();
  });

  it("survives having no storage at all", () => {
    expect(readDismissal(undefined)).toBeUndefined();
  });
});

describe("recordDismissal", () => {
  it("writes the moment of the dismissal", () => {
    const store = storeHolding(null);
    recordDismissal(store, new Date("2026-03-01T09:00:00Z"));
    expect(store.written).toEqual([String(new Date("2026-03-01T09:00:00Z").getTime())]);
  });

  it("does not fail a page over a storage that will not take it", () => {
    expect(() => recordDismissal(hostileStore, new Date())).not.toThrow();
    expect(() => recordDismissal(undefined, new Date())).not.toThrow();
  });

  it("uses a key nobody else would pick", () => {
    // `localStorage` is one drawer shared with everything else on the origin.
    expect(INSTALL_DISMISSED_KEY).toMatch(/^gf\./);
  });
});

describe("installOfferIsDue", () => {
  const now = new Date("2026-04-01T12:00:00Z");

  it("offers to somebody who has never said no", () => {
    expect(installOfferIsDue(undefined, now)).toBe(true);
  });

  it("holds its tongue for a month after a no", () => {
    expect(installOfferIsDue(new Date(now.getTime() - 1_000), now)).toBe(false);
    expect(installOfferIsDue(new Date(now.getTime() - DISMISSAL_HOLDS_MS + 1), now)).toBe(false);
  });

  it("asks again once the month is up", () => {
    // The answer changes: an app you declined in March is one you have been
    // using daily by April.
    expect(installOfferIsDue(new Date(now.getTime() - DISMISSAL_HOLDS_MS), now)).toBe(true);
  });

  it("does not hold a dismissal dated in the future against anybody", () => {
    // A device whose clock was wrong when it was written. Left alone, that
    // would silence the prompt until the fake date came round.
    expect(installOfferIsDue(new Date(now.getTime() + DISMISSAL_HOLDS_MS), now)).toBe(false);
  });
});

describe("isRunningInstalled", () => {
  /**
   * The two properties this reads, and nothing else.
   *
   * Cast once, here, rather than at four call sites: a `Window` has some
   * hundreds of members and the alternative — a structural parameter type — is
   * one whose properties are all optional, which TypeScript then refuses to
   * accept a real `Window` for.
   */
  function windowWith(parts: { standalone?: boolean; displayMode?: boolean }): Window {
    return {
      matchMedia: () => ({ matches: parts.displayMode === true }),
      navigator: { standalone: parts.standalone },
    } as unknown as Window;
  }

  it("recognises a standalone display mode", () => {
    expect(isRunningInstalled(windowWith({ displayMode: true }))).toBe(true);
  });

  it("recognises an iOS home-screen launch", () => {
    // Where `beforeinstallprompt` never fires and `display-mode` is not
    // reported, this flag is the whole signal.
    expect(isRunningInstalled(windowWith({ standalone: true }))).toBe(true);
  });

  it("says no for an ordinary browser tab", () => {
    expect(isRunningInstalled(windowWith({}))).toBe(false);
  });

  it("says no when there is no window to ask", () => {
    expect(isRunningInstalled(undefined)).toBe(false);
  });
});
