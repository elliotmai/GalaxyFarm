"use client";

import { useState } from "react";

import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Pill,
  SafetyBadge,
  Select,
  TextArea,
  TextInput,
  optionLabel,
  toOptions,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  SAFETY_LEVEL_DEFAULTS,
  SEXES,
  ageInMonths,
  animalSchema,
  displayName,
  type Animal,
  type CrudError,
  type FeedingPlan,
  type SafetyLevel,
  type Sex,
  type Ulid,
} from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { PET_SPECIES, petBriefings, type PetSpecies } from "@galaxy-farm/module-pets";

import {
  ListRow,
  PencilIcon,
  RowIconButton,
  RowList,
} from "@/app/(admin)/admin/horses/_components/list-row";
import { petHref } from "@/lib/animal-slug";
import { currentMedicinesFor, feedingLinesFor, plansFeeding } from "@/lib/pet-care";
import { useMutations } from "@/lib/local/mutations";

/**
 * Who lives here (spec §5.8).
 *
 * A row per pet — name, one line, one chip — in the guide's own order, and
 * each row opens the pet's own page (`/admin/pets/[id]`), which leads with the
 * briefing: deliberately the housesitter's view of the pet rather than the
 * owner's — handling level, then instructions, then what it eats, then what it
 * is on. §5.8 asks for pets to appear in the guide automatically, and the
 * fastest way to notice that the guide would be useless is to be reading the
 * same thing yourself every time you open a pet.
 *
 * The editor is exported (`PetEditor`) so the pet's page edits through the
 * same form, schema and delete confirmation as this list.
 */

export const PET_SPECIES_LABELS: Readonly<Record<PetSpecies, string>> = { dog: "Dog", cat: "Cat" };

/** "Dog" or "Cat", for a pet whose species the type system only knows as a string. */
export function petSpeciesLabel(pet: Pick<Animal, "species">): string {
  return PET_SPECIES_LABELS[pet.species === "cat" ? "cat" : "dog"];
}

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

export function petAgeLabel(pet: Animal, now: Date): string {
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
  feeds,
  loading,
  propertyId,
  actorId,
}: {
  readonly pets: readonly Animal[];
  readonly health: readonly HealthRecord[];
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  /** The editor: absent while closed, `{ pet: undefined }` while adding. */
  const [editor, setEditor] = useState<{ readonly pet: Animal | undefined } | undefined>();

  const now = new Date();

  /**
   * The guide's own words, used here for its order and its chips.
   *
   * Same function the housesitter guide calls, so the list reads in the order
   * a helper will — the animal that bites at the top.
   */
  const briefings = petBriefings(
    pets.map((pet) => ({
      pet,
      feeding: feedingLinesFor(pet.id, plans, feeds, pets).map((text) => ({ text })),
      medicines: currentMedicinesFor(pet.id, health, now),
    })),
  );

  if (loading) return <p className="text-muted">Loading pets…</p>;

  return (
    <div className="flex flex-col gap-density">
      <div className="flex justify-end">
        <Button
          variant="primary"
          aria-haspopup="dialog"
          onClick={() => setEditor({ pet: undefined })}
        >
          <span aria-hidden="true">+</span> Add a pet
        </Button>
      </div>

      {pets.length === 0 ? (
        <EmptyState
          title="No pets yet"
          detail="Adding one here puts it on the housesitter guide."
          action={<Button onClick={() => setEditor({ pet: undefined })}>Add the first one</Button>}
        />
      ) : (
        // In the guide's own order, which puts the animal that bites first.
        <RowList label="The household">
          {briefings.map((briefing) => {
            const pet = pets.find((held) => held.id === briefing.animalId) as Animal;

            return (
              <ListRow
                key={pet.id}
                title={briefing.name}
                line={[petSpeciesLabel(pet), optionLabel(pet.sex), petAgeLabel(pet, now)]}
                // One chip, in the order a helper needs it: how to handle
                // them, then a gap in the guide, then a medicine to give.
                chip={
                  briefing.handleWithCare ? (
                    <SafetyBadge level={pet.safetyLevel} size="compact" />
                  ) : briefing.feeding.length === 0 ? (
                    <Pill tone="action">No ration</Pill>
                  ) : briefing.medicines.length > 0 ? (
                    <Pill tone="neutral">On medication</Pill>
                  ) : undefined
                }
                href={petHref(pet)}
                trailing={
                  <RowIconButton label={`Edit ${briefing.name}`} onClick={() => setEditor({ pet })}>
                    <PencilIcon />
                  </RowIconButton>
                }
              />
            );
          })}
        </RowList>
      )}

      {editor === undefined ? null : (
        <PetEditor
          key={editor.pet?.id ?? "new"}
          pet={editor.pet}
          health={health}
          plans={plans}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setEditor(undefined)}
        />
      )}
    </div>
  );
}

