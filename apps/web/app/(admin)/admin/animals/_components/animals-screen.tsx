"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, EmptyState, TextInput } from "@galaxy-farm/ui";
import type { Animal, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";
import type { BreedingRecord, CalvingRecord, HealthRecord } from "@galaxy-farm/module-cattle";
import type { Flock, FlockAdjustment } from "@galaxy-farm/module-poultry";

import {
  animalEntries,
  GROUP_LABELS,
  GROUPS,
  type AnimalGroup,
} from "@/app/(admin)/admin/animals/_components/animal-entries";
import { AnimalListRow } from "@/app/(admin)/admin/animals/_components/animal-list-row";
import { Chip, ChipRow } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { useRecords } from "@/lib/local/use-records";

/**
 * Animals — every one on the place, in one list (V2 Animals).
 *
 * The species screens stay where they are; this is the way in that does not
 * make anybody remember which species a name belongs to. Search, one row of
 * species chips that are also the counts, and a Select mode for "these four
 * all got the same shot" — which hands the picked animals to the Log flow
 * rather than growing a second way to write a record here.
 */

const ACTION_LINK =
  "inline-flex min-h-target items-center justify-center rounded-density bg-action px-4 font-semibold text-action-ink hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

export function AnimalsScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: flocks, loading: flocksLoading } = useRecords<Flock>("flocks", query);
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<AnimalGroup | "">("");
  const [showGone, setShowGone] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<readonly Ulid[]>([]);

  // One clock for the render, so a class or a due date cannot flip mid-list.
  const now = useMemo(() => new Date(), []);

  const entries = useMemo(
    () =>
      animalEntries({
        animals,
        flocks,
        adjustments,
        zones,
        assignments,
        health,
        breedings,
        calvings,
        now,
      }),
    [animals, flocks, adjustments, zones, assignments, health, breedings, calvings, now],
  );

  const here = entries.filter((entry) => entry.onFarm);
  const gone = entries.length - here.length;
  const pool = showGone ? entries : here;

  // Counted before the search, so a chip's number is how many there are, not
  // how many happen to match what is half-typed.
  const counts = new Map<AnimalGroup, number>(
    GROUPS.map((key) => [key, pool.filter((entry) => entry.group === key).length]),
  );

  const needle = search.trim().toLowerCase();
  const shown = pool.filter(
    (entry) =>
      (group === "" || entry.group === group) && (needle === "" || entry.haystack.includes(needle)),
  );

  function toggle(id: Ulid) {
    setSelected((was) => (was.includes(id) ? was.filter((held) => held !== id) : [...was, id]));
  }

  function toggleSelecting() {
    setSelecting((was) => !was);
    setSelected([]);
  }

  if (loading || flocksLoading) return <p className="text-muted">Loading the animals…</p>;

  const narrowed = group !== "" || needle !== "";

  return (
    // Bottom clearance on a phone, so the floating button never sits on the
    // last row.
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      <header className="flex items-center justify-between gap-density">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="text-ink">Animals</h1>
          <span className="text-sm text-muted">{here.length} here</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant={selecting ? "primary" : "secondary"}
            aria-pressed={selecting}
            onClick={toggleSelecting}
          >
            {selecting ? "Done" : "Select"}
          </Button>
          {/* Hidden on a phone by a wrapper: there the add button floats. */}
          <span className="hidden sm:block">
            <Link href="/admin/cattle?add=1" className={ACTION_LINK}>
              <span aria-hidden="true">+</span>&nbsp;Add animal
            </Link>
          </span>
        </div>
      </header>

      <TextInput
        label="Find an animal"
        hideLabel
        placeholder="Find an animal"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <ChipRow label="Filter by species">
        <Chip on={group === ""} onClick={() => setGroup("")}>
          All <span className="gf-numeric text-xs opacity-80">{pool.length}</span>
        </Chip>
        {GROUPS.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => (
          // Pressing the one already on goes back to everyone.
          <Chip key={key} on={group === key} onClick={() => setGroup(group === key ? "" : key)}>
            {GROUP_LABELS[key]}{" "}
            <span className="gf-numeric text-xs opacity-80">{counts.get(key)}</span>
          </Chip>
        ))}
      </ChipRow>

      {narrowed ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
          <span>
            Showing {shown.length} of {pool.length}
          </span>
          <button
            type="button"
            onClick={() => {
              setGroup("");
              setSearch("");
            }}
            className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </p>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          title={
            entries.length === 0
              ? "No animals yet"
              : needle === ""
                ? "None here"
                : `Nothing matches "${search}"`
          }
          detail={
            entries.length === 0
              ? "Add the first one and it shows up here."
              : "Search looks at name and tag."
          }
        />
      ) : (
        <ul
          aria-label="Animals on this property"
          className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
        >
          {shown.map((entry) => (
            <AnimalListRow
              key={`${entry.group}:${entry.id}`}
              entry={entry}
              selecting={selecting}
              selected={selected.includes(entry.id)}
              onToggle={() => toggle(entry.id)}
            />
          ))}
        </ul>
      )}

      {gone === 0 ? null : (
        <button
          type="button"
          onClick={() => setShowGone((was) => !was)}
          className="inline-flex min-h-target items-center self-start text-sm font-semibold text-action underline-offset-2 hover:underline"
        >
          {showGone ? "Hide the ones no longer here" : `Show ${gone} no longer here`}
        </button>
      )}

      {selecting ? (
        // Sticky rather than fixed, so it sits above the phone's tab bar and
        // inside the page column on a laptop without knowing where the rail is.
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-density border border-rule bg-panel p-2 pl-4 shadow-lg md:bottom-4">
          <span className="text-sm font-semibold text-ink" aria-live="polite">
            {selected.length} selected
          </span>
          {selected.length === 0 ? (
            <span aria-disabled="true" className={`${ACTION_LINK} cursor-not-allowed opacity-50`}>
              Log for them
            </span>
          ) : (
            <Link href={`/admin/log?animals=${selected.join(",")}`} className={ACTION_LINK}>
              Log for them
            </Link>
          )}
        </div>
      ) : (
        <Link
          href="/admin/cattle?add=1"
          className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            +
          </span>
          Add animal
        </Link>
      )}
    </div>
  );
}
