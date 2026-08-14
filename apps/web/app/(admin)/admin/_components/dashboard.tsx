"use client";

import Link from "next/link";

import {
  Card,
  CardGrid,
  EmptyState,
  Pill,
  RecordCard,
  SafetyBadge,
  SkeletonScreen,
  Tile,
} from "@galaxy-farm/ui";
import {
  coversToFit,
  effectiveSafetyLevel,
  freezeCheckTargets,
  type Animal,
  type SafetyLevel,
  type Ulid,
  type WaterSource,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import { CalvingWatchCard } from "@/app/(admin)/admin/_components/calving-watch-card";
import { ChoresCard } from "@/app/(admin)/admin/_components/chores-card";
import { useRecords } from "@/lib/local/use-records";

/**
 * The admin dashboard.
 *
 * Everything here is derived from records rather than entered — the pen board
 * from assignments, the effective safety level from the animals standing in a
 * zone, the freeze list from which tanks lack heaters. §2: derive, don't
 * duplicate. A dashboard whose numbers are typed in is a dashboard that goes
 * stale the first busy week.
 *
 * Reads come from the device's store, so this renders at the same speed with
 * no signal as with five bars.
 */

export function Dashboard({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: zones, loading: zonesLoading } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: water } = useRecords<WaterSource>("waterSources", query);

  // The heading stays put through every state. A page whose `h1` only exists
  // once its data arrives has no heading at all while it is loading and none
  // when it is empty — which is the state a new install spends its first week
  // in, and the state the e2e suite found it in.
  const heading = <h1 className="text-ink">Today</h1>;

  if (zonesLoading) {
    // The layout is known long before the records are, so draw it. A line of
    // grey text told the reader nothing about what was coming and let the page
    // jump the moment it did — this holds the geometry the tiles will land in.
    return <SkeletonScreen title="Today" stats={4} rows={5} />;
  }

  const inUse = new Set(assignments.filter((a) => a.periodTo === undefined).map((a) => a.zoneId))
    .size;
  /**
   * Tanks that are out with nothing over them.
   *
   * Counted on the cover rather than on the heater, because no tank here has a
   * heater and none is going to — a tile reading "4, no heater fitted" every
   * day of the year is a tile that stops being looked at. A cover is the thing
   * that changes and the thing somebody can go and do.
   */
  const uncovered = water.filter((source) => source.active && source.cover !== "on").length;

  if (zones.length === 0) {
    return (
      <div className="flex flex-col gap-density">
        {heading}
        <EmptyState
          title="Nothing here yet"
          detail="Run pnpm db:seed to load the property, or add a zone to get started."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-density">
      {heading}

      {/*
        First, above the pen board. §12 decision 5 pulled the calving watch
        into Phase 1 because there is a pregnancy already underway, and a
        card that has to be scrolled to is a card nobody reads at 2am.
      */}
      <CalvingWatchCard propertyId={propertyId} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/*
          Cattle, not every animal on the place. One Animal model serves every
          species (§2), so the unfiltered list is the herd plus the flock, the
          dogs and the horses — and a tile labelled "Cattle" that counts the
          hens is wrong in the quietest possible way: it reads as a plausible
          number and is the figure somebody repeats out loud.
        */}
        <Tile
          label="Cattle"
          value={animals.filter((a) => a.species === "cattle" && a.status === "active").length}
          tone="identity"
        />
        <Tile
          label="Pens in use"
          value={inUse}
          hint={`of ${zones.filter((z) => z.active).length} active`}
        />
        <Tile
          label="Tanks uncovered"
          value={uncovered}
          tone={uncovered > 0 ? "danger" : "calm"}
          emphasis={uncovered > 0}
          hint={uncovered > 0 ? "Nothing over them" : "All covered"}
        />
        <Tile label="Zones resting" value={zones.filter((z) => z.resting).length} tone="calm" />
      </div>

      {/*
        Above the pen board, because it is the card somebody acts on. The pen
        board answers "where is everything"; this one answers "what has not
        been done yet", and that is the question being asked on the way out of
        the door.
      */}
      <ChoresCard propertyId={propertyId} actorId={actorId} />

      <PenBoard zones={zones} animals={animals} assignments={assignments} />
      <FreezeWatch zones={zones} water={water} />
    </div>
  );
}

interface PenRow {
  readonly zone: Zone;
  readonly occupants: readonly Animal[];
  readonly safety: SafetyLevel;
}

/**
 * Who is where, and how careful to be.
 *
 * Cards rather than a table (§8). A table is the right shape for comparing
 * forty rows on one number; this is nine pens where the question is "what is
 * in this one and do I need to be careful", which is three facts about each
 * and no comparison at all. The accent edge carries the safety level, so a pen
 * holding a fresh cow is findable by colour before anybody reads a word.
 *
 * The safety shown is the *effective* level — the higher of the zone's own
 * baseline and whatever is standing in it. A quiet pen holding a fresh cow is
 * not a quiet pen, and a board that showed the baseline would say it was.
 */
