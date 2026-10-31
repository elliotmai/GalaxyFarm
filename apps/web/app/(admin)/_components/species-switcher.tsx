"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import type { Animal, Ulid } from "@galaxy-farm/core";
import type { Flock } from "@galaxy-farm/module-poultry";

import { markMove } from "@/app/(admin)/_components/back-link";
import { useRecords } from "@/lib/local/use-records";
import { isOnFarm } from "@galaxy-farm/core";
import { rememberAnimalHome, type AnimalHome } from "@/lib/last-species";

/**
 * The page title on every species page, which is also the way to the others
 * (decision 45): "Cattle ⌄" opens the five species with their counts, and
 * Every animal. One tap to open, one to go — and the choice is remembered, so
 * the Animals tab reopens it next time.
 *
 * It replaces the strip of species tabs that used to sit above every animal
 * page: a strip that scrolled sideways on a phone, so the species you wanted
 * was as often as not off the edge of the screen.
 */

interface Choice {
  readonly home: AnimalHome;
  readonly label: string;
  readonly count: (counts: Counts) => number;
}

interface Counts {
  readonly cattle: number;
  readonly horses: number;
  readonly birds: number;
  readonly flocks: number;
  readonly dogs: number;
  readonly cats: number;
}

const CHOICES: readonly Choice[] = [
  { home: "/admin/cattle", label: "Cattle", count: (c) => c.cattle },
  { home: "/admin/horses", label: "Horses", count: (c) => c.horses },
  { home: "/admin/chickens/flock", label: "Chickens", count: (c) => c.flocks + c.birds },
  { home: "/admin/pets/dogs", label: "Dogs", count: (c) => c.dogs },
  { home: "/admin/pets/cats", label: "Cats", count: (c) => c.cats },
  {
    home: "/admin/animals",
    label: "Every animal",
    count: (c) => c.cattle + c.horses + c.flocks + c.birds + c.dogs + c.cats,
  },
];

export function SpeciesSwitcher({
  propertyId,
  current,
  detail,
}: {
  readonly propertyId: Ulid;
  /** The page this title sits on. */
  readonly current: AnimalHome;
  /** The muted fact beside the title — "8 head", "16 birds". */
  readonly detail?: string;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: flocks } = useRecords<Flock>("flocks", query);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);

  // Being here is choosing it: the Animals tab comes back to this page.
  useEffect(() => rememberAnimalHome(current), [current]);

  // A tap anywhere else, or Escape, puts the menu away.
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const here = animals.filter(isOnFarm);
  const of = (species: string) => here.filter((animal) => animal.species === species).length;
  const counts: Counts = {
    cattle: of("cattle"),
    horses: of("horse"),
    birds: of("chicken") + of("quail"),
    flocks: flocks.filter((flock) => flock.active).length,
    dogs: of("dog"),
    cats: of("cat"),
  };
  const chosen = CHOICES.find((choice) => choice.home === current) ?? CHOICES[CHOICES.length - 1];

  return (
    <div ref={wrapper} className="relative flex min-w-0 items-baseline gap-2.5">
      <h1 className="m-0 text-ink" data-title={chosen?.label}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((was) => !was)}
          className="inline-flex items-center gap-1.5 rounded-density text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          {chosen?.label}
          <span aria-hidden="true" className="text-[0.6em] text-muted">
            ▾
          </span>
          <span className="sr-only">, switch species</span>
        </button>
      </h1>
      {detail === undefined ? null : <span className="text-sm text-muted">{detail}</span>}

      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label="Species"
          className="absolute left-0 top-full z-30 mt-2 flex w-64 flex-col overflow-hidden rounded-density border border-rule bg-panel py-1 shadow-lg"
        >
          {CHOICES.map((choice) => {
            const isHere = choice.home === current;
            return (
              <li key={choice.home} role="none">
                <Link
                  role="menuitem"
                  href={choice.home}
                  aria-current={isHere ? "page" : undefined}
                  onClick={() => {
                    rememberAnimalHome(choice.home);
                    // Another species is a fresh start, as a tab change is: no
                    // Back from Horses into the Cattle page left behind.
                    markMove("tab");
                    setOpen(false);
                  }}
                  className={`flex min-h-target items-center justify-between gap-3 px-4 text-density hover:bg-raised ${
                    isHere ? "font-semibold text-action" : "text-ink"
                  } ${choice.home === "/admin/animals" ? "border-t border-rule" : ""}`}
                >
                  {choice.label}
                  <span className="gf-numeric text-sm text-muted">{choice.count(counts)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
