"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button, EmptyState, Modal, Select, TextInput, optionLabel } from "@galaxy-farm/ui";
import type { Animal, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";
import type { BreedingRecord, CalvingRecord, HealthRecord } from "@galaxy-farm/module-cattle";
import type { EggLog, Flock, FlockAdjustment } from "@galaxy-farm/module-poultry";

import {
  animalEntries,
  filterEntries,
  GROUP_BY_LABELS,
  GROUP_BYS,
  GROUP_HOMES,
  GROUP_LABELS,
  GROUPS,
  groupEntries,
  viewFacts,
  viewFrom,
  type AnimalGroup,
} from "@/app/(admin)/admin/animals/_components/animal-entries";
import { noteAddress } from "@/app/(admin)/_components/back-link";
import { SpeciesSwitcher } from "@/app/(admin)/_components/species-switcher";
import { DEFAULT_ANIMAL_HOME, isAnimalHome } from "@/lib/last-species";
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
 *
 * The same screen is each species' own page (`species`): Horses, Chickens,
 * Dogs, Cats — the herd page's shape for every animal on the place, with the
 * species chips swapped for that species' classes and its own Add. One
 * component, so the pages cannot drift apart.
 */

/** One of a species page's big buttons: the job, as a link into the Log or a tool. */
export interface QuickAction {
  readonly label: string;
  readonly href: string;
  /** A character, not an icon set — read before the word is. */
  readonly glyph: string;
}

/** How a species page adds one: a link elsewhere, or its own form in place. */
export interface AddAction {
  readonly label: string;
  readonly href?: string;
  /** Draws the species' existing add form; `close` hides it again. */
  readonly render?: (close: () => void) => ReactNode;
}

/** A species chip on the Animals list: the off chip's look, as a link onward. */
const SPECIES_LINK =
  "inline-flex min-h-target shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

const ACTION_TILE =
  "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-density border border-rule bg-panel px-1 text-center text-[13px] font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

const ACTION_LINK =
  "inline-flex min-h-target items-center justify-center rounded-density bg-action px-4 font-semibold text-action-ink hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

export function AnimalsScreen({
  propertyId,
  species,
  basePath = "/admin/animals",
  add = { label: "Add animal", href: "/admin/cattle?add=1" },
  glance,
  actions,
}: {
  readonly propertyId: Ulid;
  /** One species' page rather than every animal on the place. */
  readonly species?: AnimalGroup;
  /** Where this list lives, for the address its filters are kept in. */
  readonly basePath?: string;
  readonly add?: AddAction;
  /** The species' own at-a-glance panel, under the title. */
  readonly glance?: ReactNode;
  /** The species' common jobs, as big buttons. */
  readonly actions?: readonly QuickAction[];
}) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: flocks, loading: flocksLoading } = useRecords<Flock>("flocks", query);
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: eggLogs } = useRecords<EggLog>("eggLogs", query);

  const router = useRouter();
  const params = useSearchParams();
  const view = viewFrom(params);
  const group: AnimalGroup | "" = species ?? "";

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
    const href = query === "" ? basePath : `${basePath}?${query}`;
    router.replace(href, { scroll: false });
    // So Back from an animal returns to the list filtered as it was left.
    noteAddress(href);
  }

  const [search, setSearch] = useState("");
  const [showGone, setShowGone] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [adding, setAdding] = useState(false);
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
        eggLogs,
        now,
      }),
    [animals, flocks, adjustments, zones, assignments, health, breedings, calvings, eggLogs, now],
  );

  const mine = group === "" ? entries : entries.filter((entry) => entry.group === group);
  const here = mine.filter((entry) => entry.onFarm);
  const gone = mine.length - here.length;
  // Asking for a status — sold, dead — is asking to see the ones no longer here.
  const pool = showGone || view.status !== "" ? mine : here;
  const viewed = filterEntries(pool, view);

  // Counted before the search, so a chip's number is how many there are, not
  // how many happen to match what is half-typed.
  const counts = new Map<AnimalGroup, number>(
    GROUPS.map((key) => [key, viewed.filter((entry) => entry.group === key).length]),
  );

  const needle = search.trim().toLowerCase();
  const shown = viewed.filter((entry) => needle === "" || entry.haystack.includes(needle));
  const sections = groupEntries(shown, view.groupBy);
  const facts = viewFacts(view, zones);

  // What the filters offer: only what exists, so no choice leads to nothing.
  const kinds = [...new Set(mine.map((entry) => entry.kind))].sort();
  const statuses = [...new Set(mine.map((entry) => entry.status))].sort();
  // On a species page the chips are its classes, counted before the search.
  const kindCounts = new Map(
    kinds.map((kind) => [
      kind,
      filterEntries(pool, { ...view, kind: "" }).filter((entry) => entry.kind === kind).length,
    ]),
  );
  const title = group === "" ? "Animals" : GROUP_LABELS[group];
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

  const narrowed = needle !== "" || facts.length > 0;
  const addButton = (className: string, children: ReactNode) =>
    add.href !== undefined ? (
      <Link href={add.href} className={className}>
        {children}
      </Link>
    ) : (
      <button type="button" onClick={() => setAdding(true)} className={className}>
        {children}
      </button>
    );

  return (
    // Bottom clearance on a phone, so the floating button never sits on the
    // last row.
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      <header className="flex items-center justify-between gap-density">
        <SpeciesSwitcher
          propertyId={propertyId}
          current={isAnimalHome(basePath) ? basePath : DEFAULT_ANIMAL_HOME}
          detail={`${here.length} here`}
        />
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
            {addButton(
              ACTION_LINK,
              <>
                <span aria-hidden="true">+</span>&nbsp;{add.label}
              </>,
            )}
          </span>
        </div>
      </header>

      {actions === undefined || actions.length === 0 ? null : (
        <nav
          aria-label={`Quick actions for ${title.toLowerCase()}`}
          className="grid grid-cols-4 gap-2"
        >
          {actions.map((action) => (
            <Link key={action.label} href={action.href} className={ACTION_TILE}>
              <span aria-hidden="true" className="text-xl leading-none">
                {action.glyph}
              </span>
              {action.label}
            </Link>
          ))}
        </nav>
      )}

      {glance}

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

      {group === "" ? (
        // Each species chip opens that species' own page, with its own tools;
        // this list stays every animal on the place.
        <ChipRow label="Species">
          <Chip on onClick={() => {}}>
            All <span className="gf-numeric text-xs opacity-80">{pool.length}</span>
          </Chip>
          {GROUPS.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => (
            <Link key={key} href={GROUP_HOMES[key]} className={SPECIES_LINK}>
              {GROUP_LABELS[key]}{" "}
              <span className="gf-numeric text-xs opacity-80">{counts.get(key)}</span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </ChipRow>
      ) : kinds.length < 2 ? null : (
        <ChipRow label={`Filter ${title.toLowerCase()} by class`}>
          <Chip on={view.kind === ""} onClick={() => setView({ class: "" })}>
            All{" "}
            <span className="gf-numeric text-xs opacity-80">
              {filterEntries(pool, { ...view, kind: "" }).length}
            </span>
          </Chip>
          {kinds.map((kind) => (
            // Pressing the one already on goes back to all of them.
            <Chip
              key={kind}
              on={view.kind === kind}
              onClick={() => setView({ class: view.kind === kind ? "" : kind })}
            >
              {kind} <span className="gf-numeric text-xs opacity-80">{kindCounts.get(kind)}</span>
            </Chip>
          ))}
        </ChipRow>
      )}

      {narrowed ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
          <span>
            Showing {shown.length} of {pool.length}
            {facts.length === 0 ? "" : ` · ${facts.join(" · ")}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setView({ where: "", sex: "", status: "", class: "" });
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
            mine.length === 0
              ? group === ""
                ? "No animals yet"
                : `No ${title.toLowerCase()} yet`
              : needle !== ""
                ? `Nothing matches "${search}"`
                : "None match these filters"
          }
          detail={
            mine.length === 0
              ? `${add.label} and it shows up here.`
              : needle !== ""
                ? "Search looks at name and tag."
                : "Clear a filter to see more."
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
              aria-label={
                section.label === ""
                  ? group === ""
                    ? "Animals on this property"
                    : `${title} on this property`
                  : section.label
              }
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
            <Link href={logHref({ animals: selected, from: basePath })} className={ACTION_LINK}>
              Log for them
            </Link>
          )}
        </div>
      ) : (
        addButton(
          "fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden",
          <>
            <span aria-hidden="true" className="text-xl leading-none">
              +
            </span>
            {add.label}
          </>,
        )
      )}

      {adding && add.render !== undefined ? add.render(() => setAdding(false)) : null}
    </div>
  );
}
