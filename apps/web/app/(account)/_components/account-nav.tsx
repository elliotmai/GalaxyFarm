"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The customer portal's pages, as one strip of tabs (spec §7).
 *
 * Every page under `/account` and nothing else — the portal is still mostly
 * placeholders, and a strip that offered more than exists would be a promise.
 * A horizontal scroller on a phone, so five tabs never widen the page past
 * the screen.
 */
const PAGES = [
  { href: "/account", label: "Home" },
  { href: "/account/animals", label: "Animals" },
  { href: "/account/invoices", label: "Invoices" },
  { href: "/account/forms", label: "Forms" },
  { href: "/account/shows", label: "Shows" },
] as const;

export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Your account" className="-mx-2 -mb-px overflow-x-auto">
      <ul className="flex">
        {PAGES.map((page) => {
          const current =
            page.href === "/account"
              ? pathname === "/account"
              : pathname === page.href || pathname.startsWith(`${page.href}/`);

          return (
            <li key={page.href} className="shrink-0">
              <Link
                href={page.href}
                aria-current={current ? "page" : undefined}
                className={[
                  "inline-flex min-h-target items-center border-b-2 px-2 text-sm font-semibold",
                  current
                    ? "border-action text-ink"
                    : "border-transparent text-muted hover:text-ink",
                ].join(" ")}
              >
                {page.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
