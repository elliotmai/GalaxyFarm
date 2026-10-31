"use client";

import { useState } from "react";

import {
  Button,
  Checkbox,
  Modal,
  Select,
  TextArea,
  TextInput,
  toOptions,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  ANIMAL_STATUSES,
  SAFETY_LEVEL_DEFAULTS,
  SEXES,
  animalSchema,
  displayName,
  type Animal,
  type AnimalStatus,
  type CrudError,
  type SafetyLevel,
  type Sex,
  type Ulid,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

/**
 * Adding a horse, or editing one (spec §5.9).
 *
 * A horse is an `Animal` with species `horse` — §2's one animal model — so this
 * writes through `animalSchema` exactly as the herd and pets editors do. The
 * fields are the ones §5.9's herd shell promises: who is here, whose they are,
 * and what each one is like to handle. Rations, pens and breeding wait for
 * their own screens.
 *
 * Shared by the herd list and the horse's own page.
 */

/**
 * The words a horse person uses for the stored sex.
 *
 * `steer` is the kernel's word for a castrated male, which on a horse is a
 * gelding; storing a second enum for the same fact would split every rule that
 * reads sex in two.
 */
export const HORSE_SEX_LABELS: Readonly<Record<Sex, string>> = {
  female: "Mare",
  male: "Stallion",
  steer: "Gelding",
  unknown: "Not sure",
};

const SAFETY_OPTIONS = Object.values(SAFETY_LEVEL_DEFAULTS).map((level) => ({
  value: String(level.level),
  label: `${level.level} — ${level.label}`,
}));

interface Draft {
  readonly name: string;
  readonly tagNumber: string;
  readonly sex: Sex;
  readonly dob: string;
  readonly dobIsEstimate: boolean;
  readonly status: AnimalStatus;
  readonly safetyLevel: SafetyLevel;
  readonly safetyNotes: string;
  readonly customInstructions: string;
  readonly notes: string;
}

function draftOf(horse: Animal | undefined): Draft {
  return {
    name: horse?.name ?? "",
    tagNumber: horse?.tagNumber ?? "",
    sex: horse?.sex ?? "female",
    dob: horse?.dob === undefined ? "" : horse.dob.toISOString().slice(0, 10),
    dobIsEstimate: horse?.dobIsEstimate ?? true,
    status: horse?.status ?? "active",
    safetyLevel: horse?.safetyLevel ?? 2,
    safetyNotes: horse?.safetyNotes ?? "",
    customInstructions: horse?.customInstructions ?? "",
    notes: horse?.notes ?? "",
  };
}

export function HorseEditor({
  horse: editing,
  propertyId,
  actorId,
  onClose,
  onDeleted,
}: {
  /** Absent to add a new one. */
  readonly horse: Animal | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** The horse's page leaves once it is deleted; the list stays put. */
  readonly onDeleted?: () => void;
}) {
  const mutations = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft>(() => draftOf(editing));
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
   * Cleared boxes travel as an explicit `undefined`, so a handling note
   * somebody deleted because it stopped being true does not come back.
   */
  function fields(source: Draft) {
    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());

    return {
      species: "horse" as const,
      name: text(source.name),
      tagNumber: text(source.tagNumber),
      sex: source.sex,
      dob: source.dob === "" ? undefined : new Date(`${source.dob}T12:00:00`),
      dobIsEstimate: source.dobIsEstimate,
      status: source.status,
      // A client's horse needs its owner named, which this form does not
      // ask; an existing one keeps what it had.
      ownership: editing?.ownership ?? ("own" as const),
      ownerId: editing?.ownerId,
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
        message: editing === undefined ? `${patch.name ?? "Horse"} added` : "Saved",
        tone: "success",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove(horse: Animal) {
    const confirmed = await confirmDelete({
      // An animal is an aggregate root: everything about it hangs off this
      // record (§4.5 clause 3).
      tier: "typed",
      recordName: displayName(horse),
      entity: "horse",
      dependents: [],
      consequence:
        "The horse comes off the herd, the pen board and the guide with everything recorded about it. Restorable from Trash.",
    });
    if (!confirmed) return;

    const result = await mutations.remove(horse.id);
    if (!result.ok) {
      show({ message: "Could not delete that horse", tone: "danger" });
      return;
    }

    show({
      message: `${displayName(horse)} deleted`,
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(horse.id) },
    });
    onDeleted?.();
  }

  return (
    <Modal
      placement="side"
      title={editing === undefined ? "Add a horse" : `Editing ${displayName(editing)}`}
      description="The handling level and why are what anyone reads before going into the pen."
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {editing === undefined ? "Add the horse" : "Save changes"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {editing === undefined ? null : (
            // The editor closes first, so the typed confirmation is the only
            // dialog on screen.
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
            value={draft.name}
            error={errors["name"] ?? errors["tagNumber"]}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <TextInput
            label="Tag or brand"
            hint="Optional. A name alone is enough."
            value={draft.tagNumber}
            onChange={(event) => setDraft({ ...draft, tagNumber: event.target.value })}
          />
          <Select
            label="Sex"
            value={draft.sex}
            error={errors["sex"]}
            options={SEXES.map((sex) => ({ value: sex, label: HORSE_SEX_LABELS[sex] }))}
            onChange={(event) => setDraft({ ...draft, sex: event.target.value as Sex })}
          />
          <Select
            label="Status"
            value={draft.status}
            error={errors["status"]}
            options={toOptions(ANIMAL_STATUSES)}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as AnimalStatus })}
          />
          <TextInput
            label="Date of birth"
            type="date"
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
          hint='"Kicks when her feet are picked up."'
          value={draft.safetyNotes}
          error={errors["safetyNotes"]}
          onChange={(event) => setDraft({ ...draft, safetyNotes: event.target.value })}
        />
        <TextArea
          label="Care instructions"
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
