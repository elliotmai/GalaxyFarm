"use client";

import { useState } from "react";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
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
import { StatusLine } from "@/app/(admin)/admin/pastures/_components/land-kit";
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
  initialZoneId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** `?zone=`: open on the Zones tab with that zone's editor up. */
  readonly initialZoneId?: Ulid | undefined;
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

  // Areas are not counted: North is four pens with a name on them, not a fifth
  // place, and a count that says five when somebody can walk to four is a
  // count they stop reading.
  const live = zones.filter((zone) => zone.active && zone.type !== "area");
  const resting = live.filter((zone) => zone.resting);
  const out = water.filter((source) => source.active);
  /**
   * Covers waiting to go on, among the tanks that are out.
   *
   * This is the line rather than a heaterless count, because a heaterless
   * count on this place reads "4" every day of the year and there is nothing
   * to do about it — no tank here has a heater and none is wanted. What
   * changes, and what somebody can act on before a cold night, is the covers.
   */
  const toFit = out.filter((source) => source.cover === "off");
  const uncovered = out.filter((source) => (source.cover ?? "none") === "none");
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

  const [tab, setTab] = useState("zones");

  const showDue = due.length > 0 && tab !== "care";
  const showCovers = toFit.length > 0 && tab !== "water";

  // The facts, beside the title. Resting is the only qualifier worth saying,
  // because it changes where animals may go today.
  const facts = [
    `${live.length} zone${live.length === 1 ? "" : "s"}`,
    resting.length === 0 ? undefined : `${resting.length} resting`,
    `${out.length} tank${out.length === 1 ? "" : "s"} out`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <PageBody>
      <PageHeader eyebrow="Farm" title="Pastures and water" subtitle={facts} />

      {/*
        Status by exception. The old row of four tiles said "All fitted" and
        "Nothing open" most days of the year; what is left is one line for each
        thing somebody can act on, and each line is the way to it — not drawn
        on the tab that already lists the same thing by name.
      */}
      {!showDue && !showCovers ? null : (
        <div className="flex flex-col gap-1">
          {!showDue ? null : (
            <StatusLine tone="danger">
              {due.length} seasonal job{due.length === 1 ? "" : "s"} due now.{" "}
              <JumpTo onClick={() => setTab("care")}>See care</JumpTo>
            </StatusLine>
          )}
          {!showCovers ? null : (
            <StatusLine tone="action">
              {toFit.length} cover{toFit.length === 1 ? "" : "s"} to put on before the next hard
              freeze
              {uncovered.length === 0 ? "" : ` · ${uncovered.length} with no cover at all`}.{" "}
              <JumpTo onClick={() => setTab("water")}>See tanks</JumpTo>
            </StatusLine>
          )}
        </div>
      )}

      <Tabs
        label="Land"
        activeTab={tab}
        onTabChange={setTab}
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
              initialZoneId={initialZoneId}
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

/** The link at the end of a status line, to the tab that deals with it. */
function JumpTo({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
    >
      {children}
    </button>
  );
}
