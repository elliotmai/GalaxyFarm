import type { Viewport } from "next";

import { PwaShell } from "@/app/_components/pwa-shell";

/**
 * The browser chrome, matched to the surface (spec §8 v0.9).
 *
 * This surface runs `flying-auto`, so on a device set to dark the page is the
 * night canvas — and the root layout's light chrome would sit above it as a
 * bar of the wrong colour across the top of every screen. Overridden here
 * rather than at the root because `/account` and the public pages stay light
 * whatever the device says.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F1419" },
    { media: "(prefers-color-scheme: light)", color: "#F5F6F8" },
  ],
};

/**
 * sitter surface. Daylight by default, night when the device is set to it
 * (spec §8 v0.9) — a housesitter is doing the same chores at the same hours on
 * their own phone, so they get the same treatment the owner does.
 */
export default function SitterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="sitter" data-theme="flying-auto">
      {children}
      <PwaShell />
    </div>
  );
}
