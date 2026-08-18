"use client";

import { useState } from "react";

import { PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
import { addCalendarDays, startOfDay, type Ulid } from "@galaxy-farm/core";
import type {
  Bed,
  Crop,
  HarvestLog,
  Planting,
  PreservationLog,
  Variety,
} from "@galaxy-farm/module-garden";

import { HarvestLogPanel } from "@/app/(admin)/admin/garden/harvest/_components/harvest-log-panel";
import { PantryPanel } from "@/app/(admin)/admin/garden/harvest/_components/pantry-panel";
import { pantryShelf } from "@/lib/garden";
import { useRecords } from "@/lib/local/use-records";

/**
 * Harvest and preservation (spec §5.5, §7 `/admin/garden/harvest`).
 *
 * The pantry is the half that earns the screen. A harvest log is a diary and
 * gets read once; a pantry is an inventory and gets read every time somebody
 * plans a week of meals or wonders whether to can more tomatoes. So the shelf
 * is folded into lines — twelve entries of six jars is seventy-two jars of
 * salsa, not twelve things to scroll past — and the tiles above it count what
 * is on the shelf rather than what happened this month.
 */

/** How far back the "picked recently" tile looks. */
const RECENT_DAYS = 30;

export function HarvestScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: harvests, loading: harvestLoading } = useRecords<HarvestLog>(
    "harvestLogs",
    query,
  );
  const { records: pantry, loading: pantryLoading } = useRecords<PreservationLog>(
    "preservationLogs",
    query,
  );
  const { records: plantings } = useRecords<Planting>("plantings", query);
  const { records: varieties } = useRecords<Variety>("varieties", query);
  const { records: crops } = useRecords<Crop>("crops", query);
  const { records: beds } = useRecords<Bed>("beds", query);

  const [tab, setTab] = useState("pantry");

  const since = startOfDay(addCalendarDays(new Date(), -RECENT_DAYS));
  const recent = harvests.filter((log) => log.harvestedOn >= since);
  const shelf = pantryShelf(pantry);
  const jars = pantry
    .filter((log) => log.unit === "jar" || log.unit === "quart" || log.unit === "pint")
    .reduce((total, log) => total + log.quantity, 0);
  const places = new Set(
    pantry
      .map((log) => log.storageLocation?.trim())
      .filter((place): place is string => place !== undefined && place !== ""),
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="Land"
        title="Harvest & pantry"
        subtitle="What came off the beds, and what is on the shelf because of it."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="On the shelf"
          value={shelf.length}
          tone="identity"
          emphasis
          hint={shelf.length === 0 ? "Nothing put by yet" : "Distinct labels"}
        />
        <Tile
          label="Jars & bottles"
          value={Number.isInteger(jars) ? jars : jars.toFixed(1)}
          tone="calm"
          hint="Anything counted in jars, quarts or pints"
        />
        <Tile
          label={`Picked in ${RECENT_DAYS} days`}
          value={recent.length}
          tone="action"
          hint={
            harvests.length === recent.length ? "Harvest entries" : `${harvests.length} in total`
          }
        />
        <Tile
          label="Storage places"
          value={places.size}
          tone="neutral"
          hint={places.size === 0 ? "None named yet" : [...places].slice(0, 2).join(", ")}
        />
      </div>

      <Tabs
        label="Harvest"
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          { id: "pantry", label: "Pantry" },
          { id: "harvest", label: "Harvest log" },
        ]}
      >
        {(active) =>
          active === "pantry" ? (
            <PantryPanel
              pantry={pantry}
              harvests={harvests}
              plantings={plantings}
              varieties={varieties}
              crops={crops}
              loading={pantryLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : (
            <HarvestLogPanel
              harvests={harvests}
              pantry={pantry}
              plantings={plantings}
              beds={beds}
              varieties={varieties}
              crops={crops}
              loading={harvestLoading}
              propertyId={propertyId}
              actorId={actorId}
              onPreserve={() => setTab("pantry")}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
