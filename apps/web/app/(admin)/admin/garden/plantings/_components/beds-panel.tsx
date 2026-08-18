"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  CardGrid,
  Checkbox,
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
import type { CrudError, Ulid, Zone } from "@galaxy-farm/core";
import {
  bedAreaSqFt,
  bedSchema,
  gardenCareLogSchema,
  type Bed,
  type BedType,
  type GardenCareLog,
  type Planting,
} from "@galaxy-farm/module-garden";

import { BED_TYPE_LABEL, BED_TYPE_OPTIONS } from "@/app/(admin)/admin/garden/_components/labels";
import { useMutations } from "@/lib/local/mutations";

/**
 * The ground itself (spec §5.5).
 *
 * A bed is a child of a garden Zone, not a Zone of its own. §5.1's Zone is
 * "the universal place" and the Pen Board draws every one of them — forty
 * raised beds promoted to zones would render alongside the pens, which is not
 * what anybody wants to glance at ten times a day.
 *
 * Nothing here draws anything. The layout designer (#33) is blocked on the
 * shared `SpatialEditor`, and when it lands it will edit these same records
 * and fill in the `x`/`y` this form leaves alone. Dimensions are typed here
 * because the area they give is what tells you whether the tomatoes fit, and
 * that is worth having a year before the drawing is.
 */

interface Draft {
  readonly zoneId: string;
  readonly name: string;
  readonly type: BedType;
  readonly lengthFt: string;
  readonly widthFt: string;
  readonly soilNotes: string;
  readonly active: boolean;
}

const BLANK: Draft = {
  zoneId: "",
  name: "",
  type: "raised_bed",
  lengthFt: "",
  widthFt: "",
  soilNotes: "",
  active: true,
};

