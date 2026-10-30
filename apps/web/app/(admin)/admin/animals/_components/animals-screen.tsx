"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, EmptyState, Modal, Select, TextInput, optionLabel } from "@galaxy-farm/ui";
import type { Animal, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";
import type { BreedingRecord, CalvingRecord, HealthRecord } from "@galaxy-farm/module-cattle";
import type { Flock, FlockAdjustment } from "@galaxy-farm/module-poultry";

import {
  animalEntries,
  filterEntries,
  GROUP_BY_LABELS,
  GROUP_BYS,
  GROUP_LABELS,
  GROUPS,
  groupEntries,
  viewFacts,
  viewFrom,
  type AnimalGroup,
} from "@/app/(admin)/admin/animals/_components/animal-entries";
import { noteAddress } from "@/app/(admin)/_components/back-link";
import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
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
 *
 * Filter and group sit behind one button — where it stands (outside or in),
 * sex, status, class, and grouping by any of those — and live in the address,
 * so "the heifers in Pasture 3" survives opening one of them and coming Back.
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

  const router = useRouter();
  const params = useSearchParams();
  const view = viewFrom(params);
  const asked = params.get("species") ?? "";
  const group: AnimalGroup | "" = (GROUPS as readonly string[]).includes(asked)
    ? (asked as AnimalGroup)
    : "";

  // The address as last asked for. The router applies a replace in a
  // transition, so two changes in a row — Sex, then Group by — would each start
  // from the address before either landed, and the second would undo the first.
  const asking = useRef<string | undefined>(undefined);
  useEffect(() => {
    asking.current = undefined;
  }, [params]);

  /** Change the view in the address, replacing rather than stacking history. */
  function setView(changes: Readonly<Record<string, string>>) {
    const next = new URLSearchParams(asking.current ?? params.toString());
    for (const [key, value] of Object.entries(changes)) {
      // crud-guard: allow-unconfirmed — drops a key from the address bar, nothing persisted
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    asking.current = query;
    const href = query === "" ? "/admin/animals" : `/admin/animals?${query}`;
    router.replace(href, { scroll: false });
    // So Back from an animal returns to the list filtered as it was left.
    noteAddress(href);
  }
  const setGroup = (next: AnimalGroup | "") => setView({ species: next });

  const [search, setSearch] = useState("");
  const [showGone, setShowGone] = useState(false);
  const [filtering, setFiltering] = useState(false);
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
  // Asking for a status — sold, dead — is asking to see the ones no longer here.
  const pool = showGone || view.status !== "" ? entries : here;
  const viewed = filterEntries(pool, view);

  // Counted before the search, so a chip's number is how many there are, not
  // how many happen to match what is half-typed.
  const counts = new Map<AnimalGroup, number>(
    GROUPS.map((key) => [key, viewed.filter((entry) => entry.group === key).length]),
  );

  const needle = search.trim().toLowerCase();
  const shown = viewed.filter(
    (entry) =>
      (group === "" || entry.group === group) && (needle === "" || entry.haystack.includes(needle)),
  );
  const sections = groupEntries(shown, view.groupBy);
  const facts = viewFacts(view, zones);

  // What the filters offer: only what exists, so no choice leads to nothing.
  const ofSpecies = entries.filter((entry) => group === "" || entry.group === group);
  const kinds = [...new Set(ofSpecies.map((entry) => entry.kind))].sort();
  const statuses = [...new Set(entries.map((entry) => entry.status))].sort();
  const places = zones
    .filter((zone) => zone.active)
    .sort(
      (left, right) =>
        Number(left.indoor) - Number(right.indoor) || left.name.localeCompare(right.name),
    );

  function toggle(id: Ulid) {
    setSelected((was) => (was.includes(id) ? was.filter((held) => held !== id) : [...was, id]));
  }

  function toggleSelecting() {
    setSelecting((was) => !was);
    setSelected([]);
  }

  if (loading || flocksLoading) return <p className="text-muted">Loading the animals…</p>;

  const narrowed = group !== "" || needle !== "" || facts.length > 0;

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

      <div className="flex flex-wrap items-center gap-2">
        <Button aria-haspopup="dialog" onClick={() => setFiltering(true)}>
          Filter &amp; group{facts.length === 0 ? "" : ` (${facts.length})`}
        </Button>
        {view.groupBy === "" ? null : (
          <span className="text-sm text-muted">
            Grouped by {GROUP_BY_LABELS[view.groupBy].toLowerCase()}
          </span>
        )}
      </div>

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
            {facts.length === 0 ? "" : ` · ${facts.join(" · ")}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setView({ species: "", where: "", sex: "", status: "", class: "" });
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
        sections.map((section) => (
          <section
            key={section.label}
            aria-label={section.label === "" ? undefined : section.label}
            className="flex flex-col gap-2"
          >
            {section.label === "" ? null : (
              <h2 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
                {section.label}
                <span className="gf-numeric text-xs font-normal text-muted">
                  {section.entries.length}
                </span>
              </h2>
            )}
            <ul
              aria-label={section.label === "" ? "Animals on this property" : section.label}
              className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
            >
              {section.entries.map((entry) => (
                <AnimalListRow
                  key={`${entry.group}:${entry.id}`}
                  entry={entry}
                  selecting={selecting}
                  selected={selected.includes(entry.id)}
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {filtering ? (
        <Modal
          title="Filter and group"
          placement="side"
          onClose={() => setFiltering(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              {facts.length === 0 && view.groupBy === "" ? null : (
                <Button
                  variant="ghost"
                  onClick={() => setView({ where: "", sex: "", status: "", class: "", by: "" })}
                >
                  Clear all
                </Button>
              )}
              <Button variant="primary" onClick={() => setFiltering(false)}>
                Show {shown.length}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-density">
            <Select
              label="Where"
              value={view.where}
              onChange={(event) => setView({ where: event.target.value })}
              options={[
                { value: "", label: "Anywhere" },
                ...places.map((zone) => ({
                  value: zone.id,
                  label: zone.indoor ? `${zone.name} · inside` : zone.name,
                })),
                { value: "none", label: "Not placed outside" },
              ]}
            />
            <Select
              label="Sex"
              value={view.sex}
              onChange={(event) => setView({ sex: event.target.value })}
              options={[
                { value: "", label: "Either" },
                { value: "female", label: "Female" },
                { value: "male", label: "Male" },
              ]}
            />
            <Select
              label="Status"
              value={view.status}
              onChange={(event) => setView({ status: event.target.value })}
              options={[
                { value: "", label: "On the farm" },
                ...statuses.map((status) => ({ value: status, label: optionLabel(status) })),
              ]}
            />
            <Select
              label="Class"
              value={view.kind}
              onChange={(event) => setView({ class: event.target.value })}
              options={[
                { value: "", label: "Any" },
                ...kinds.map((kind) => ({ value: kind, label: kind })),
              ]}
            />
            <Select
              label="Group by"
              value={view.groupBy}
              onChange={(event) => setView({ by: event.target.value })}
              options={GROUP_BYS.map((by) => ({ value: by, label: GROUP_BY_LABELS[by] }))}
            />
          </div>
        </Modal>
      ) : null}

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
            <Link
              href={logHref({ animals: selected, from: "/admin/animals" })}
              className={ACTION_LINK}
            >
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
