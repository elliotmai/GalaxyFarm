import Link from "next/link";

import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";
import { Logomark } from "@galaxy-farm/ui";

import { AccountNav } from "@/app/(account)/_components/account-nav";
import { PwaShell } from "@/app/_components/pwa-shell";

/**
 * account surface. Daylight, fixed — not `flying-auto` (spec §8 v0.9).
 *
 * Night is a working mode for people doing chores in the dark, and a customer
 * reading an invoice or a pedigree is not doing chores. This surface is also
 * the one that gets printed and shown to a buyer, where the brand's daylight
 * look is the point.
 *
 * The shell is the public site's: the same white header with the mark and the
 * farm's name, so a customer who signed in from the landing page is plainly
 * still at the same farm — with the portal's own pages as tabs under it, and
 * one `main` for the page.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  // A BrandingConfig value (§5.1), never a literal.
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <div data-surface="account" data-theme="flying-day" className="flex min-h-[100dvh] flex-col">
      <header className="border-b border-rule bg-panel">
        <div className="mx-auto flex w-full max-w-5xl flex-col px-4 sm:px-6">
          <Link href="/account" className="flex min-h-target min-w-0 items-center gap-2.5 pt-2">
            <Logomark size="small" decorative />
            <span className="truncate font-heading text-lg font-semibold text-ink">{farmName}</span>
          </Link>
          <AccountNav />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        {children}
      </main>
      <PwaShell />
    </div>
  );
}
