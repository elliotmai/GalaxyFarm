"use client";

import { useState } from "react";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  isStaleSeed,
  type Crop,
  type PlannedPlanting,
  type Planting,
  type SeedInventory,
  type Variety,
} from "@galaxy-farm/module-garden";

import { CatalogPanel } from "@/app/(admin)/admin/garden/seeds/_components/catalog-panel";
import { SeedBoxPanel } from "@/app/(admin)/admin/garden/seeds/_components/seed-box-panel";
import { StatusLine } from "@/app/(admin)/admin/pastures/_components/land-kit";
import { useRecords } from "@/lib/local/use-records";

/**
 * Seed (spec §5.5, §7 `/admin/garden/seeds`).
 *
 * The number that earns a line at the top of this screen is the stale one. Everything
 * else here is a list somebody browses in January; "nine of these want a
 * germination test before you count on them" is the fact that changes what
 * gets ordered, and it is invisible unless something works it out — a packet
 * does not look two years old.
 *
 * Every read happens once here and goes down as props. Two panels each opening
 * their own live query over `varieties` would redraw out of step, and the crop
 * named on a seed card would disagree with the catalogue that produced it.
 */

export function SeedsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: crops, loading: cropsLoading } = useRecords<Crop>("crops", query);
  const { records: varieties, loading: varietiesLoading } = useRecords<Variety>("varieties", query);
  const { records: seed, loading: seedLoading } = useRecords<SeedInventory>("seedInventory", query);
  // Only so the catalogue can say what a variety's deletion would run into
  // (§4.5 clause 3) — a variety in the ground is not one you can quietly drop.
  const { records: plantings } = useRecords<Planting>("plantings", query);
  const { records: planned } = useRecords<PlannedPlanting>("plannedPlantings", query);

  const [tab, setTab] = useState("box");

  const now = new Date();
  const stale = seed.filter((entry) => isStaleSeed(entry, now));
  const withSeed = new Set(seed.map((entry) => entry.varietyId));
  // What four tiles used to say, as facts beside the title — kept short, so
  // a big seed box does not push the line past a fact into an explanation.
  const facts = [
    `${seed.length} in the box`,
    `${withSeed.size} of ${varieties.length} varieties`,
    `${crops.length} crop${crops.length === 1 ? "" : "s"}`,
  ].join(" · ");

  return (
    <PageBody>
      <PageHeader eyebrow="Farm" title="Seed" subtitle={facts} />

      {/* The stale count earns its line everywhere but the box, which says
          it again with the packets beside it. */}
      {stale.length === 0 || tab === "box" ? null : (
        <StatusLine tone="danger">
          {stale.length} worth a germination test.{" "}
          <button
            type="button"
            onClick={() => setTab("box")}
            className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
          >
            See the box
          </button>
        </StatusLine>
      )}

      <Tabs
        label="Seed"
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          { id: "box", label: "Seed box" },
          { id: "catalog", label: "Crops & varieties" },
        ]}
      >
        {(active) =>
          active === "box" ? (
            <SeedBoxPanel
              seed={seed}
              varieties={varieties}
              crops={crops}
              loading={seedLoading || varietiesLoading}
              propertyId={propertyId}
              actorId={actorId}
              onNeedsCatalog={() => setTab("catalog")}
            />
          ) : (
            <CatalogPanel
              crops={crops}
              varieties={varieties}
              seed={seed}
              plantings={plantings}
              planned={planned}
              loading={cropsLoading || varietiesLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