export function BedsPanel({
  beds,
  zones,
  plantings,
  care,
  loading,
  propertyId,
  actorId,
  onPlantHere,
}: {
  readonly beds: readonly Bed[];
  readonly zones: readonly Zone[];
  readonly plantings: readonly Planting[];
  readonly care: readonly GardenCareLog[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onPlantHere: (bed: Bed) => void;
}) {
  const api = useMutations<Bed>("beds", "beds", bedSchema, propertyId, actorId);
  // Deleting a bed takes its care log with it, which is a write to another
  // table. Its plantings are read only to refuse the delete, never written.
  const careApi = useMutations<GardenCareLog>(
    "gardenCareLogs",
    "gardenCareLogs",
    gardenCareLogSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Bed | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Where a bed can be.
   *
   * Garden areas first, because that is what §5.5 says a bed's zone is — but
   * not garden areas only: a farm that has not drawn a garden zone yet would
   * be left with an empty dropdown and no way to record the beds it already
   * has in the ground.
   */
  const places = [...zones.filter((zone) => zone.active)].sort((left, right) =>
    left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === "garden_area"
        ? -1
        : right.type === "garden_area"
          ? 1
          : 0,
  );

  const zoneName = (id: Ulid) => zones.find((zone) => zone.id === id)?.name;

  function startCreate() {
    setEditing(undefined);
    setDraft({ ...BLANK, zoneId: places[0]?.id ?? "" });
    setErrors({});
  }

  function startEdit(bed: Bed) {
    setEditing(bed);
    setDraft({
      zoneId: bed.zoneId,
      name: bed.name,
      type: bed.type,
      lengthFt: bed.lengthFt === undefined ? "" : String(bed.lengthFt),
      widthFt: bed.widthFt === undefined ? "" : String(bed.widthFt),
      soilNotes: bed.soilNotes ?? "",
      active: bed.active,
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const number = (value: string) => (value.trim() === "" ? undefined : Number(value.trim()));
    const fields = {
      zoneId: draft.zoneId as Ulid,
      name: draft.name.trim(),
      type: draft.type,
      lengthFt: number(draft.lengthFt),
      widthFt: number(draft.widthFt),
      soilNotes: draft.soilNotes.trim() === "" ? undefined : draft.soilNotes.trim(),
      active: draft.active,
    };

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<Bed>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: editing === undefined ? "Bed added" : "Bed saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Delete a bed.
   *
   * **Restrict** on plantings, because a planting is the record of what grew
   * in that ground and the rotation guard reads it for years afterwards —
   * deleting the bed would take the history the guard runs on. Switching the
   * bed off instead does what somebody almost always means: it leaves every
   * picker and keeps all of it.
   *
   * Its care log **cascades**: "watered" against a bed that no longer exists
   * is a fact about nothing.
   */
  async function remove(bed: Bed) {
    const grown = plantings.filter((planting) => planting.bedId === bed.id);
    const logs = care.filter((entry) => entry.bedId === bed.id);

    if (grown.length > 0) {
      show({
        message: `${bed.name} holds ${grown.length} planting${grown.length === 1 ? "" : "s"} and the rotation history that goes with them. Switch it off instead — it leaves every picker and keeps the record.`,
        tone: "warning",
      });
      return;
    }

    const confirmed = await confirmDelete({
      tier: logs.length > 0 ? "elevated" : "standard",
      recordName: bed.name,
      entity: "bed",
      dependents: logs.map((entry) => ({
        entity: "Care entry",
        label: `${entry.action.replace(/_/g, " ")}, ${entry.performedOn.toLocaleDateString()}`,
        effect: "deleted" as const,
      })),
      consequence:
        logs.length === 0
          ? "Nothing has been planted or done in it."
          : "The care entries against it go with it. Switching the bed off instead keeps both.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(bed.id, "Bed removed");
    if (!result.ok) {
      show({ message: `Could not delete ${bed.name}`, tone: "danger" });
      return;
    }

    for (const entry of logs) await careApi.remove(entry.id, `Bed ${bed.name} deleted`);

    show({
      message: `${bed.name} deleted`,
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(bed.id);
            for (const entry of logs) await careApi.restoreRecord(entry.id);
          })();
        },
      },
    });
  }

  if (loading) return <p className="text-muted">Loading beds…</p>;

  return (
    <div className="flex flex-col gap-density">
      {zones.filter((zone) => zone.active).length === 0 ? (
        <Callout tone="action" title="No zones yet">
          A bed sits inside a zone — the garden area it is part of. Add one under Settings →
          Property before adding beds.
        </Callout>
      ) : null}

      <Section
        title="Beds"
        description="Raised beds, rows, containers and open ground. Drawing them comes later; recording them does not have to wait for it."
        actions={
          <Button variant="primary" onClick={startCreate} disabled={places.length === 0}>
            Add a bed
          </Button>
        }
      >
        {beds.length === 0 ? (
          <EmptyState
            title="No beds yet"
            detail="Add the beds you have. Length and width are worth typing — the square footage is what tells you whether the tomatoes fit."
            action={
              <Button variant="primary" onClick={startCreate} disabled={places.length === 0}>
                Add the first bed
              </Button>
            }
          />
        ) : (
          <CardGrid columns={3}>
            {[...beds]
              .sort(
                (left, right) =>
                  Number(right.active) - Number(left.active) || left.name.localeCompare(right.name),
              )
              .map((bed) => {
                const area = bedAreaSqFt(bed);
                const inIt = plantings.filter(
                  (planting) =>
                    planting.bedId === bed.id &&
                    (planting.status === "growing" || planting.status === "harvesting"),
                );

                return (
                  <RecordCard
                    key={bed.id}
                    tone={!bed.active ? "neutral" : inIt.length > 0 ? "calm" : "action"}
                    title={bed.name}
                    subtitle={`${BED_TYPE_LABEL[bed.type]}${
                      zoneName(bed.zoneId) === undefined ? "" : ` · ${zoneName(bed.zoneId)}`
                    }`}
                    actions={
                      <Pill tone={bed.active ? "calm" : "neutral"} dot={!bed.active}>
                        {bed.active ? "in use" : "switched off"}
                      </Pill>
                    }
                    meta={
                      <>
                        {area === undefined ? (
                          <Pill tone="neutral">no dimensions</Pill>
                        ) : (
                          <Pill tone="identity">
                            {bed.lengthFt}&prime; × {bed.widthFt}&prime; · {area} sq ft
                          </Pill>
                        )}
                        <Pill tone={inIt.length === 0 ? "neutral" : "calm"}>
                          {inIt.length === 0 ? "empty" : `${inIt.length} growing`}
                        </Pill>
                      </>
                    }
                  >
                    {bed.soilNotes === undefined ? null : (
                      <p className="text-sm text-muted">{bed.soilNotes}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => onPlantHere(bed)}>
                        Plant something
                      </Button>
                      <Button variant="ghost" onClick={() => startEdit(bed)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void remove(bed)}>
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
          title={editing === undefined ? "New bed" : `Editing ${editing.name}`}
          description="Where it is, how big it is, and what the soil in it is like."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Name"
                required
                hint="What you call it out loud — &ldquo;the long bed&rdquo;, &ldquo;bed 3&rdquo;."
                value={draft.name}
                error={errors["name"]}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <Select
                label="Zone"
                required
                hint="The garden area it sits in. Garden areas are listed first."
                options={places.map((zone) => ({
                  value: zone.id,
                  label: zone.type === "garden_area" ? zone.name : `${zone.name} (${zone.type})`,
                }))}
                value={draft.zoneId}
                error={errors["zoneId"]}
                onChange={(event) => setDraft({ ...draft, zoneId: event.target.value })}
              />
              <Select
                label="Type"
                options={BED_TYPE_OPTIONS}
                value={draft.type}
                error={errors["type"]}
                onChange={(event) => setDraft({ ...draft, type: event.target.value as BedType })}
              />
              <div className="grid grid-cols-2 gap-density">
                <TextInput
                  label="Length (ft)"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  numeric
                  value={draft.lengthFt}
                  error={errors["lengthFt"]}
                  onChange={(event) => setDraft({ ...draft, lengthFt: event.target.value })}
                />
                <TextInput
                  label="Width (ft)"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  numeric
                  value={draft.widthFt}
                  error={errors["widthFt"]}
                  onChange={(event) => setDraft({ ...draft, widthFt: event.target.value })}
                />
              </div>
            </div>

            <Checkbox
              label="Still in use"
              hint="Untick a bed you have taken out. It keeps its plantings and its history and stops being offered."
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
            <TextArea
              label="Soil notes"
              rows={3}
              hint="What is in it, what it drains like, what was amended and when."
              value={draft.soilNotes}
              error={errors["soilNotes"]}
              onChange={(event) => setDraft({ ...draft, soilNotes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add bed" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
