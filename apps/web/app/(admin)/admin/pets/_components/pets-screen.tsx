"use client";

import { Callout, PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
import {
  displayName,
  type Animal,
  type Contact,
  type FeedingPlan,
  type Ulid,
} from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { outstandingPetCare, petsOnFarm } from "@galaxy-farm/module-pets";

import { PetFeedingPanel } from "@/app/(admin)/admin/pets/_components/pet-feeding-panel";
import { PetHealthPanel } from "@/app/(admin)/admin/pets/_components/pet-health-panel";
import { PetPanel } from "@/app/(admin)/admin/pets/_components/pet-panel";
import { careRecordsFor } from "@/lib/pet-care";
import { useRecords } from "@/lib/local/use-records";

/**
 * Pets (spec §5.8, §7).
 *
 * Three tabs over one subject, the same shape the Land screen takes: who lives
 * here, what the vet has done, and what they eat. They share a screen because
 * the housesitter guide reads all three at once, and because splitting them
 * across routes would mean three places to look before going away for a
 * weekend.
 *
 * **Health records come from `module-cattle`.** The entity is species-agnostic
 * — a date, a product, a vet, a booster — and §5.8 says in as many words that a
 * pet reuses it. It lives in the cattle module because that is where the herd
 * needed it first; `apps/web` is the composition root and the one place the
 * two are allowed to meet (§4.1).
 *
 * The reads happen here and go down as props. Four live queries opened
 * separately by three panels would redraw them out of step.
 */
export function PetsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: health, loading: healthLoading } = useRecords<HealthRecord>(
    "healthRecords",
    query,
  );
  const { records: plans, loading: plansLoading } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const pets = petsOnFarm(animals);
  const petIds = new Set(pets.map((pet) => pet.id));
  const petHealth = health.filter((record) => petIds.has(record.animalId));
  const petPlans = plans.filter((plan) => plan.target === "animal" && petIds.has(plan.targetId));

  const due = outstandingPetCare(careRecordsFor(petHealth), new Date());
  const overdue = due.filter((need) => need.status === "overdue");
  const unfed = pets.filter(
    (pet) => !petPlans.some((plan) => plan.targetId === pet.id && plan.active),
  );

  const nameOf = (id: Ulid) => {
    const pet = pets.find((held) => held.id === id);
    return pet === undefined ? "a pet" : displayName(pet);
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow="People & places"
        title="Pets"
        subtitle="The dogs and the cats — what they eat, what they are on, and what a helper needs to know."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pets" value={pets.length} tone="identity" />
        <Tile
          label="Care due"
          value={due.length}
          tone={overdue.length > 0 ? "danger" : due.length > 0 ? "action" : "calm"}
          emphasis={overdue.length > 0}
          hint={overdue.length > 0 ? `${overdue.length} overdue` : "Next fortnight"}
        />
        <Tile
          label="Without a ration"
          value={unfed.length}
          tone={unfed.length > 0 ? "action" : "calm"}
          hint={unfed.length > 0 ? "Guide has nothing to say" : "All written down"}
        />
        <Tile
          label="Needing care"
          value={pets.filter((pet) => pet.safetyLevel >= 4).length}
          tone={pets.some((pet) => pet.safetyLevel >= 4) ? "danger" : "calm"}
          hint="Level 4 and up"
        />
      </div>

      {overdue.length === 0 ? null : (
        <Callout tone="danger" title="Overdue">
          <ul className="flex flex-col gap-1">
            {overdue.map((need) => (
              <li key={need.recordId}>
                {nameOf(need.animalId)} — {need.label}, due{" "}
                {need.dueOn.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}{" "}
                ({Math.abs(need.daysUntil)} day{Math.abs(need.daysUntil) === 1 ? "" : "s"} ago)
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Tabs
        label="Pets"
        tabs={[
          { id: "pets", label: "Who lives here" },
          { id: "health", label: "Vet and medicine" },
          { id: "feeding", label: "Feeding" },
        ]}
      >
        {(active) =>
          active === "pets" ? (
            <PetPanel
              pets={pets}
              health={petHealth}
              plans={petPlans}
              contacts={contacts}
              feeds={feeds}
              loading={loading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "health" ? (
            <PetHealthPanel
              pets={pets}
              records={petHealth}
              contacts={contacts}
              loading={healthLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : (
            <PetFeedingPanel
              pets={pets}
              plans={petPlans}
              feeds={feeds}
              loading={plansLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
