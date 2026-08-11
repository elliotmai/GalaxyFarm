import type { Metadata } from "next";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
