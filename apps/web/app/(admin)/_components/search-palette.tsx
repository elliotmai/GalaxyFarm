"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { Modal } from "@galaxy-farm/ui";
import type { Animal, BaseRecord, Ulid } from "@galaxy-farm/core";

import { NAV, SUB_SECTIONS, UTILITY } from "@/app/(admin)/_components/nav-groups";
import { useRecords } from "@/lib/local/use-records";
import type { LocalStoreName } from "@/lib/local/store";

/**
 * One box for the whole farm (spec §7, §8 v0.9).
 *
 * The five destinations made the sidebar short by making the app deeper, and
 * depth is only free if anything can be reached by name. So this searches the
 * places a person actually looks for things — the herd, the ancestors, people,
 * kit, supplies — and every page, grouped by where each answer lives. Somebody
 * typing "Montego" should not need to know whether the bull is in the herd,
 * the pedigree or the catalog before they can find him.
 *
 * Everything here reads the device, so it works at zero bars like the rest of
 * the admin. The association catalog is the exception — it lives on a server —
 * so it is offered as a link that carries the words across rather than
 * searched from here.
 */

interface PaletteControls {
  readonly open: () => void;
}

const PaletteContext = createContext<PaletteControls>({ open: () => {} });

export const useSearchPalette = (): PaletteControls => useContext(PaletteContext);

/** A page of the app, under the name somebody would type for it. */
interface PageHit {
  readonly href: string;
  readonly label: string;
  readonly trail: string;
}

/** Every page the nav reaches, each once, with where it sits. */
function allPages(): readonly PageHit[] {
  const seen = new Set<string>();
  const pages: PageHit[] = [];
  const add = (href: string, label: string, trail: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    pages.push({ href, label, trail });
  };

  for (const destination of NAV) {
    for (const section of destination.sections) {
      add(section.href, section.label, destination.label);
      for (const view of SUB_SECTIONS[section.href] ?? []) {
        add(view.href, view.label, `${destination.label} › ${section.label}`);
      }
    }
  }
  for (const item of UTILITY) add(item.href, item.label, "More");
  for (const item of SUB_SECTIONS["/admin/settings"] ?? []) add(item.href, item.label, "Settings");

  return pages;
}

const PAGES = allPages();

export function SearchPaletteProvider({
  propertyId,
  children,
}: {
  readonly propertyId: Ulid;
  readonly children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);

  // ⌘K on a Mac, Ctrl+K elsewhere — the shortcut every other app with a
  // command palette has taught. `/` as well, which is what a search box on the
  // web has answered to for twenty years, but only outside a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if (
        (event.key === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !typing)
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const controls = useMemo(() => ({ open }), [open]);

  return (
    <PaletteContext.Provider value={controls}>
      {children}
      {isOpen ? <SearchPalette propertyId={propertyId} onClose={() => setOpen(false)} /> : null}
    </PaletteContext.Provider>
  );
}

interface Hit {
  readonly key: string;
  readonly href: string;
  readonly title: string;
  readonly line: string;
}

/** Up to five of one kind of record that match, as hits. */
function useHits<T extends BaseRecord>(
  store: LocalStoreName,
  propertyId: Ulid,
  text: string,
  toHit: (record: T) => Hit,
): readonly Hit[] {
  // Asked with an empty search when nothing is typed, then dropped: hooks
  // cannot be called conditionally, and five rows is a cheap read.
  const { records } = useRecords<T>(store, { propertyId, search: text, limit: 5 });
  return text === "" ? [] : records.map(toHit);
}

const SPECIES_HOME: Readonly<Record<string, string>> = {
  horse: "/admin/horses/herd",
  chicken: "/admin/chickens/flock",
};

