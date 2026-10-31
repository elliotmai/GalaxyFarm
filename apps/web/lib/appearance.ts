"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the device says — for the admin surface only.
 *
 * Light by default: the herd book, the papers and a pedigree printed for a
 * buyer all live in daylight, and that is how the owners said they like it.
 * Dark is there for the barn after dark, and "match device" for anyone who
 * wants the phone to decide.
 *
 * Kept on the device rather than on the person. Two people share this farm,
 * and the phone in the barn and the laptop in the house can sensibly differ;
 * it is a preference about a screen, not a fact about the farm, so it never
 * syncs.
 */

export type Appearance = "light" | "dark" | "device";

export const APPEARANCE_KEY = "gf-appearance";

/** The `data-theme` each choice paints with. */
export const THEME_FOR: Readonly<Record<Appearance, string>> = {
  light: "flying-day",
  dark: "flying-night",
  device: "flying-auto",
};

const CHANGED = "gf-appearance-changed";

export function readAppearance(): Appearance {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_KEY);
    return stored === "dark" || stored === "device" ? stored : "light";
  } catch {
    // Private windows and blocked storage throw; the default is the answer.
    return "light";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  // Another tab changing it should repaint this one too.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useAppearance(): readonly [Appearance, (next: Appearance) => void] {
  const appearance = useSyncExternalStore(subscribe, readAppearance, () => "light" as const);

  const set = useCallback((next: Appearance) => {
    try {
      window.localStorage.setItem(APPEARANCE_KEY, next);
    } catch {
      // Nowhere to keep it; it still applies until the page is reloaded.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  return [appearance, set] as const;
}

/**
 * Run before the first paint, inline in the layout, so a device set to dark
 * does not flash white on every page load while React hydrates.
 */
export const APPEARANCE_BOOT_SCRIPT = `try{var a=localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)});var t=a==="dark"?"flying-night":a==="device"?"flying-auto":"flying-day";var s=document.currentScript&&document.currentScript.parentElement;if(s)s.setAttribute("data-theme",t)}catch(e){}`;
