"use client";

import Link from "next/link";

import { Badge, Card, DataTable, EmptyState, SafetyBadge, type Column } from "@galaxy-farm/ui";
import {
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

export function Dashboard({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: zones, loading: zonesLoading } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: water } = useRecords<WaterSource>("waterSources", query);

  if (zonesLoading) {
    return <p className="text-muted">Loading the farm…</p>;
  }

  if (zones.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        detail="Run pnpm db:seed to load the property, or add a zone to get started."
      />
    );
  }

  return (
    <div className="flex flex-col gap-density">
      <h1 className="font-heading text-2xl font-semibold text-ink">Today</h1>

      {/*
        First, above the pen board. §12 decision 5 pulled the calving watch
        into Phase 1 because there is a pregnancy already underway, and a
        card that has to be scrolled to is a card nobody reads at 2am.
      */}
      <CalvingWatchCard propertyId={propertyId} />

      <div className="grid gap-density md:grid-cols-2">
        <PenBoard zones={zones} animals={animals} assignments={assignments} />
        <FreezeWatch zones={zones} water={water} />
      </div>
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
 * The safety column is the *effective* level — the higher of the zone's own
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

  const columns: readonly Column<PenRow>[] = [
    { key: "zone", header: "Zone", render: (row) => row.zone.name },
    {
      key: "occupants",
      header: "Who",
      render: (row) =>
        row.occupants.length === 0 ? (
          <span className="text-muted">Empty</span>
        ) : (
          row.occupants.map((animal) => animal.name ?? animal.tagNumber ?? "Untagged").join(", ")
        ),
    },
    {
      key: "safety",
      header: "Care",
      render: (row) => (
        <SafetyBadge
          level={row.safety}
          size="compact"
          {...(row.safety > row.zone.baselineSafetyLevel
            ? { raisedBy: row.occupants.map((a) => a.name ?? "an occupant").join(", ") }
            : {})}
        />
      ),
    },
  ];

  return (
    <Card title="Pen board" actions={<Badge tone="neutral">{rows.length} zones</Badge>}>
      <DataTable
        caption="Zones, who is in them, and how careful to be"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.zone.id}
      />
    </Card>
  );
}

/**
 * Which tanks freeze, and what stops drinking when they do.
 *
 * One row per tank, not per zone. Four tanks serve eight zones here, one of
 * them serving three — a per-zone list would send someone to the same trough
 * three times on a freeze morning, and a chore list that does that stops being
 * trusted.
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

  const vulnerable = targets.filter((target) => target.vulnerable);

  return (
    <Card
      title="Freeze watch"
      actions={
        vulnerable.length > 0 ? (
          <Badge tone="danger">{vulnerable.length} without heaters</Badge>
        ) : (
          <Badge tone="calm">All heated</Badge>
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
              <span className="flex items-center gap-2 text-density text-ink">
                {target.waterSource.name}
                {target.vulnerable ? <Badge tone="danger">No heater</Badge> : null}
              </span>
              <span className="text-sm text-muted">
                Serves {target.zones.map((zone) => zone.name).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-density text-sm text-muted">
        One check per tank, not per zone.{" "}
        <Link href="/admin/map" className="text-action underline underline-offset-2">
          See them on the map
        </Link>
      </p>
    </Card>
  );
}