function SearchPalette({
  propertyId,
  onClose,
}: {
  readonly propertyId: Ulid;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const words = text.trim();
  const input = useRef<HTMLInputElement>(null);

  // The dialog focuses itself on open so a screen reader hears its title.
  // That runs in the dialog's own effect, which React runs before this one —
  // so focusing the box here is what wins, and a search that then needed a tap
  // before typing would be one tap too many.
  useEffect(() => input.current?.focus(), []);

  const animals = useHits<Animal>("animals", propertyId, words, (animal) => ({
    key: animal.id,
    href:
      animal.species === "cattle"
        ? `/admin/cattle/${animal.id}`
        : (SPECIES_HOME[animal.species] ?? "/admin/pets"),
    title: animal.name ?? `Tag ${animal.tagNumber ?? "—"}`,
    line: [
      animal.tagNumber === undefined ? undefined : `Tag ${animal.tagNumber}`,
      animal.species,
      animal.status,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  const ancestors = useHits<
    BaseRecord & { name?: string; regNumber?: string; association?: string }
  >("externalAnimals", propertyId, words, (record) => ({
    key: record.id,
    href: "/admin/cattle/ancestors",
    title: record.name ?? record.regNumber ?? "Unnamed",
    line: [record.association, record.regNumber].filter(Boolean).join(" "),
  }));
  const people = useHits<BaseRecord & { name?: string; company?: string }>(
    "contacts",
    propertyId,
    words,
    (record) => ({
      key: record.id,
      href: "/admin/contacts",
      title: record.name ?? record.company ?? "Unnamed",
      line: record.company ?? "Contact",
    }),
  );
  const kit = useHits<BaseRecord & { name?: string; make?: string; model?: string }>(
    "equipment",
    propertyId,
    words,
    (record) => ({
      key: record.id,
      href: `/admin/equipment/${record.id}`,
      title: record.name ?? "Unnamed",
      line: [record.make, record.model].filter(Boolean).join(" ") || "Equipment",
    }),
  );
  const supplies = useHits<BaseRecord & { name?: string; storageLocation?: string }>(
    "supplyItems",
    propertyId,
    words,
    (record) => ({
      key: record.id,
      href: "/admin/supplies",
      title: record.name ?? "Unnamed",
      line: record.storageLocation ?? "Supplies",
    }),
  );

  const lowered = words.toLowerCase();
  const pages: readonly Hit[] =
    lowered === ""
      ? []
      : PAGES.filter((page) => `${page.label} ${page.trail}`.toLowerCase().includes(lowered))
          .slice(0, 6)
          .map((page) => ({
            key: page.href,
            href: page.href,
            title: page.label,
            line: page.trail,
          }));

  const groups = [
    { label: "Your animals", hits: animals },
    { label: "Ancestors", hits: ancestors },
    { label: "People", hits: people },
    { label: "Equipment", hits: kit },
    { label: "Supplies", hits: supplies },
    { label: "Pages", hits: pages },
  ].filter((group) => group.hits.length > 0);

  const first = groups[0]?.hits[0];

  return (
    <Modal title="Search" onClose={onClose}>
      <form
        role="search"
        onSubmit={(event) => {
          // Enter takes the top answer, which is what a person typing a tag
          // number and pressing Return expects to happen.
          event.preventDefault();
          if (first !== undefined) {
            router.push(first.href);
            onClose();
          }
        }}
      >
        <label htmlFor="palette-search" className="sr-only">
          Search animals, people, kit and pages
        </label>
        <input
          id="palette-search"
          type="search"
          ref={input}
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Animals, people, kit, pages…"
          className="h-12 w-full rounded-density border-2 border-action bg-panel px-4 text-density text-ink outline-none"
        />
      </form>

      {words === "" ? (
        <nav aria-label="Jump to" className="flex flex-wrap gap-2">
          {NAV.map((destination) => (
            <Link
              key={destination.href}
              href={destination.href}
              onClick={onClose}
              className="flex min-h-target items-center rounded-full border border-rule px-4 text-sm font-medium text-ink hover:bg-raised"
            >
              {destination.label}
            </Link>
          ))}
        </nav>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">Nothing on this device is called “{words}”.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </h3>
              <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule">
                {group.hits.map((hit) => (
                  <li key={hit.key}>
                    <Link
                      href={hit.href}
                      onClick={onClose}
                      className="flex min-h-target flex-col justify-center px-3 py-2 hover:bg-raised"
                    >
                      <span className="text-density font-semibold text-ink">{hit.title}</span>
                      {hit.line === "" ? null : (
                        <span className="text-sm text-muted">{hit.line}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {words === "" ? null : (
        <Link
          href={`/admin/cattle/catalog?text=${encodeURIComponent(words)}`}
          onClick={onClose}
          className="text-sm font-medium text-action underline underline-offset-4"
        >
          Search the association catalog for “{words}”
        </Link>
      )}
    </Modal>
  );
}
