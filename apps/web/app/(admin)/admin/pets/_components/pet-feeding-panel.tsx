"use client";

import { useState } from "react";

import { Button, EmptyState, PlusIcon } from "@galaxy-farm/ui";
import { displayName, type Animal, type FeedingPlan, type Ulid } from "@galaxy-farm/core";
import { suits, type FeedType } from "@galaxy-farm/module-feed";

import { FeedingPlanEditor, PlanRows } from "@/app/(admin)/_components/feeding-plan-editor";
import { plansFeeding } from "@/lib/pet-care";

/**
 * The household's feeding plans, pet by pet (spec §5.8, decision 49).
 *
 * Pets reuse the same feeding plans as the herd, written with the same editor,
 * so a gecko's crickets and a dog's kibble land in the same shed, the same
 * run-out dates and the same sitter guide as the hay. The editor knows a pet:
 * it offers pet foods, bowls and dishes, and asks where in words — a pet has
 * no zone.
 *
 * A plan two cats share shows under both of them, because it names both.
 */
export function PetFeedingPanel({
  pets,
  plans,
  feeds,
  loading,
  propertyId,
  actorId,
}: {
  readonly pets: readonly Animal[];
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  /** Held by id: a sync pull mid-edit replaces every record in the list. */
  const [editor, setEditor] = useState<
    { readonly planId: Ulid } | { readonly forPet: Animal } | undefined
  >();
  const editingPlan =
    editor !== undefined && "planId" in editor
      ? plans.find((plan) => plan.id === editor.planId)
      : undefined;

  if (loading) return <p className="text-muted">Loading feeding plans…</p>;

  // Said once, above the pets, when the catalogue has nothing any of them eat.
  const anyFood = feeds.some(
    (feed) => feed.active && pets.some((pet) => suits(feed.category, pet.species)),
  );

  return (
    <div className="flex flex-col gap-density">
      {pets.length > 0 && !anyFood ? (
        <p className="text-sm text-danger">
          No pet food in the catalogue yet — add the kibble, wet food or crickets on Farm › Feed ›
          Shed first.
        </p>
      ) : null}

      {pets.length === 0 ? (
        <EmptyState title="No pets yet" detail="Add a pet before writing what it eats." />
      ) : (
        pets.map((pet) => {
          const mine = plansFeeding(pet.id, plans);
          const name = displayName(pet);

          return (
            <section key={pet.id} aria-label={`${name}'s feeding`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="gf-label">{name}</h2>
                <Button
                  variant="ghost"
                  aria-haspopup="dialog"
                  aria-label={`Add a feeding plan for ${name}`}
                  onClick={() => setEditor({ forPet: pet })}
                >
                  <PlusIcon />
                  Feeding plan
                </Button>
              </div>
              {mine.length === 0 ? (
                // The guide will say so too, which is the same as telling a
                // helper to guess — so it is said in the action colour.
                <p className="text-sm text-action">Nothing written down.</p>
              ) : (
                <PlanRows
                  label={`${name}'s feeding plans`}
                  plans={mine}
                  feeds={feeds}
                  animals={pets}
                  onOpen={(plan) => setEditor({ planId: plan.id })}
                />
              )}
            </section>
          );
        })
      )}

      {editor === undefined || ("planId" in editor && editingPlan === undefined) ? null : (
        <FeedingPlanEditor
          key={editingPlan?.id ?? ("forPet" in editor ? `new:${editor.forPet.id}` : "new")}
          plan={editingPlan}
          {...("forPet" in editor
            ? { species: editor.forPet.species, startWith: [editor.forPet.id] }
            : {})}
          lockSpecies
          animals={pets}
          feeds={feeds}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setEditor(undefined)}
        />
      )}
    </div>
  );
}
