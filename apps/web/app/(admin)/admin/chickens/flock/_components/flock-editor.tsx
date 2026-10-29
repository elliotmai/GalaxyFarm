"use client";

import { useState } from "react";

import {
  Button,
  Checkbox,
  Modal,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { type CrudError, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  eggLogSchema,
  flockAdjustmentSchema,
  flockSchema,
  FLOCK_SPECIES,
  type EggLog,
  type Flock,
  type FlockAdjustment,
  type FlockSpecies,
} from "@galaxy-farm/module-poultry";

import { REASON_LABEL } from "@/app/(admin)/admin/chickens/flock/_components/reasons";
import { useMutations } from "@/lib/local/mutations";

/**
 * A flock's own fields, in a side panel (spec §5.4).
 *
 * Lifted out of the flock list when each flock got a page of its own: the list
 * adds flocks here, and the flock's page edits and deletes it here, so there
 * is one form and one delete for a flock rather than one per screen.
 *
 * The count is never on it. What can be typed is the count on the day the
 * flock was first written down; everything after it comes from the log.
 */

export function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const SPECIES_LABEL: Readonly<Record<FlockSpecies, string>> = {
  chicken: "Chickens",
  quail: "Quail",
};

const SPECIES_OPTIONS = FLOCK_SPECIES.map((species) => ({
  value: species,
  label: SPECIES_LABEL[species],
}));

/**
 * Where a flock can live.
 *
 * Coops first, because that is what §5.4 says a flock's zone is, but not
 * coops only: a farm that has not drawn its coop as a zone yet would be left
 * with an empty dropdown and no way to say where the birds are.
 */
export function coopOptions(zones: readonly Zone[]): { value: string; label: string }[] {
  const places = [...zones.filter((zone) => zone.active)].sort((left, right) =>
    left.type === right.type ? 0 : left.type === "coop" ? -1 : right.type === "coop" ? 1 : 0,
  );
  return places.map((zone) => ({
    value: zone.id,
    label: zone.type === "coop" ? zone.name : `${zone.name} (${zone.type})`,
  }));
}

interface Draft {
  readonly name: string;
  readonly species: FlockSpecies;
  readonly zoneId: string;
  readonly breedMix: string;
  readonly openingCount: string;
  readonly active: boolean;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  species: "chicken",
  zoneId: "",
  breedMix: "",
  openingCount: "0",
  active: true,
  notes: "",
};

function draftOf(flock: Flock | undefined): Draft {
  if (flock === undefined) return BLANK;
  return {
    name: flock.name,
    species: flock.species,
    zoneId: flock.zoneId ?? "",
    breedMix: flock.breedMix ?? "",
    openingCount: String(flock.openingCount),
    active: flock.active,
    notes: flock.notes ?? "",
  };
}

export function FlockEditor({
  flock,
  adjustments,
  zones,
  eggLogs,
  propertyId,
  actorId,
  onClose,
  onDeleted,
}: {
  /** The flock being edited; absent to add a new one. */
  readonly flock?: Flock | undefined;
  readonly adjustments: readonly FlockAdjustment[];
  readonly zones: readonly Zone[];
  /** Only to say what a deletion would take with it (§4.5 clause 3). */
  readonly eggLogs: readonly EggLog[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** After a confirmed delete — a flock's page leaves, since it has nothing to show. */
  readonly onDeleted?: (flock: Flock) => void;
}) {
  const mutations = useMutations<Flock>("flocks", "flocks", flockSchema, propertyId, actorId);
  // Deleting a flock takes its own log with it and lets go of the egg logs
  // that named it — both of which are writes to other tables.
  const logMutations = useMutations<FlockAdjustment>(
    "flockAdjustments",
    "flockAdjustments",
    flockAdjustmentSchema,
    propertyId,
    actorId,
  );
  const eggMutations = useMutations<EggLog>(
    "eggLogs",
    "eggLogs",
    eggLogSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft>(() => draftOf(flock));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner over the form.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    setErrors({});

    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());
    const fields = {
      name: draft.name.trim(),
      species: draft.species,
      // Explicitly undefined rather than left out: on an edit, a field the
      // patch never mentions keeps its old value, so a coop somebody cleared
      // would come straight back.
      zoneId: draft.zoneId === "" ? undefined : (draft.zoneId as Ulid),
      breedMix: text(draft.breedMix),
      openingCount: draft.openingCount.trim() === "" ? Number.NaN : Number(draft.openingCount),
      active: draft.active,
      notes: text(draft.notes),
    };

    const result =
      flock === undefined
        ? await mutations.create(fields as never)
        : await mutations.update(flock.id, fields as Partial<Flock>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: flock === undefined ? "Flock added" : "Flock saved", tone: "success" });
    onClose();
  }

  /**
   * Delete a flock, and everything that only made sense next to it.
   *
   * Typed tier: a flock is an aggregate with a history hanging off it, which is
   * the case §4.5 names for the strongest confirmation. Its adjustments
   * **cascade** — an adjustment without its flock is a number about nothing —
   * and its egg logs **detach**, because eggs collected in June were still
   * collected in June whatever became of the birds.
   */
  async function removeFlock(target: Flock) {
    const owned = adjustments.filter((entry) => entry.flockId === target.id);
    const eggs = eggLogs.filter((log) => log.flockId === target.id);

    const confirmed = await confirmDelete({
      tier: "typed",
      recordName: target.name,
      entity: "flock",
      dependents: [
        ...owned.map((entry) => ({
          entity: "Headcount entry",
          label: `${REASON_LABEL[entry.reason]} ${entry.quantity}, ${formatDate(entry.occurredOn)}`,
          effect: "deleted" as const,
        })),
        ...eggs.map((log) => ({
          entity: "Egg log",
          label: `${log.total} on ${formatDate(log.collectedOn)}`,
          effect: "detached" as const,
        })),
      ],
      consequence:
        eggs.length === 0
          ? "The headcount history goes with it. Switching the flock off instead keeps both."
          : "The headcount history goes with it; the egg logs stay but stop saying which coop they came from. Switching the flock off instead keeps both.",
      action: "Delete",
    });

    if (!confirmed) return;

    const result = await mutations.remove(target.id);
    if (!result.ok) {
      show({ message: "Could not delete that flock", tone: "danger" });
      return;
    }

    for (const entry of owned) await logMutations.remove(entry.id, `Flock ${target.name} deleted`);
    for (const log of eggs) await eggMutations.update(log.id, { flockId: undefined });

    show({
      message: `${target.name} deleted`,
      action: {
        label: "Undo",
        // All three parts, or the undo is a lie: the flock, its log, and the
        // egg logs that were pointed back at nothing to delete it.
        onAct: () => {
          void (async () => {
            await mutations.restoreRecord(target.id);
            for (const entry of owned) await logMutations.restoreRecord(entry.id);
            for (const log of eggs) await eggMutations.update(log.id, { flockId: target.id });
          })();
        },
      },
    });
    onDeleted?.(target);
  }

  return (
    <Modal
      placement="side"
      title={flock === undefined ? "New flock" : `Editing ${flock.name}`}
      description="Quail go here too — same screen, different species."
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void save()}>
            {flock === undefined ? "Add flock" : "Save changes"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {flock === undefined ? null : (
            // The editor closes first, so the typed confirmation is the
            // only dialog on screen rather than a second one on this.
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() => {
                onClose();
                void removeFlock(flock);
              }}
            >
              Delete
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-density">
        <TextInput
          label="Name"
          required
          hint="“The big coop”, “the bantams”."
          value={draft.name}
          error={errors["name"]}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <Select
          label="Species"
          options={SPECIES_OPTIONS}
          value={draft.species}
          error={errors["species"]}
          onChange={(event) => setDraft({ ...draft, species: event.target.value as FlockSpecies })}
        />
        <Select
          label="Coop"
          hint="Coops are listed first."
          options={[{ value: "", label: "Not set" }, ...coopOptions(zones)]}
          value={draft.zoneId}
          error={errors["zoneId"]}
          onChange={(event) => setDraft({ ...draft, zoneId: event.target.value })}
        />
        <TextInput
          label="Breed mix"
          hint="“12 ISA Browns, 6 Easter Eggers”"
          value={draft.breedMix}
          error={errors["breedMix"]}
          onChange={(event) => setDraft({ ...draft, breedMix: event.target.value })}
        />
        <TextInput
          label="Count to start from"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          numeric
          // The one hint worth its line: changing this is not how a
          // count is corrected, and editing it to "fix" today's number
          // would rewrite the flock's whole history.
          hint="The first count only. Changes since go in the log."
          value={draft.openingCount}
          error={errors["openingCount"]}
          onChange={(event) => setDraft({ ...draft, openingCount: event.target.value })}
        />
        <Checkbox
          label="Still in the yard"
          hint="Untick a flock that is gone. It keeps its history."
          checked={draft.active}
          onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
        />
        <TextArea
          label="Notes"
          rows={3}
          value={draft.notes}
          error={errors["notes"]}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </div>
    </Modal>
  );
}
