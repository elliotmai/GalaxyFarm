"use client";

import { PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
import {
  seasonalCareDue,
  type Animal,
  type PastureCareLog,
  type Ulid,
  type WaterSource,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import { CarePanel } from "@/app/(admin)/admin/pastures/_components/care-panel";
import { WaterPanel } from "@/app/(admin)/admin/pastures/_components/water-panel";
import { ZonesPanel } from "@/app/(admin)/admin/pastures/_components/zones-panel";
import { useRecords } from "@/lib/local/use-records";

/**
 * Land (spec §7, `/admin/pastures`).
 *
 * Three things that are one subject: the places, the water they drink from,
 * and what has been put on the ground. They share a screen because they share
 * a question — a tank belongs to zones, a care log belongs to a zone, and the
 * freeze chore reads both — and splitting them across three routes would mean
 * three places to look before walking out.
 *
 * Reads happen once here and go down as props. Each panel subscribing
 * separately would open four live queries over the same two tables and redraw
 * them out of step.
 */
export function LandScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: zones, loading } = useRecords<Zone>("zones", query);
  const { records: water, loading: waterLoading } = useRecords<WaterSource>("waterSources", query);
  const { records: logs, loading: logsLoading } = useRecords<PastureCareLog>(
    "pastureCareLogs",
    query,
  );
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: animals } = useRecords<Animal>("animals", query);

  const live = zones.filter((zone) => zone.active);
  const resting = live.filter((zone) => zone.resting);
  const out = water.filter((source) => source.active);
  // Heaterless *and* out: a stowed tank cannot freeze anything (§6).
  const heaterless = out.filter((source) => !source.hasHeater);
  const due = seasonalCareDue(
    zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      active: zone.active,
    })),
    logs,
    new Date(),
  ).filter((item) => item.status === "due");

  return (
    <PageBody>
      <PageHeader
        eyebrow="Land"
        title="Pastures and water"
        subtitle="The places, the tanks they drink from, and what has gone on the ground."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Zones in use"
          value={live.length}
          tone="identity"
          hint={resting.length === 0 ? undefined : `${resting.length} resting`}
        />
        <Tile
          label="Tanks out"
          value={out.length}
          tone="action"
          hint={water.length === out.length ? undefined : `${water.length - out.length} stowed`}
        />
        <Tile
          label="Without heaters"
          value={heaterless.length}
          tone={heaterless.length > 0 ? "danger" : "calm"}
          emphasis={heaterless.length > 0}
          hint={heaterless.length > 0 ? "Named in the freeze alert" : "All heated"}
        />
        <Tile
          label="Seasonal work due"
          value={due.length}
          tone={due.length > 0 ? "danger" : "calm"}
          emphasis={due.length > 0}
          hint={due.length > 0 ? "Window open now" : "Nothing open"}
        />
      </div>

      <Tabs
        label="Land"
        tabs={[
          { id: "zones", label: "Zones" },
          { id: "water", label: "Water" },
          { id: "care", label: "Care log" },
        ]}
      >
        {(active) =>
          active === "zones" ? (
            <ZonesPanel
              zones={zones}
              water={water}
              assignments={assignments}
              animals={animals}
              loading={loading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "water" ? (
            <WaterPanel
              water={water}
              zones={zones}
              loading={waterLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : (
            <CarePanel
              zones={zones}
              logs={logs}
              loading={logsLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
