"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SUB_SECTIONS,
  destinationFor,
  isWithin,
  sectionFor,
} from "@/app/(admin)/_components/nav-groups";
import type { NavItem } from "@/app/(admin)/_components/nav-groups";

/**
 * Where the fifty-five links went (spec §7, §8 v0.9).
 *
 * The sidebar answers "which part of the farm"; this answers "which view of
 * it". Up to two strips: the destination's sections, and — where a section has
 * views of its own — that section's. Cattle is the case that forced the split:
 * thirteen views of one herd, which were thirteen sidebar rows competing with
 * Pastures and Invoices for the same attention.
 *
 * Rendered in the layout rather than by each screen, so a page cannot forget
 * it, and so it survives navigation without remounting.
 *
 * It scrolls sideways rather than wrapping. A strip that wraps to three rows
 * changes the height of every screen under it, and thirteen tabs would.
 */

function Strip({
  items,
  pathname,
  label,
  quiet = false,
}: {
  readonly items: readonly NavItem[];
  readonly pathname: string;
  readonly label: string;
  readonly quiet?: boolean;
}) {
  return (
    <div
      // A `nav` rather than a tablist: these are links to routes, not panels
      // swapped in place, and announcing them as tabs promises a keyboard
      // behaviour they do not have.
      aria-label={label}
      className={`flex gap-1 overflow-x-auto ${
        quiet ? "" : "border-b border-rule"
      } [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      role="navigation"
    >
      {items.map((item) => {
        const here = isWithin(item, pathname);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={here ? "page" : undefined}
            className={
              quiet
                ? `flex min-h-target shrink-0 items-center rounded-density px-3 text-sm ${
                    here ? "bg-raised font-semibold text-ink" : "text-muted hover:text-ink"
                  }`
                : `flex min-h-target shrink-0 items-center border-b-2 px-3 text-density ${
                    here
                      ? "border-action font-semibold text-ink"
                      : "border-transparent text-muted hover:text-ink"
                  }`
            }
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function SectionStrip() {
  const pathname = usePathname();
  const destination = destinationFor(pathname);
  if (destination === undefined) return null;

  const section = sectionFor(pathname);
  const subs = section === undefined ? undefined : SUB_SECTIONS[section.href];

  // A single-section destination needs no strip — one tab is not a choice.
  const showPrimary = destination.sections.length > 1;
  if (!showPrimary && subs === undefined) return null;

  return (
    <div className="mb-density flex flex-col gap-2">
      {showPrimary ? (
        <Strip
          items={destination.sections}
          pathname={pathname}
          label={`${destination.label} sections`}
        />
      ) : null}
      {subs === undefined ? null : (
        <Strip items={subs} pathname={pathname} label={`${section?.label ?? ""} views`} quiet />
      )}
    </div>
  );
}
