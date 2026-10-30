"use client";

import { useEffect, useState } from "react";

import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
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

import {
  BED_TYPE_LABEL,
  BED_TYPE_OPTIONS,
  optionalNumber,
  optionalText,
} from "@/app/(admin)/admin/garden/_components/labels";
import {
  AddAction,
  LandRow,
  RowAction,
  RowList,
  StatusLine,
} from "@/app/(admin)/admin/pastures/_components/land-kit";
import { byId } from "@/lib/garden";
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
  openBedId,
}: {
  readonly beds: readonly Bed[];
  readonly zones: readonly Zone[];
  readonly plantings: readonly Planting[];
  readonly care: readonly GardenCareLog[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onPlantHere: (bed: Bed) => void;
  /** A bed to open for editing on arrival — the layout's rows link here. */
  readonly openBedId?: Ulid | undefined;
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

  const zoneName = (id: Ulid) => byId(zones).get(id)?.name;

  // Arriving from the layout's "Edit" on a bed: open that bed, once it has
  // loaded. Only once per arrival, so closing the editor keeps it closed.
  const [opened, setOpened] = useState<Ulid | undefined>();
  useEffect(() => {
    if (openBedId === undefined || opened === openBedId) return;
    const bed = byId(beds).get(openBedId);
    if (bed === undefined) return;
    setOpened(openBedId);
    startEdit(bed);
    // `startEdit` is a plain function of this render; what matters is the bed.
  }, [openBedId, opened, beds]);

  /** What is growing in each bed, counted once rather than per row. */
  const growingIn = new Map<Ulid, number>();
  for (const planting of plantings) {
    if (planting.status !== "growing" && planting.status !== "harvesting") continue;
    growingIn.set(planting.bedId, (growingIn.get(planting.bedId) ?? 0) + 1);
  }

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

    const number = optionalNumber;
    const fields = {
      zoneId: draft.zoneId as Ulid,
      name: draft.name.trim(),
      type: draft.type,
      lengthFt: number(draft.lengthFt),
      widthFt: number(draft.widthFt),
      soilNotes: optionalText(draft.soilNotes),
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

    // Together: each is a local write, and none waits on another.
    await Promise.all(logs.map((entry) => careApi.remove(entry.id, `Bed ${bed.name} deleted`)));

    show({
      message: `${bed.name} deleted`,
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(bed.id);
            await Promise.all(logs.map((entry) => careApi.restoreRecord(entry.id)));
          })();
        },
      },
    });
  }

  if (loading) return <p className="text-muted">Loading beds…</p>;

  /** The one line: what it is, where, how big, what is in it. */
  function lineFor(bed: Bed): string {
    const area = bedAreaSqFt(bed);
    const inIt = growingIn.get(bed.id) ?? 0;
    return [
      BED_TYPE_LABEL[bed.type],
      zoneName(bed.zoneId),
      area === undefined ? "no dimensions" : `${bed.lengthFt}′ × ${bed.widthFt}′ · ${area} sq ft`,
      inIt === 0 ? "empty" : `${inIt} growing`,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  return (
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      {places.length === 0 ? (
        <StatusLine tone="action">
          A bed sits inside a zone. Add a garden area under Settings → Property first.
        </StatusLine>
      ) : null}

      {/* Raised beds, rows, containers and open ground. Drawing them is the
          layout screen's; recording them does not have to wait for it. */}
      {beds.length === 0 ? (
        <EmptyState
          title="No beds yet"
          detail="Add the beds you have. Length and width give the square footage — whether the tomatoes fit."
          action={
            <Button variant="primary" onClick={startCreate} disabled={places.length === 0}>
              Add the first bed
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-end">
            <AddAction label="Add bed" onClick={startCreate} disabled={places.length === 0} />
          </div>
          <RowList label="Beds">
            {[...beds]
              .sort(
                (left, right) =>
                  Number(right.active) - Number(left.active) || left.name.localeCompare(right.name),
              )
              .map((bed) => (
                <LandRow
                  key={bed.id}
                  title={bed.name}
                  openLabel={`Edit ${bed.name}`}
                  line={lineFor(bed)}
                  chip={bed.active ? undefined : { tone: "neutral", label: "Switched off" }}
                  quiet={!bed.active}
                  onOpen={() => startEdit(bed)}
                  action={
                    bed.active ? (
                      <RowAction
                        label={`Plant something in ${bed.name}`}
                        onClick={() => onPlantHere(bed)}
                      >
                        Plant
                      </RowAction>
                    ) : undefined
                  }
                />
              ))}
          </RowList>
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "New bed" : `Editing ${editing.name}`}
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add bed" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                // Delete lives here now the row has no room for it; the editor
                // closes first so the confirmation (or the refusal) stands alone.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const bed = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(bed);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
              <TextInput
                label="Name"
                required
                placeholder="The long bed"
                value={draft.name}
                error={errors["name"]}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <Select
                label="Zone"
                required
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
              hint="Untick a bed taken out. It keeps its history and stops being offered."
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
            <TextArea
              label="Soil notes"
              rows={3}
              placeholder="What is in it, how it drains, what was amended"
              value={draft.soilNotes}
              error={errors["soilNotes"]}
              onChange={(event) => setDraft({ ...draft, soilNotes: event.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
