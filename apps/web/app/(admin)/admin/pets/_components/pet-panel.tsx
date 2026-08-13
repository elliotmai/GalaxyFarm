"use client";

import { useState } from "react";

import {
  Button,
  CardGrid,
  Checkbox,
  EmptyState,
  Modal,
  Pill,
  RecordCard,
  SafetyBadge,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  SAFETY_LEVEL_DEFAULTS,
  SEXES,
  ageInMonths,
  animalSchema,
  displayName,
  primaryPhone,
  type Animal,
  type Contact,
  type CrudError,
  type FeedingPlan,
  type SafetyLevel,
  type Sex,
  type Ulid,
} from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { PET_SPECIES, petBriefings, type PetSpecies } from "@galaxy-farm/module-pets";

import { currentMedicinesFor, feedingLinesFor } from "@/lib/pet-care";
import { useMutations } from "@/lib/local/mutations";

/**
 * Who lives here (spec §5.8).
 *
 * The card is deliberately the housesitter's view of the pet rather than the
 * owner's — handling level, then instructions, then what it eats, then what it
 * is on. §5.8 asks for pets to appear in the guide automatically, and the
 * fastest way to notice that the guide would be useless is to be reading the
 * same thing yourself every time you open this screen.
 */

const SPECIES_LABELS: Readonly<Record<PetSpecies, string>> = { dog: "Dog", cat: "Cat" };

const SAFETY_OPTIONS = Object.values(SAFETY_LEVEL_DEFAULTS).map((level) => ({
  value: String(level.level),
  label: `${level.level} — ${level.label}`,
}));

interface Draft {
  readonly name: string;
  readonly species: PetSpecies;
  readonly sex: Sex;
  readonly dob: string;
  readonly dobIsEstimate: boolean;
  readonly safetyLevel: SafetyLevel;
  readonly safetyNotes: string;
  readonly customInstructions: string;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  species: "dog",
  sex: "female",
  dob: "",
  dobIsEstimate: true,
  safetyLevel: 1,
  safetyNotes: "",
  customInstructions: "",
  notes: "",
};

function ageLabel(pet: Animal, now: Date): string {
  const months = ageInMonths(pet, now);
  if (months === undefined) return "age unknown";
  const years = Math.floor(months / 12);
  const label = years === 0 ? `${months} month${months === 1 ? "" : "s"}` : `${years} yr`;
  return pet.dobIsEstimate ? `about ${label}` : label;
}

