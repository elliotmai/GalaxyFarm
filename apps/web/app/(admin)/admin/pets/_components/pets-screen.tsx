"use client";

import { useEffect, useState } from "react";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import {
  animalsFedBy,
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
import { nameList } from "@/lib/feed-lines";
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
  species,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /**
   * One species' care — Dog care, Cat care — each in its own species' strip,
   * so the way to the cats' vet visits never shows the dogs beside it.
   */
  readonly species?: "dog" | "cat";
}) {
  // `?tab=health` or `?tab=feeding` opens on that tab — the Medicine and
  // Rations buttons on the Dogs and Cats pages land here. Read off `window`
  // once, so the page needs no Suspense boundary.
  const [tab, setTab] = useState("pets");
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked === "health" || asked === "feeding") setTab(asked);
  }, []);

  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: health, loading: healthLoading } = useRecords<HealthRecord>(
    "healthRecords",
    query,
  );
  const { records: plans, loading: plansLoading } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const pets = petsOnFarm(animals).filter(
    (pet) => species === undefined || pet.species === species,
  );
  const petIds = new Set(pets.map((pet) => pet.id));
  const petHealth = health.filter((record) => petIds.has(record.animalId));
  // `animalsFedBy`, not `targetId`: a bowl two cats share is filed under one
  // of them, and the other has to find it or it reads as unfed.
  const petPlans = plans.filter(
    (plan) => plan.target === "animal" && animalsFedBy(plan).some((id) => petIds.has(id)),
  );

  const due = outstandingPetCare(careRecordsFor(petHealth), new Date());
  const overdue = due.filter((need) => need.status === "overdue");
  const unfed = pets.filter(
    (pet) => !petPlans.some((plan) => plan.active && animalsFedBy(plan).includes(pet.id)),
  );

  const nameOf = (id: Ulid) => {
    const pet = pets.find((held) => held.id === id);
    return pet === undefined ? "a pet" : displayName(pet);
  };

  const careful = pets.filter((pet) => pet.safetyLevel >= 4).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Animals"
        title={species === "dog" ? "Dog care" : species === "cat" ? "Cat care" : "Pet care"}
        subtitle={[
          `${pets.length} ${species ?? "pet"}${pets.length === 1 ? "" : "s"}`,
          due.length === 0 ? undefined : `${due.length} care due`,
          careful === 0 ? undefined : `${careful} handle with care`,
        ]
          .filter((part) => part !== undefined)
          .join(" · ")}
      />

      {/*
        Status by exception: one short line for each thing that is wrong, and
        nothing at all when nothing is. Overdue care is red and named, because
        it is the one a helper cannot fix by reading the guide; a pet with no
        ration is a gap in the guide, said once for all of them.
      */}
      {overdue.length === 0 && unfed.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Needs attention">
          {overdue.map((need) => (
            <li key={need.recordId} className="text-danger">
              <span className="font-semibold">{nameOf(need.animalId)}</span> — {need.label} overdue{" "}
              {Math.abs(need.daysUntil)} day{Math.abs(need.daysUntil) === 1 ? "" : "s"}
              <span className="text-muted">
                {" "}
                (due{" "}
                {need.dueOn.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                )
              </span>
            </li>
          ))}
          {unfed.length === 0 ? null : (
            <li className="text-action">
              No ration written for {nameList(unfed.map((pet) => displayName(pet)))} — the guide has
              nothing to say.
            </li>
          )}
        </ul>
      )}

      <Tabs
        label="Pets"
        activeTab={tab}
        onTabChange={setTab}
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