function draftOf(pet: Animal | undefined, species?: PetSpecies): Draft {
  if (pet === undefined) return species === undefined ? BLANK : { ...BLANK, species };
  return {
    name: pet.name ?? "",
    species: (pet.species === "cat" ? "cat" : "dog") as PetSpecies,
    sex: pet.sex,
    dob: pet.dob === undefined ? "" : pet.dob.toISOString().slice(0, 10),
    dobIsEstimate: pet.dobIsEstimate,
    safetyLevel: pet.safetyLevel,
    safetyNotes: pet.safetyNotes ?? "",
    customInstructions: pet.customInstructions ?? "",
    notes: pet.notes ?? "",
  };
}

/**
 * Adding a pet, or editing one — and deleting it, behind a typed confirmation.
 *
 * One component for the list and the pet's own page, so both write through
 * `animalSchema` the same way. `onDeleted` is the page's chance to leave: a
 * page left standing on a pet that has just gone would show "no pet by that
 * name" under the undo toast.
 */
export function PetEditor({
  pet: editing,
  health,
  plans,
  propertyId,
  actorId,
  onClose,
  onDeleted,
  species,
}: {
  /** Absent to add a new one. */
  readonly pet: Animal | undefined;
  /** What a new one starts as — the Cats page adds a cat. */
  readonly species?: PetSpecies;
  /** Every health record and plan, so the delete can say what goes with it. */
  readonly health: readonly HealthRecord[];
  readonly plans: readonly FeedingPlan[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  readonly onDeleted?: () => void;
}) {
  const mutations = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft>(() => draftOf(editing, species));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
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
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove(pet: Animal) {
    const records = health.filter((record) => record.animalId === pet.id).length;
    const rations = plansFeeding(pet.id, plans).length;

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
    onDeleted?.();
  }

  return (
    <Modal
      placement="side"
      title={editing === undefined ? "Add a pet" : `Editing ${displayName(editing)}`}
      description="The handling level and instructions are what a housesitter reads first."
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {editing === undefined ? "Add them" : "Save changes"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {editing === undefined ? null : (
            // The editor closes first, so the typed confirmation is the
            // only dialog on screen.
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() => {
                onClose();
                void remove(editing);
              }}
            >
              Delete
            </Button>
          )}
        </>
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
              label: PET_SPECIES_LABELS[species],
            }))}
            onChange={(event) => setDraft({ ...draft, species: event.target.value as PetSpecies })}
          />
          <Select
            label="Sex"
            value={draft.sex}
            error={errors["sex"]}
            options={toOptions(SEXES.filter((sex) => sex !== "steer"))}
            onChange={(event) => setDraft({ ...draft, sex: event.target.value as Sex })}
          />
          <TextInput
            label="Date of birth"
            type="date"
            hint="A rescue rarely has one — put your best guess."
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
          hint='"Barks at the gate but is fine once you are in."'
          value={draft.safetyNotes}
          error={errors["safetyNotes"]}
          onChange={(event) => setDraft({ ...draft, safetyNotes: event.target.value })}
        />
        <TextArea
          label="Instructions"
          rows={3}
          hint="Goes on the guide word for word."
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
  );
}