export function PetPanel({
  pets,
  health,
  plans,
  contacts,
  feeds,
  loading,
  propertyId,
  actorId,
}: {
  readonly pets: readonly Animal[];
  readonly health: readonly HealthRecord[];
  readonly plans: readonly FeedingPlan[];
  readonly contacts: readonly Contact[];
  readonly feeds: readonly FeedType[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft | undefined>();
  const [editing, setEditing] = useState<Animal | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const vet = contacts.find((contact) => contact.tags.includes("vet"));

  /**
   * The guide's own words, rendered here.
   *
   * Same function the housesitter guide calls, so what is on this card is what
   * a helper will read — including the order, which puts the animal that bites
   * at the top.
   */
  const briefings = petBriefings(
    pets.map((pet) => ({
      pet,
      feeding: feedingLinesFor(pet.id, plans, feeds).map((text) => ({ text })),
      medicines: currentMedicinesFor(pet.id, health, now),
      ...(vet === undefined
        ? {}
        : {
            vetName: vet.name,
            ...(primaryPhone(vet) === undefined ? {} : { vetPhone: primaryPhone(vet) }),
          }),
    })),
  );

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  function startAdd() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(pet: Animal) {
    setEditing(pet);
    setDraft({
      name: pet.name ?? "",
      species: (pet.species === "cat" ? "cat" : "dog") as PetSpecies,
      sex: pet.sex,
      dob: pet.dob === undefined ? "" : pet.dob.toISOString().slice(0, 10),
      dobIsEstimate: pet.dobIsEstimate,
      safetyLevel: pet.safetyLevel,
      safetyNotes: pet.safetyNotes ?? "",
      customInstructions: pet.customInstructions ?? "",
      notes: pet.notes ?? "",
    });
    setErrors({});
  }

  function close() {
    setDraft(undefined);
    setEditing(undefined);
    setErrors({});
  }

  /**
   * The draft, as `animalSchema` wants it.
   *
   * Cleared boxes travel as an explicit `undefined`: on an edit, a field the
   * patch never mentions keeps its old value, so a safety note somebody
   * deleted because it stopped being true would come straight back.
   */
  function fields(source: Draft) {
    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());

    return {
      species: source.species,
      name: text(source.name),
      sex: source.sex,
      dob: source.dob === "" ? undefined : new Date(`${source.dob}T12:00:00`),
      dobIsEstimate: source.dobIsEstimate,
      // A pet is not sold, boarded, or processed. Everything this screen
      // creates is a member of the household until it is not.
      status: editing?.status ?? "active",
      ownership: "own" as const,
      safetyLevel: source.safetyLevel,
      safetyNotes: text(source.safetyNotes),
      photoKeys: editing?.photoKeys ?? [],
      customInstructions: text(source.customInstructions),
      notes: text(source.notes),
    };
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});
    setBusy(true);

    try {
      const patch = fields(draft);
      const result =
        editing === undefined
          ? await mutations.create(patch as never)
          : await mutations.update(editing.id, patch as Partial<Animal>);

      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({
        message: editing === undefined ? `${patch.name ?? "Pet"} added` : "Saved",
        tone: "success",
      });
      close();
    } finally {
      setBusy(false);
    }
  }

  async function remove(pet: Animal) {
    const records = health.filter((record) => record.animalId === pet.id).length;
    const rations = plans.filter((plan) => plan.targetId === pet.id).length;

    const confirmed = await confirmDelete({
      // An animal is an aggregate root: everything about it hangs off this
      // record (§4.5 clause 3).
      tier: "typed",
      recordName: displayName(pet),
      entity: "pet",
      dependents: [
        ...(records === 0
          ? []
          : [
              {
                entity: "Health record",
                label: `${records} vet visit${records === 1 ? "" : "s"} and treatment${records === 1 ? "" : "s"}`,
                effect: "deleted" as const,
              },
            ]),
        ...(rations === 0
          ? []
          : [
              {
                entity: "Feeding plan",
                label: `${rations} ration${rations === 1 ? "" : "s"}`,
                effect: "detached" as const,
              },
            ]),
      ],
      consequence:
        "They come off the housesitter guide with everything recorded about them. Restorable from Trash.",
    });
    if (!confirmed) return;

    const result = await mutations.remove(pet.id);
    if (!result.ok) {
      show({ message: "Could not delete that pet", tone: "danger" });
      return;
    }

    show({
      message: `${displayName(pet)} deleted`,
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(pet.id) },
    });
  }

  if (loading) return <p className="text-muted">Loading pets…</p>;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="The household"
        description="What a helper reads, in the order they read it — how to handle them, then what they eat, then what they are on."
        actions={
          <Button variant="primary" onClick={startAdd}>
            Add a pet
          </Button>
        }
      >
        {pets.length === 0 ? (
          <EmptyState
            title="No pets yet"
            detail="Dogs and cats live on the same Animal record as the herd. Adding one here puts it on the housesitter guide."
            action={<Button onClick={startAdd}>Add the first one</Button>}
          />
        ) : (
          <CardGrid columns={2}>
            {briefings.map((briefing) => {
              const pet = pets.find((held) => held.id === briefing.animalId) as Animal;

              return (
                <RecordCard
                  key={pet.id}
                  title={briefing.name}
                  subtitle={`${SPECIES_LABELS[(pet.species === "cat" ? "cat" : "dog") as PetSpecies]} · ${pet.sex} · ${ageLabel(pet, now)}`}
                  tone={briefing.handleWithCare ? "danger" : "neutral"}
                  meta={
                    <>
                      <SafetyBadge level={pet.safetyLevel} />
                      {briefing.medicines.length === 0 ? null : (
                        <Pill tone="action">on medication</Pill>
                      )}
                      {briefing.feeding.length === 0 ? <Pill tone="action">no ration</Pill> : null}
                    </>
                  }
                  actions={
                    <span className="flex gap-1">
                      <Button variant="ghost" onClick={() => startEdit(pet)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void remove(pet)}>
                        Delete
                      </Button>
                    </span>
                  }
                >
                  <dl className="flex flex-col gap-2 text-sm">
                    {briefing.safetyNotes === undefined ? null : (
                      <div>
                        <dt className="font-medium text-ink">Handling</dt>
                        <dd className="text-muted">{briefing.safetyNotes}</dd>
                      </div>
                    )}
                    {briefing.instructions === undefined ? null : (
                      <div>
                        <dt className="font-medium text-ink">Instructions</dt>
                        <dd className="text-muted">{briefing.instructions}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="font-medium text-ink">Feeding</dt>
                      <dd className="text-muted">
                        {briefing.feeding.length === 0 ? (
                          <span>Nothing written down — the guide will say so too.</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {briefing.feeding.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </dd>
                    </div>
                    {briefing.medicines.length === 0 ? null : (
                      <div>
                        <dt className="font-medium text-ink">On now</dt>
                        <dd className="text-muted">
                          <ul className="flex flex-col gap-1">
                            {briefing.medicines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                  </dl>
                </RecordCard>
              );
            })}
          </CardGrid>
        )}
      </Section>

      {draft === undefined ? null : (
        <Modal
          size="wide"
          title={editing === undefined ? "Add a pet" : `Editing ${displayName(editing)}`}
          description="The safety level and the instructions are what a housesitter reads first, so they are worth a sentence rather than a word."
          onClose={close}
          footer={
            <div className="flex gap-2">
              <Button variant="primary" busy={busy} onClick={() => void save()}>
                {editing === undefined ? "Add them" : "Save changes"}
              </Button>
              <Button onClick={close}>Cancel</Button>
            </div>
          }
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Name"
                required
                value={draft.name}
                error={errors["name"] ?? errors["tagNumber"]}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <Select
                label="Species"
                value={draft.species}
                options={PET_SPECIES.map((species) => ({
                  value: species,
                  label: SPECIES_LABELS[species],
                }))}
                onChange={(event) =>
                  setDraft({ ...draft, species: event.target.value as PetSpecies })
                }
              />
              <Select
                label="Sex"
                value={draft.sex}
                error={errors["sex"]}
                options={SEXES.filter((sex) => sex !== "steer").map((sex) => ({
                  value: sex,
                  label: sex,
                }))}
                onChange={(event) => setDraft({ ...draft, sex: event.target.value as Sex })}
              />
              <TextInput
                label="Date of birth"
                type="date"
                hint="A rescue rarely comes with one. Tick the box and put your best guess."
                value={draft.dob}
                error={errors["dob"]}
                onChange={(event) => setDraft({ ...draft, dob: event.target.value })}
              />
              <Checkbox
                label="That date is a guess"
                checked={draft.dobIsEstimate}
                onChange={(event) => setDraft({ ...draft, dobIsEstimate: event.target.checked })}
              />
              <Select
                label="Handling level"
                value={String(draft.safetyLevel)}
                error={errors["safetyLevel"]}
                options={SAFETY_OPTIONS}
                onChange={(event) =>
                  setDraft({ ...draft, safetyLevel: Number(event.target.value) as SafetyLevel })
                }
              />
            </div>

            <TextArea
              label="Why that level"
              rows={2}
              hint='"Barks at the gate but is fine once you are in." A level with no reason behind it gets ignored.'
              value={draft.safetyNotes}
              error={errors["safetyNotes"]}
              onChange={(event) => setDraft({ ...draft, safetyNotes: event.target.value })}
            />
            <TextArea
              label="Instructions"
              rows={3}
              hint="Where the lead is, which door, what they are not allowed. This goes on the guide word for word."
              value={draft.customInstructions}
              error={errors["customInstructions"]}
              onChange={(event) => setDraft({ ...draft, customInstructions: event.target.value })}
            />
            <TextArea
              label="Notes"
              rows={2}
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
