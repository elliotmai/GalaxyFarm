"use client";

import { useState } from "react";

import {
  Button,
  CardGrid,
  EmptyState,
  Modal,
  Pill,
  RecordCard,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  isStaleSeed,
  seedInventorySchema,
  type Crop,
  type SeedInventory,
  type Variety,
} from "@galaxy-farm/module-garden";

import { SEED_UNIT_OPTIONS, quantityLabel } from "@/app/(admin)/admin/garden/_components/labels";
import { varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * What is actually in the box (spec §5.5).
 *
 * The one derived thing on this panel is staleness, and it is the reason the
 * panel is worth having: seed keeps far longer than a packet claims, but two
 * seasons past its packed-for year it wants a germination test before a bed is
 * committed to it. `isStaleSeed` says so; nothing about a packet does.
 *
 * Deliberately a warning and never a filter. Old seed is usually fine, and a
 * screen that hid it would have people re-buying what they already have.
 */

interface Draft {
  readonly varietyId: string;
  readonly quantity: string;
  readonly unit: SeedInventory["unit"];
  readonly packedForYear: string;
  readonly source: string;
  readonly germinationNotes: string;
}

const BLANK: Draft = {
  varietyId: "",
  quantity: "1",
  unit: "packet",
  packedForYear: "",
  source: "",
  germinationNotes: "",
};

export function SeedBoxPanel({
  seed,
  varieties,
  crops,
  loading,
  propertyId,
  actorId,
  onNeedsCatalog,
}: {
  readonly seed: readonly SeedInventory[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onNeedsCatalog: () => void;
}) {
  const mutations = useMutations<SeedInventory>(
    "seedInventory",
    "seedInventory",
    seedInventorySchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<SeedInventory | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const now = new Date();
  const nameOf = (varietyId: Ulid) =>
    varietyLabel(
      varieties.find((variety) => variety.id === varietyId),
      crops,
    );

  const varietyOptions = [...varieties]
    .map((variety) => ({ value: variety.id, label: varietyLabel(variety, crops) }))
    .sort((left, right) => left.label.localeCompare(right.label));

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(entry: SeedInventory) {
    setEditing(entry);
    setDraft({
      varietyId: entry.varietyId,
      quantity: String(entry.quantity),
      unit: entry.unit,
      packedForYear: entry.packedForYear === undefined ? "" : String(entry.packedForYear),
      source: entry.source ?? "",
      germinationNotes: entry.germinationNotes ?? "",
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner over the form.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { varietyId: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());
    const fields = {
      varietyId: draft.varietyId as Ulid,
      quantity: draft.quantity.trim() === "" ? Number.NaN : Number(draft.quantity),
      unit: draft.unit,
      // Explicitly undefined rather than left out: on an edit, a field the
      // patch never mentions keeps its old value, so a year somebody cleared
      // would come straight back.
      packedForYear:
        draft.packedForYear.trim() === "" ? undefined : Number(draft.packedForYear.trim()),
      source: text(draft.source),
      germinationNotes: text(draft.germinationNotes),
    };

    const result =
      editing === undefined
        ? await mutations.create(fields as never)
        : await mutations.update(editing.id, fields as Partial<SeedInventory>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: editing === undefined ? "Seed added" : "Seed saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Delete one seed entry.
   *
   * Standard tier: nothing points at a packet. A planting names the *variety*,
   * not the seed it came out of, so removing an entry from the box takes
   * nothing else with it — which is exactly why the undo toast is enough here
   * and a typed confirmation would be theatre.
   */
  async function remove(entry: SeedInventory) {
    const label = nameOf(entry.varietyId);

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${quantityLabel(entry.quantity, entry.unit)} of ${label}`,
      entity: "seed entry",
      dependents: [],
      consequence: "Nothing else points at it — a planting names the variety, not the packet.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await mutations.remove(entry.id, "Removed from the seed box");
    if (!result.ok) {
      show({ message: "Could not delete that seed entry", tone: "danger" });
      return;
    }

    show({
      message: `${label} removed from the box`,
      action: {
        label: "Undo",
        onAct: () => void mutations.restoreRecord(entry.id),
      },
    });
  }

  if (loading) return <p className="text-muted">Loading the seed box…</p>;

  const sorted = [...seed].sort((left, right) =>
    nameOf(left.varietyId).localeCompare(nameOf(right.varietyId)),
  );

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Seed box"
        description="One entry per packet or lot. Anything more than two seasons past its packed-for year is flagged — not hidden, because old seed is usually fine and it is worth a germination test rather than a re-order."
        actions={
          <Button variant="primary" onClick={startCreate} disabled={varieties.length === 0}>
            Add seed
          </Button>
        }
      >
        {varieties.length === 0 ? (
          <EmptyState
            title="No varieties yet"
            detail="Seed is seed of something. Add the crop and the variety first, then the packet."
            action={
              <Button variant="primary" onClick={onNeedsCatalog}>
                Go to the catalogue
              </Button>
            }
          />
        ) : seed.length === 0 ? (
          <EmptyState
            title="The box is empty"
            detail="Add what you have on hand. The packed-for year is what makes the staleness warning work, so it is worth typing."
            action={
              <Button variant="primary" onClick={startCreate}>
                Add the first packet
              </Button>
            }
          />
        ) : (
          <CardGrid columns={3}>
            {sorted.map((entry) => {
              const stale = isStaleSeed(entry, now);

              return (
                <RecordCard
                  key={entry.id}
                  tone={stale ? "danger" : entry.quantity === 0 ? "neutral" : "calm"}
                  title={nameOf(entry.varietyId)}
                  subtitle={entry.source}
                  actions={
                    stale ? (
                      <Pill tone="danger" dot>
                        test it first
                      </Pill>
                    ) : null
                  }
                  meta={
                    <>
                      <Pill tone={entry.quantity === 0 ? "neutral" : "identity"}>
                        {quantityLabel(entry.quantity, entry.unit)}
                      </Pill>
                      {entry.packedForYear === undefined ? (
                        <Pill tone="neutral">no year on it</Pill>
                      ) : (
                        <Pill tone="neutral">packed for {entry.packedForYear}</Pill>
                      )}
                    </>
                  }
                >
                  {stale ? (
                    <p className="text-sm text-muted">
                      Two seasons past {entry.packedForYear}. Germination falls off well before seed
                      is dead — run ten on a damp paper towel before you commit a bed to it.
                    </p>
                  ) : null}
                  {entry.germinationNotes === undefined ? null : (
                    <p className="text-sm text-muted">{entry.germinationNotes}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => startEdit(entry)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(entry)}>
                      Delete
                    </Button>
                  </div>
                </RecordCard>
              );
            })}
          </CardGrid>
        )}
      </Section>

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "Add seed" : `Editing ${nameOf(editing.varietyId)}`}
          description="A packet, a jar, or whatever the lot came in. Quantity and unit are yours to choose — packets for what you bought, grams for what you saved."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Variety"
                required
                placeholder="Pick one"
                options={[{ value: "", label: "Pick one" }, ...varietyOptions]}
                value={draft.varietyId}
                error={errors["varietyId"]}
                onChange={(event) => setDraft({ ...draft, varietyId: event.target.value })}
              />
              <TextInput
                label="Source"
                hint="&ldquo;Baker Creek&rdquo;, &ldquo;saved 2025&rdquo;, &ldquo;from Judy&rdquo;."
                value={draft.source}
                error={errors["source"]}
                onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              />
              <TextInput
                label="Quantity"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                numeric
                required
                value={draft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
              <Select
                label="Unit"
                options={SEED_UNIT_OPTIONS}
                value={draft.unit}
                error={errors["unit"]}
                onChange={(event) =>
                  setDraft({ ...draft, unit: event.target.value as SeedInventory["unit"] })
                }
              />
              <TextInput
                label="Packed for"
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
                step={1}
                numeric
                hint="The year printed on the packet. Without it nothing can tell you the seed is getting old."
                value={draft.packedForYear}
                error={errors["packedForYear"]}
                onChange={(event) => setDraft({ ...draft, packedForYear: event.target.value })}
              />
            </div>

            <TextArea
              label="Germination notes"
              rows={3}
              hint="What last year's test gave, how it was stored, whether it needs stratifying."
              value={draft.germinationNotes}
              error={errors["germinationNotes"]}
              onChange={(event) => setDraft({ ...draft, germinationNotes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add seed" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
