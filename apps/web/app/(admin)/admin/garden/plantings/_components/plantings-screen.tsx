"use client";

import { useEffect, useState } from "react";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import type { Ulid, Zone } from "@galaxy-farm/core";
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
import { StatusLine } from "@/app/(admin)/admin/pastures/_components/land-kit";
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
 * one the rows are drawn from, which is the worst possible place for a
 * disagreement.
 */

/** How far ahead the season-plan tab counts a window as news. */
const WINDOW_LEAD_DAYS = 7;

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
  /** A bed the address asked to open — the layout's bed rows link here. */
  const [openBed, setOpenBed] = useState<Ulid | undefined>();

  // `?tab=beds&bed=<id>` opens that bed's editor; `?tab=care` or `?tab=plan`
  // opens on that tab. Read off `window` once, so the page needs no Suspense
  // boundary — the same convention as the pets screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("tab");
    if (asked === "plantings" || asked === "beds" || asked === "care" || asked === "plan") {
      setTab(asked);
    }
    const bed = params.get("bed");
    if (bed !== null && bed !== "") {
      setTab("beds");
      setOpenBed(bed as Ulid);
    }
  }, []);

  const now = new Date();

  const live = plantings.filter(
    (planting) => planting.status === "growing" || planting.status === "harvesting",
  );
  const bedsInUse = new Set(live.map((planting) => planting.bedId));
  const windows = plantingWindows(planned, now, WINDOW_LEAD_DAYS);
  const openNow = windows.filter((window) => window.open);
  const activeBeds = beds.filter((bed) => bed.active).length;

  // The facts, beside the title — what four tiles used to say, minus the
  // ones that were zero or "From the season plan" most days.
  const facts =
    beds.length === 0
      ? "No beds yet"
      : `${live.length} in the ground · ${bedsInUse.size} of ${activeBeds} beds in use`;

  return (
    <PageBody>
      <PageHeader eyebrow="Farm" title="Plantings" subtitle={facts} />

      {/*
        Status by exception: the one thing on this screen with a deadline. Not
        drawn on the plan tab, which lists the same windows by name.
      */}
      {openNow.length === 0 || tab === "plan" ? null : (
        <StatusLine tone="action">
          {openNow.length} planting window{openNow.length === 1 ? "" : "s"} open now.{" "}
          <button
            type="button"
            onClick={() => setTab("plan")}
            className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
          >
            See the plan
          </button>
        </StatusLine>
      )}

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
            adornment: openNow.length === 0 ? undefined : openNow.length,
          },
        ]}
      >
        {(active) =>
          active === "plantings" ? (
            <PlantingsPanel
              // Remounted when a bed row sends us here, so the form opens on
              // the bed whose row was tapped rather than on whatever was
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
              openBedId={openBed}
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
