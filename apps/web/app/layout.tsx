import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";

import "./globals.css";

/**
 * Farm and business names are BrandingConfig values (spec §5.1), never string
 * literals in code. Until the settings store exists they read from the
 * environment with a neutral fallback, so there is still exactly one place to
 * change them.
 */
const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

/**
 * The four faces (spec §8, v0.9).
 *
 * These were named in the stylesheet from the first day and never actually
 * fetched — no `next/font`, no `@font-face`, no link — so every heading in the
 * app rendered in Georgia and every label in the OS default. The design
 * language existed on paper and had never once reached a browser.
 *
 * `next/font/local` over `next/font/google`, deliberately. The Google loader
 * downloads at *build* time and self-hosts the result, so the two are identical
 * at runtime — but one of them makes `pnpm build` fail without a network, and
 * this is a codebase that will not speak a provider-proprietary API for a
 * database. Taking a third party as a build dependency for a typeface is the
 * same bargain in smaller print. The files are committed beside this one; the
 * build reads them off disk.
 *
 * All four are SIL Open Font License, which is what makes redistributing them
 * in the repository fine. Latin subsets only — 409 KB for the set, and they
 * would ship to the browser either way.
 *
 * Which face is used where is a property of the density, not of this file:
 * `theme.css` points `--gf-font-display` at one of these per surface. Here they
 * are only made available.
 *
 * The constants are named for their typeface rather than their role on purpose.
 * `next/font/local` derives the generated `font-family` from the variable it is
 * assigned to, so a const called `serif` or `mono` registers a family with that
 * exact name — and both are CSS generic keywords. The browser resolved
 * `font-family: "serif", …` straight past the webfont to the generic, and every
 * heading rendered in the system serif while the file it wanted sat loaded and
 * unused.
 */
const sourceSerif = localFont({
  src: [
    { path: "./fonts/source-serif-4-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/source-serif-4-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-serif-loaded",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans-loaded",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const barlowCondensed = localFont({
  src: [{ path: "./fonts/barlow-condensed-latin-600.woff2", weight: "600", style: "normal" }],
  variable: "--font-cond-loaded",
  display: "swap",
  // Arial Narrow first: a generic sans is not condensed, and a kiosk label
  // that falls back to one wraps where it was measured not to.
  fallback: ["Arial Narrow", "sans-serif"],
});

const plexMono = localFont({
  src: [{ path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400", style: "normal" }],
  variable: "--font-mono-loaded",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: { default: farmName, template: `%s · ${farmName}` },
  description: "Local-first herd, homestead, and show-program management.",
  manifest: "/manifest.json",
};

/**
 * The viewport, stated rather than defaulted (spec §8).
 *
 * `viewportFit: "cover"` lets the surfaces reach the edges of a notched phone;
 * `[data-surface]` in globals.css pays for that by padding the safe areas back
 * in, so nothing lands under a home indicator or a camera cutout.
 *
 * Zoom is locked, by request. The trade is real and worth stating once: pinch
 * to zoom is an accessibility affordance, and taking it away costs whoever
 * would have used it to read a tag number in bright sun. What it buys is an
 * app that does not scale out from under a double-tap on a form field, which
 * is the thing that makes a web app feel unlike an app. The mitigation is that
 * body text is 16px on a phone rather than the 15px a laptop gets, so there is
 * less to zoom into — and the browser's own reader and system font-size
 * settings are untouched by this.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // The day canvas, which is what the front door and the customer portal are
  // fixed to. The working surfaces override this: they run `flying-auto` and
  // go dark when the device does, and chrome that stayed light above a dark
  // page is a visible seam across the top of every screen.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#F5F6F8" },
    { media: "(prefers-color-scheme: light)", color: "#F5F6F8" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${plexSans.variable} ${barlowCondensed.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
