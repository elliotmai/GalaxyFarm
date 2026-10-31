import Link from "next/link";
import type { ReactNode } from "react";

import { Logomark } from "@galaxy-farm/ui";

/**
 * The frames every public page sits in (spec §7, §8).
 *
 * Two of them, because the front door has two kinds of page. The site pages —
 * the landing, the boarding enquiry — share the landing's header, so somebody
 * moving between them is plainly still on the same site. The account pages —
 * sign in, set a password — are one card on the canvas under the mark, the
 * shape every sign-in screen has, with nothing else to read.
 *
 * Both carry a 16px gutter on a phone and the admin's quiet look: a white
 * panel on the light canvas, a hairline rule, one navy action.
 */

/** The landing's header, shared so the site pages read as one site. */
export function SiteHeader({ farmName }: { readonly farmName: string }) {
  return (
    <header className="border-b border-rule bg-panel">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex min-h-target min-w-0 items-center gap-2.5">
          <Logomark size="small" decorative />
          <span className="truncate font-heading text-lg font-semibold text-ink">{farmName}</span>
        </Link>
        <Link
          href="/book"
          className="inline-flex min-h-target shrink-0 items-center rounded-density bg-action px-4 text-density font-semibold text-action-ink"
        >
          Enquire
        </Link>
      </div>
    </header>
  );
}

/** A site page that is not the landing: the shared header over one column. */
export function SitePage({
  farmName,
  children,
}: {
  readonly farmName: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader farmName={farmName} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}

/**
 * Sign in, set a password: one card under the mark.
 *
 * The farm's name is the page's heading and links home — the one way off a
 * page somebody may have reached from an email with nothing else open.
 */
export function AuthShell({
  farmName,
  children,
  footer,
}: {
  readonly farmName: string;
  readonly children: ReactNode;
  /** One quiet line under the card. */
  readonly footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-4 py-10">
      <Link href="/" className="flex flex-col items-center gap-2 text-center">
        <Logomark size="large" decorative />
        <h1 className="text-ink">{farmName}</h1>
      </Link>

      <div className="flex w-full max-w-sm flex-col gap-4">{children}</div>

      {footer === undefined ? null : (
        <div className="max-w-sm text-center text-sm text-muted">{footer}</div>
      )}
    </main>
  );
}
