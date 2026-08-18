"use client";

import { useState } from "react";

import { PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
import { addCalendarDays, startOfDay, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  plantingWindows,
  type Bed,
  type Crop,
  type GardenCareLog,
  type HarvestLog,
  type PlannedPlanting,
  type Planting,
  type SeasonPlan,
  type Variety,
} from "@galaxy-farm/module-garden";

import { BedsPanel } from "@/app/(admin)/admin/garden/plantings/_components/beds-panel";
import { CareLogPanel } from "@/app/(admin)/admin/garden/plantings/_components/care-log-panel";
import { PlantingsPanel } from "@/app/(admin)/admin/garden/plantings/_components/plantings-panel";
import { SeasonPlanPanel } from "@/app/(admin)/admin/garden/plantings/_components/season-plan-panel";
import { useRecords } from "@/lib/local/use-records";

/**
 * Plantings (spec §5.5, §7 `/admin/garden/plantings`).
 *
 * Four tabs for one loop: the beds, what went in them, what was done to it,
 * and what is meant to go in next. The season plan sits on this screen rather
 * than on one of its own because the one tap that turns a plan into a real
 * planting has to land somewhere the result is visible — converting a plan on
 * a page that does not show plantings would leave somebody wondering whether
 * anything happened.
 *
 * Every read happens once here. Four panels each opening their own live query
 * over `plantings` would give the rotation guard a different history from the
 * one the cards are drawn from, which is the worst possible place for a
 * disagreement.
 */

/** How far ahead the season-plan tab counts a window as news. */
const WINDOW_LEAD_DAYS = 7;

/** The window the care-log tile looks back over. */
const RECENT_DAYS = 30;

export function PlantingsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: beds, loading: bedsLoading } = useRecords<Bed>("beds", query);
  const { records: plantings, loading: plantingsLoading } = useRecords<Planting>(
    "plantings",
    query,
  );
  const { records: care, loading: careLoading } = useRecords<GardenCareLog>(
    "gardenCareLogs",
    query,
  );
  const { records: plans, loading: plansLoading } = useRecords<SeasonPlan>("seasonPlans", query);
  const { records: planned } = useRecords<PlannedPlanting>("plannedPlantings", query);
  const { records: varieties } = useRecords<Variety>("varieties", query);
  const { records: crops } = useRecords<Crop>("crops", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  // Only to say what a planting's deletion would take with it (§4.5 clause 3).
  const { records: harvests } = useRecords<HarvestLog>("harvestLogs", query);

  const [tab, setTab] = useState("plantings");
  const [focusedBed, setFocusedBed] = useState<Ulid | undefined>();

  const now = new Date();
  const since = startOfDay(addCalendarDays(now, -RECENT_DAYS));

  const live = plantings.filter(
    (planting) => planting.status === "growing" || planting.status === "harvesting",
  );
  const bedsInUse = new Set(live.map((planting) => planting.bedId));
  const windows = plantingWindows(planned, now, WINDOW_LEAD_DAYS);
  const openNow = windows.filter((window) => window.open);
  const recentCare = care.filter((entry) => entry.performedOn >= since);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Land"
        title="Plantings"
        subtitle="The beds, what is in them, what has been done to it, and what the season plan says goes in next."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="In the ground"
          value={live.length}
          tone="identity"
          emphasis
          hint={
            beds.length === 0
              ? "No beds yet"
              : `${bedsInUse.size} of ${beds.filter((bed) => bed.active).length} beds in use`
          }
        />
        <Tile
          label="Windows open"
          value={openNow.length}
          tone={openNow.length > 0 ? "action" : "neutral"}
          emphasis={openNow.length > 0}
          hint={
            windows.length === openNow.length
              ? "From the season plan"
              : `${windows.length - openNow.length} more inside ${WINDOW_LEAD_DAYS} days`
          }
        />
        <Tile
          label={`Care in ${RECENT_DAYS} days`}
          value={recentCare.length}
          tone="calm"
          hint="Water, weeding, feeding, spray"
        />
        <Tile
          label="Beds"
          value={beds.filter((bed) => bed.active).length}
          tone="neutral"
          hint={
            beds.length === beds.filter((bed) => bed.active).length
              ? undefined
              : `${beds.length - beds.filter((bed) => bed.active).length} switched off`
          }
        />
      </div>

      <Tabs
        label="Plantings"
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          { id: "plantings", label: "In the ground" },
          { id: "beds", label: "Beds" },
          { id: "care", label: "Care log" },
          {
            id: "plan",
            label: "Season plan",
            adornment:
              openNow.length === 0 ? undefined : (
                <span className="gf-numeric text-xs text-action">{openNow.length}</span>
              ),
          },
        ]}
      >
        {(active) =>
          active === "plantings" ? (
            <PlantingsPanel
              // Remounted when a bed card sends us here, so the form opens on
              // the bed whose card was tapped rather than on whatever was
              // chosen last.
              key={focusedBed ?? "any"}
              plantings={plantings}
              beds={beds}
              varieties={varieties}
              crops={crops}
              harvests={harvests}
              care={care}
              loading={plantingsLoading || bedsLoading}
              propertyId={propertyId}
              actorId={actorId}
              {...(focusedBed === undefined ? {} : { focusedBedId: focusedBed })}
              onNeedsBeds={() => setTab("beds")}
            />
          ) : active === "beds" ? (
            <BedsPanel
              beds={beds}
              zones={zones}
              plantings={plantings}
              care={care}
              loading={bedsLoading}
              propertyId={propertyId}
              actorId={actorId}
              onPlantHere={(bed) => {
                setFocusedBed(bed.id);
                setTab("plantings");
              }}
            />
          ) : active === "care" ? (
            <CareLogPanel
              care={care}
              beds={beds}
              plantings={plantings}
              varieties={varieties}
              crops={crops}
              loading={careLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : (
            <SeasonPlanPanel
              plans={plans}
              planned={planned}
              beds={beds}
              varieties={varieties}
              crops={crops}
              loading={plansLoading}
              propertyId={propertyId}
              actorId={actorId}
              leadDays={WINDOW_LEAD_DAYS}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
