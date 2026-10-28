"use client";

import { useLayoutEffect } from "react";

import { THEME_FOR, useAppearance } from "@/lib/appearance";

/**
 * Keeps the admin surface's `data-theme` in step with the chosen appearance.
 *
 * The attribute is set on the element directly rather than through a React
 * prop: the server cannot know a device's choice, so a prop would render light
 * and then disagree with what the boot script already painted, which is a
 * hydration mismatch and a flash. The boot script sets it before first paint;
 * this follows any change made afterwards, in Settings or in another tab.
 */
export function ThemeSync() {
  const [appearance] = useAppearance();

  useLayoutEffect(() => {
    document
      .querySelector<HTMLElement>('[data-surface="admin"]')
      ?.setAttribute("data-theme", THEME_FOR[appearance]);
  }, [appearance]);

  return null;
}