function PenBoard({
  zones,
  animals,
  assignments,
}: {
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly assignments: readonly ZoneAssignment[];
}) {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));

  const rows: PenRow[] = zones
    .filter((zone) => zone.active)
    .map((zone) => {
      // The open assignment is the current one — a closed period is history,
      // and history is never overwritten (§5.1).
      const occupants = assignments
        .filter((a) => a.zoneId === zone.id && a.periodTo === undefined)
        .map((a) => byId.get(a.animalId))
        .filter((animal): animal is Animal => animal !== undefined);

      return {
        zone,
        occupants,
        safety: effectiveSafetyLevel(
          zone.baselineSafetyLevel,
          occupants.map((animal) => animal.safetyLevel),
        ),
      };
    });

  const occupied = rows.filter((row) => row.occupants.length > 0);

  return (
    <section className="flex flex-col gap-density">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-ink">Pen board</h2>
        <span className="flex gap-1.5">
          <Pill tone="action" dot>
            {occupied.length} in use
          </Pill>
          <Pill>{rows.length - occupied.length} empty</Pill>
        </span>
      </div>

      <CardGrid columns={3}>
        {rows.map((row) => {
          const raised = row.safety > row.zone.baselineSafetyLevel;

          return (
            <RecordCard
              key={row.zone.id}
              title={row.zone.name}
              subtitle={row.zone.resting ? "Resting" : row.zone.indoor ? "Indoor" : undefined}
              // Level 3 and up is the point at which somebody should not walk
              // in without thinking, so that is where the card turns.
              tone={row.safety >= 4 ? "danger" : row.safety >= 3 ? "identity" : "calm"}
              actions={
                <SafetyBadge
                  level={row.safety}
                  size="compact"
                  {...(raised
                    ? { raisedBy: row.occupants.map((a) => a.name ?? "an occupant").join(", ") }
                    : {})}
                />
              }
              meta={
                row.occupants.length === 0 ? (
                  <Pill>Empty</Pill>
                ) : (
                  row.occupants.map((animal) => (
                    <Pill key={animal.id} tone={animal.safetyLevel >= 3 ? "danger" : "neutral"}>
                      {animal.name ?? animal.tagNumber ?? "Untagged"}
                    </Pill>
                  ))
                )
              }
            />
          );
        })}
      </CardGrid>
    </section>
  );
}

/**
 * Which tanks freeze, and what stops drinking when they do.
 *
 * One row per tank, not per zone. Four tanks serve eight zones here, one of
 * them serving three — a per-zone list would send someone to the same trough
 * three times on a freeze morning, and a chore list that does that stops being
 * trusted.
 *
 * The card leads with the covers because they are the only part of this
 * anybody can act on ahead of time: no tank here is heated, so "without
 * heaters" is a constant, and a constant at the top of a watch card is
 * furniture. A cover that is off is a job, and it has to be done before the
 * cold arrives rather than after.
 */
function FreezeWatch({
  zones,
  water,
}: {
  readonly zones: readonly Zone[];
  readonly water: readonly WaterSource[];
}) {
  const targets = freezeCheckTargets(
    water,
    zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      waterSourceIds: zone.waterSourceIds,
      active: zone.active,
    })),
  );

  const toFit = coversToFit(targets);
  /**
   * "Covers on" has to mean there are covers and they are on.
   *
   * Said over a set of tanks that have no covers at all it is reassurance
   * nobody earned — the honest reading of that state is that there is nothing
   * to put on, and the ice gets broken instead.
   */
  const fitted = targets.filter((target) => target.waterSource.cover === "on").length;

  return (
    <Card
      title="Freeze watch"
      actions={
        toFit.length > 0 ? (
          <Pill tone="danger" dot>
            {toFit.length} cover{toFit.length === 1 ? "" : "s"} to put on
          </Pill>
        ) : fitted > 0 ? (
          <Pill tone="calm">Covers on</Pill>
        ) : (
          <Pill tone="neutral">No covers to put on</Pill>
        )
      }
    >
      {targets.length === 0 ? (
        <EmptyState
          title="No tanks in use"
          detail="Every water source is either stowed or serving no active zone."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {targets.map((target) => (
            <li key={target.waterSource.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-density text-ink">
                {target.waterSource.name}
                {target.needsCover ? <Pill tone="danger">Cover off</Pill> : null}
                {target.waterSource.cover === "on" ? <Pill tone="calm">Covered</Pill> : null}
                {target.vulnerable ? <Pill tone="neutral">No heater</Pill> : null}
              </span>
              <span className="text-sm text-muted">
                Serves {target.zones.map((zone) => zone.name).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-density text-sm text-muted">
        One check per tank, not per zone. Covers go on the evening before; the ice still gets
        checked in the morning.{" "}
        <Link href="/admin/pastures" className="text-action underline underline-offset-2">
          Manage the tanks
        </Link>
      </p>
    </Card>
  );
}
