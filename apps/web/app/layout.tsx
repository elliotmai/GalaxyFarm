import type { Metadata, Viewport } from "next";

import "./globals.css";

/**
 * Farm and business names are BrandingConfig values (spec §5.1), never string
 * literals in code. Until the settings store exists they read from the
 * environment with a neutral fallback, so there is still exactly one place to
 * change them.
 */
const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? "Galaxy Farm";

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
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0E1026" },
    { media: "(prefers-color-scheme: light)", color: "#F7F4EA" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
