"use client";

import type { Ulid, Zone } from "@galaxy-farm/core";
import type { EggLog, FlockAdjustment } from "@galaxy-farm/module-poultry";

import { AnimalsScreen } from "@/app/(admin)/admin/animals/_components/animals-screen";
import {
  CHICKEN_ACTIONS,
  ChickensGlance,
  HORSE_ACTIONS,
  HorsesGlance,
  petActions,
  PetsGlance,
} from "@/app/(admin)/admin/animals/_components/species-glance";
import { FlockEditor } from "@/app/(admin)/admin/chickens/flock/_components/flock-editor";
import { HorseEditor } from "@/app/(admin)/admin/horses/_components/horse-editor";
import { PetEditor } from "@/app/(admin)/admin/pets/_components/pet-panel";
import { useRecords } from "@/lib/local/use-records";

/**
 * Each species' own page — Horses, Chickens, Dogs, Cats — on the herd page's
 * shape (V2 Animals, decision 44 in the spec).
 *
 * All four are the Animals screen with one species in it: the count, search,
 * Filter & group, that species' classes as chips, the list opening each
 * animal's own page, and Add. What differs is only how an animal is added,
 * which is each species' existing form, so there is still one way to write a
 * horse, a pet or a flock. The species' own tools (pens, feeding, breeding,
 * eggs, vet and medicine) sit in the strip above, where cattle's do.
 */

interface PageProps {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}

export function HorsesPage({ propertyId, actorId }: PageProps) {
  return (
    <AnimalsScreen
      propertyId={propertyId}
      species="horses"
      basePath="/admin/horses"
      glance={<HorsesGlance propertyId={propertyId} />}
      actions={HORSE_ACTIONS}
      add={{
        label: "Add a horse",
        render: (close) => (
          <HorseEditor
            horse={undefined}
            propertyId={propertyId}
            actorId={actorId}
            onClose={close}
          />
        ),
      }}
    />
  );
}

export function DogsPage({ propertyId, actorId }: PageProps) {
  return <PetsPage propertyId={propertyId} actorId={actorId} species="dog" />;
}

export function CatsPage({ propertyId, actorId }: PageProps) {
  return <PetsPage propertyId={propertyId} actorId={actorId} species="cat" />;
}

function PetsPage({
  propertyId,
  actorId,
  species,
}: PageProps & { readonly species: "dog" | "cat" }) {
  return (
    <AnimalsScreen
      propertyId={propertyId}
      species={species === "dog" ? "dogs" : "cats"}
      basePath={species === "dog" ? "/admin/pets/dogs" : "/admin/pets/cats"}
      glance={<PetsGlance propertyId={propertyId} species={species} />}
      actions={petActions(species)}
      add={{
        label: species === "dog" ? "Add a dog" : "Add a cat",
        render: (close) => (
          <PetEditor
            pet={undefined}
            species={species}
            // A new pet has no records yet, so its delete has nothing to name.
            health={[]}
            plans={[]}
            propertyId={propertyId}
            actorId={actorId}
            onClose={close}
          />
        ),
      }}
    />
  );
}

export function ChickensPage({ propertyId, actorId }: PageProps) {
  const query = { propertyId };
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: eggLogs } = useRecords<EggLog>("eggLogs", query);

  return (
    <AnimalsScreen
      propertyId={propertyId}
      species="chickens"
      basePath="/admin/chickens/flock"
      glance={<ChickensGlance propertyId={propertyId} />}
      actions={CHICKEN_ACTIONS}
      add={{
        label: "Add a flock",
        render: (close) => (
          <FlockEditor
            adjustments={adjustments}
            zones={zones}
            eggLogs={eggLogs}
            propertyId={propertyId}
            actorId={actorId}
            onClose={close}
          />
        ),
      }}
    />
  );
}
