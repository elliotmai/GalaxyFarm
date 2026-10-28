"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SUB_SECTIONS,
  VIEW_GROUPS,
  destinationFor,
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
  current,
  label,
  quiet = false,
  segmented = false,
}: {
  readonly items: readonly NavItem[];
  /**
   * Which item to mark, resolved by the caller.
   *
   * Not recomputed here with `isWithin`. That predicate refuses to match a
   * route the nav already knows — its job is to stop `owns: ["/admin/cattle/"]`
   * swallowing a sibling with a top-level entry — and a section's own declared
   * sub-views are exactly such routes. So standing on /admin/cattle/breeding
   * lit nothing at all in the sections strip: Cattle was rejected for owning a
   * page the nav had heard of, which is its whole purpose.
   */
  readonly current: string | undefined;
  readonly label: string;
  readonly quiet?: boolean;
  /** A segmented control: a few big choices rather than a run of tabs. */
  readonly segmented?: boolean;
}) {
  return (
    <div
      // A `nav` rather than a tablist: these are links to routes, not panels
      // swapped in place, and announcing them as tabs promises a keyboard
      // behaviour they do not have.
      aria-label={label}
      className={`flex gap-1 overflow-x-auto ${
        segmented
          ? "rounded-density bg-raised p-1 sm:self-start"
          : quiet
            ? ""
            : "border-b border-rule"
      } [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      role="navigation"
    >
      {items.map((item) => {
        const here = item.href === current;

        return (
          <Link
            key={item.href}
            href={item.href}
            // Whole, not just as far as the loading boundary — see
            // `next.config.ts`. A tab strip is the fastest-clicked thing in the
            // app: thirteen views of one herd, moved between a dozen times in a
            // sitting, and every one of them was a round trip.
            prefetch
            aria-current={here ? "page" : undefined}
            className={
              segmented
                ? `flex min-h-target flex-1 shrink-0 items-center justify-center rounded-density px-4 text-sm sm:flex-none ${
                    here
                      ? "bg-panel font-semibold text-ink shadow-[0_1px_3px_rgba(20,23,27,0.15)]"
                      : "text-muted hover:text-ink"
                  }`
                : quiet
                  ? `flex min-h-target shrink-0 items-center rounded-full px-3 text-sm ${
                      here ? "bg-action/10 font-semibold text-action" : "text-muted hover:text-ink"
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
  // A landing that carries its own chips (Animals) draws no strip above them.
  if (destination.quietLanding === true && pathname === destination.href) return null;

  const section = sectionFor(pathname);
  const subs = section === undefined ? undefined : SUB_SECTIONS[section.href];

  // A record's own page — an animal, a machine — is reached from a list and
  // carries its own way back. Tab strips above it were two rows of somewhere
  // else between the person and the record they opened.
  const isRecordPage =
    section !== undefined &&
    pathname !== section.href &&
    !(subs ?? []).some((sub) => sub.href === pathname);
  if (isRecordPage) return null;

  const groups = section === undefined ? undefined : VIEW_GROUPS[section.href];

  // A single-section destination needs no strip — one tab is not a choice.
  // Nor does a grouped section's parent: Cattle's own four groups say where you
  // are, and switching species is what the Animals tab is for.
  const showPrimary = destination.sections.length > 1 && groups === undefined;
  if (!showPrimary && subs === undefined) return null;

  // The sub-view being looked at, if any. These carry no `owns`, so an exact
  // match is the whole rule — /admin/cattle/breeding lights Breeding and
  // nothing else, and an animal's detail page lights none of them while still
  // sitting inside Cattle.
  const view = subs?.find((sub) => sub.href === pathname);

  // Grouped views: the groups as a segmented control, then the chosen group's
  // own views. A detail page sits in no group, so nothing is lit and no second
  // row is drawn — the same rule the flat strip keeps for it.
  const group = groups?.find((candidate) => candidate.views.some((v) => v.href === pathname));

  return (
    <div className="mb-density flex flex-col gap-2">
      {showPrimary ? (
        <Strip
          items={destination.sections}
          current={section?.href}
          label={`${destination.label} sections`}
        />
      ) : null}
      {subs === undefined ? null : groups !== undefined ? (
        <>
          <Strip
            items={groups.map((candidate) => ({
              href: candidate.views[0]?.href ?? "",
              label: candidate.label,
            }))}
            current={group?.views[0]?.href}
            label={`${section?.label ?? ""} views`}
            segmented
          />
          {group === undefined || group.views.length < 2 ? null : (
            <Strip items={group.views} current={view?.href} label={`${group.label} views`} quiet />
          )}
        </>
      ) : (
        <Strip items={subs} current={view?.href} label={`${section?.label ?? ""} views`} quiet />
      )}
    </div>
  );
}
