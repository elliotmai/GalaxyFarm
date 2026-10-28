"use client";

import { useState } from "react";

import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Pill,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import { endOfDay, type CrudError, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  eggLogSchema,
  flockAdjustmentSchema,
  flockSchema,
  FLOCK_SPECIES,
  headCountOn,
  type EggLog,
  type Flock,
  type FlockAdjustment,
  type FlockSpecies,
} from "@galaxy-farm/module-poultry";

import { REASON_LABEL } from "@/app/(admin)/admin/chickens/flock/_components/reasons";
import { ListRow, RowIconButton, RowList } from "@/app/(admin)/admin/horses/_components/list-row";
import { useMutations } from "@/lib/local/mutations";

/**
 * The flocks themselves (spec §5.4).
 *
 * A flock, not a bird. Eighteen hens are one record with a headcount, because
 * nobody names a laying hen and nobody wants eighteen profiles to keep — and
 * §5.4 makes quail a value in `species` rather than a second module, so this
 * screen is the whole of poultry however the farm's taste in birds changes.
 *
 * The count on each row is derived, never typed. What can be typed is the
 * count on the day the flock was first written down; everything after it comes
 * from the log.
 *
 * Rows, not cards: the count in the badge, the name, one line, and one chip
 * for whatever is wrong. The row opens the editor (where delete lives); the
 * ± beside it records a change against that flock.
 */

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const SPECIES_LABEL: Readonly<Record<FlockSpecies, string>> = {
  chicken: "Chickens",
  quail: "Quail",
};

const SPECIES_OPTIONS = FLOCK_SPECIES.map((species) => ({
  value: species,
  label: SPECIES_LABEL[species],
}));

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

export function FlocksPanel({
  flocks,
  adjustments,
  zones,
  eggLogs,
  loading,
  propertyId,
  actorId,
  onRecordChange,
}: {
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
  readonly zones: readonly Zone[];
  readonly eggLogs: readonly EggLog[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** Opens the headcount form on this flock. */
  readonly onRecordChange: (flock: Flock) => void;
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

  const [editing, setEditing] = useState<Flock | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Where a flock can live.
   *
   * Coops first, because that is what §5.4 says a flock's zone is, but not
   * coops only: a farm that has not drawn its coop as a zone yet would be left
   * with an empty dropdown and no way to say where the birds are.
   */
  const places = [...zones.filter((zone) => zone.active)].sort((left, right) =>
    left.type === right.type ? 0 : left.type === "coop" ? -1 : right.type === "coop" ? 1 : 0,
  );

  const zoneName = (id: Ulid | undefined) =>
    id === undefined ? undefined : zones.find((zone) => zone.id === id)?.name;

  // End of today, not this instant: a date-only entry is stored at midday, so
  // an "as of now" asked at six in the morning would leave this morning's
  // losses out of the count on the row.
  const now = endOfDay(new Date());

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(flock: Flock) {
    setEditing(flock);
    setDraft({
      name: flock.name,
      species: flock.species,
      zoneId: flock.zoneId ?? "",
      breedMix: flock.breedMix ?? "",
      openingCount: String(flock.openingCount),
      active: flock.active,
      notes: flock.notes ?? "",
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner over the form.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
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
      editing === undefined
        ? await mutations.create(fields as never)
        : await mutations.update(editing.id, fields as Partial<Flock>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: editing === undefined ? "Flock added" : "Flock saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
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
  async function removeFlock(flock: Flock) {
    const owned = adjustments.filter((entry) => entry.flockId === flock.id);
    const eggs = eggLogs.filter((log) => log.flockId === flock.id);

    const confirmed = await confirmDelete({
      tier: "typed",
      recordName: flock.name,
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

    const result = await mutations.remove(flock.id);
    if (!result.ok) {
      show({ message: "Could not delete that flock", tone: "danger" });
      return;
    }

    for (const entry of owned) await logMutations.remove(entry.id, `Flock ${flock.name} deleted`);
    for (const log of eggs) await eggMutations.update(log.id, { flockId: undefined });

    show({
      message: `${flock.name} deleted`,
      action: {
        label: "Undo",
        // All three parts, or the undo is a lie: the flock, its log, and the
        // egg logs that were pointed back at nothing to delete it.
        onAct: () => {
          void (async () => {
            await mutations.restoreRecord(flock.id);
            for (const entry of owned) await logMutations.restoreRecord(entry.id);
            for (const log of eggs) await eggMutations.update(log.id, { flockId: flock.id });
          })();
        },
      },
    });
  }

  if (loading) return <p className="text-muted">Loading flocks…</p>;

  return (
    <div className="flex flex-col gap-density">
      {flocks.length === 0 ? (
        <EmptyState
          title="No flocks yet"
          detail="Add the coop as a flock with the birds you have today. Everything after is logged."
          action={
            <Button variant="primary" onClick={startCreate}>
              Add the first flock
            </Button>
          }
        />
      ) : (
        <>
          <RowList label="Flocks">
            {[...flocks]
              .sort((left, right) => Number(right.active) - Number(left.active))
              .map((flock) => {
                const count = headCountOn(flock, adjustments, now);
                const entries = adjustments.filter((entry) => entry.flockId === flock.id).length;
                const coop = zoneName(flock.zoneId);

                return (
                  <ListRow
                    key={flock.id}
                    lead={
                      <>
                        {count}
                        <span className="sr-only"> bird{count === 1 ? "" : "s"},</span>
                      </>
                    }
                    title={flock.name}
                    line={[
                      SPECIES_LABEL[flock.species],
                      coop,
                      flock.breedMix,
                      entries === 0
                        ? `opened at ${flock.openingCount}`
                        : `${flock.openingCount} to start, ${entries} change${entries === 1 ? "" : "s"}`,
                    ]}
                    // One chip, for what is wrong: switched off first, then an
                    // empty coop, then no coop — without one the pen board has
                    // nowhere to draw these birds.
                    chip={
                      !flock.active ? (
                        <Pill tone="neutral">Switched off</Pill>
                      ) : count === 0 ? (
                        <Pill tone="danger">Empty</Pill>
                      ) : coop === undefined ? (
                        <Pill tone="danger">No coop</Pill>
                      ) : undefined
                    }
                    label={`Edit ${flock.name}, ${count} bird${count === 1 ? "" : "s"}`}
                    onOpen={() => startEdit(flock)}
                    trailing={
                      <RowIconButton
                        label={`Record a change to ${flock.name}`}
                        onClick={() => onRecordChange(flock)}
                      >
                        <span aria-hidden="true" className="text-lg font-semibold leading-none">
                          ±
                        </span>
                      </RowIconButton>
                    }
                  />
                );
              })}
          </RowList>
          <div>
            <Button variant="ghost" onClick={startCreate}>
              + Add a flock
            </Button>
          </div>
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "New flock" : `Editing ${editing.name}`}
          description="Quail go here too — same screen, different species."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add flock" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                // The editor closes first, so the typed confirmation is the
                // only dialog on screen rather than a second one on this.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const flock = editing;
                    setDraft(undefined);
                    setEditing(undefined);
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
              onChange={(event) =>
                setDraft({ ...draft, species: event.target.value as FlockSpecies })
              }
            />
            <Select
              label="Coop"
              placeholder="Not set"
              hint="Coops are listed first."
              options={[
                { value: "", label: "Not set" },
                ...places.map((zone) => ({
                  value: zone.id,
                  label: zone.type === "coop" ? zone.name : `${zone.name} (${zone.type})`,
                })),
              ]}
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
      )}
    </div>
  );
}
