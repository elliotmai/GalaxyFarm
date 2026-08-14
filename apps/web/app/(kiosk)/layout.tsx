import type { Viewport } from "next";

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
 * kiosk surface. Daylight by default, night when the screen is set to it
 * (spec §8 v0.9) — this is the surface `flying-night` was drawn for. A barn
 * screen at four in the morning during calving is the one place in this app
 * where a white page is not neutral but a torch in the face.
 *
 * Density is fixed here, and only here. A kiosk is a known screen at a known
 * distance, pressed with a gloved hand in February — 64px targets, not
 * whatever the viewport width would have suggested. Every other surface lets
 * the viewport decide.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="kiosk" data-theme="flying-auto" data-density="kiosk">
      {children}
    </div>
  );
}
