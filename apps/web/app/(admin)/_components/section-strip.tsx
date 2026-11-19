"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Modal } from "@galaxy-farm/ui";

import {
  SUB_SECTIONS,
  VIEW_GROUPS,
  destinationFor,
  sectionFor,
} from "@/app/(admin)/_components/nav-groups";
import { markMove } from "@/app/(admin)/_components/back-link";
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
 *
 * One look per level, and never the same look for two levels:
 *
 *   underline   a destination's sections   Farm › Feed, Pastures, Map…
 *                                          Cattle › Herd, Breeding, Health, Sales
 *   pills       a section's own views      Breeding › Calving, Ancestors…
 *   segmented   a page's own panels        (the `Tabs` primitive, not here)
 *
 * Cattle's groups used to be a segmented control while every other
 * destination's sections were underlined, so the top row of Cattle looked
 * like the in-page tabs further down it, and the top row of Farm did not.
 * They are the same level, so they are the same underline.
 *
 * **On a phone, one row, never two.** Two strips under the app bar and above
 * the title put a third of the screen between somebody and the page, and the
 * underline row scrolled the current section off its own edge — standing in
 * the garden, the row said Feed, Pastures, Map, Supplies and not Garden. So a
 * phone gets a single row: a chip that says where you are ("Garden ▾") and
 * opens every sibling in a sheet, then that place's own views as pills. Every
 * row scrolls its current item into view.
 */

/** Scrolls a strip so its current item is on screen, without moving the page. */
function useCurrentInView(current: string | undefined) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = track.current;
    const here = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip == null || here == null) return;
    const left = here.offsetLeft - strip.offsetLeft;
    const right = left + here.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 16);
    else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth + 16;
    }
  }, [current]);
  return track;
}

function Strip({
  items,
  current,
  label,
  quiet = false,
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
  /** The second level: pills under the underline, never a second underline. */
  readonly quiet?: boolean;
}) {
  const track = useCurrentInView(current);
  return (
    <div
      ref={track}
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
        const here = item.href === current;

        return (
          <Link
            key={item.href}
            href={item.href}
            // Along the strip is sideways: it replaces this page in the trail
            // rather than adding a Back through every tab flicked across.
            onClick={() => markMove("sideways")}
            // Whole, not just as far as the loading boundary — see
            // `next.config.ts`. A tab strip is the fastest-clicked thing in the
            // app: thirteen views of one herd, moved between a dozen times in a
            // sitting, and every one of them was a round trip.
            prefetch
            aria-current={here ? "page" : undefined}
            className={
              quiet
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

/**
 * The phone's one row: where you are, as a chip that opens its siblings, and
 * that place's own views beside it.
 */
function PhoneRow({
  area,
  siblings,
  currentSibling,
  views,
  currentView,
}: {
  readonly area: string;
  readonly siblings: readonly NavItem[] | undefined;
  readonly currentSibling: string | undefined;
  readonly views: readonly NavItem[] | undefined;
  readonly currentView: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const track = useCurrentInView(currentView);
  const here = siblings?.find((item) => item.href === currentSibling);
  if (here === undefined && (views ?? []).length === 0) return null;

  return (
    <div
      ref={track}
      role="navigation"
      aria-label="Where you are"
      className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {siblings === undefined || here === undefined ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${here.label} — switch within ${area}`}
          className="flex min-h-target shrink-0 items-center gap-1 rounded-full border border-rule bg-panel px-3 text-sm font-semibold text-ink"
        >
          {here.label}
          <span aria-hidden className="text-muted">
            ▾
          </span>
        </button>
      )}
      {(views ?? []).map((item) => {
        const current = item.href === currentView;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => markMove("sideways")}
            prefetch
            aria-current={current ? "page" : undefined}
            className={`flex min-h-target shrink-0 items-center rounded-full px-3 text-sm ${
              current ? "bg-action/10 font-semibold text-action" : "text-muted hover:text-ink"
            }`}
          >
            {/* "Herd ▾ Herd" says one word twice; the chip already names it. */}
            {item.label === here?.label ? "Overview" : item.label}
          </Link>
        );
      })}

      {open && siblings !== undefined ? (
        <Modal title={area} onClose={() => setOpen(false)}>
          <nav aria-label={`Switch within ${area}`}>
            <ul className="m-0 flex list-none flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule p-0">
              {siblings.map((item) => {
                const current = item.href === currentSibling;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => {
                        markMove("sideways");
                        setOpen(false);
                      }}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-target items-center justify-between px-4 py-3 text-density ${
                        current
                          ? "bg-action/10 font-semibold text-action"
                          : "text-ink hover:bg-raised"
                      }`}
                    >
                      {item.label}
                      {current ? <span aria-hidden>✓</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </Modal>
      ) : null}
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
  // Nor does a destination whose pages switch between their sections from the
  // title — every animal page carries the species switcher (decision 45).
  const showPrimary =
    destination.sections.length > 1 && groups === undefined && destination.titleSwitches !== true;
  if (!showPrimary && subs === undefined) return null;

  // The sub-view being looked at, if any. These carry no `owns`, so an exact
  // match is the whole rule — /admin/cattle/breeding lights Breeding and
  // nothing else, and an animal's detail page lights none of them while still
  // sitting inside Cattle.
  const view = subs?.find((sub) => sub.href === pathname);

  // Grouped views: the groups as the underline, then the chosen group's
  // own views. A detail page sits in no group, so nothing is lit and no second
  // row is drawn — the same rule the flat strip keeps for it.
  const group = groups?.find((candidate) => candidate.views.some((v) => v.href === pathname));

  return (
    // `data-section-strip` lets the page header below drop its eyebrow: the
    // strip already says "Cattle" or "Farm", and saying it twice in a row was
    // one more line between the person and the page.
    <div data-section-strip className="mb-density flex flex-col gap-2">
      <PhoneRow
        area={groups !== undefined ? (section?.label ?? destination.label) : destination.label}
        siblings={
          groups !== undefined
            ? groups.map((candidate) => ({
                href: candidate.views[0]?.href ?? "",
                label: candidate.label,
              }))
            : showPrimary
              ? destination.sections
              : undefined
        }
        currentSibling={groups !== undefined ? group?.views[0]?.href : section?.href}
        views={
          groups !== undefined
            ? group === undefined || group.views.length < 2
              ? undefined
              : group.views
            : subs
        }
        currentView={view?.href}
      />
      <div className="hidden flex-col gap-2 md:flex">
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
            />
            {group === undefined || group.views.length < 2 ? null : (
              <Strip
                items={group.views}
                current={view?.href}
                label={`${group.label} views`}
                quiet
              />
            )}
          </>
        ) : (
          <Strip items={subs} current={view?.href} label={`${section?.label ?? ""} views`} quiet />
        )}
      </div>
    </div>
  );
}
