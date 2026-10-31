"use client";

import { useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  expectedHarvestDate,
  gardenCareLogSchema,
  harvestLogSchema,
  plantingSchema,
  rotationWarning,
  totalHarvest,
  type Bed,
  type Crop,
  type GardenCareLog,
  type HarvestLog,
  type Planting,
  type PlantingMethod,
  type PlantingStatus,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  METHOD_LABEL,
  METHOD_OPTIONS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  dateFromInput,
  dateInputValue,
  formatDate,
  optionalNumber,
  optionalText,
  quantityLabel,
} from "@/app/(admin)/admin/garden/_components/labels";
import { RotationCallout } from "@/app/(admin)/admin/garden/_components/rotation-callout";
import {
  AddAction,
  ChipGroup,
  FilteredLine,
  LandRow,
  RowList,
  type RowChip,
} from "@/app/(admin)/admin/pastures/_components/land-kit";
import { byId, familyHistory, familyOf, varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * What is in the ground, and the rotation guard (spec §5.5).
 *
 * **The warning appears while the planting is being written**, not in a report
 * somebody reads afterwards. That placement is the entire feature: rotation is
 * only actionable in the ten seconds before the transplants go in, and a
 * report that said "you should not have planted that" in November is a report
 * about a mistake rather than a check that prevents one.
 *
 * It is a warning and never a block. §5.5 says "visible warning", and a
 * gardener who knows the bed had nightshades in it last year and is planting
 * them anyway — because the other bed is under squash, because it is one plant,
 * because they are amending it — is not making a mistake. Refusing the save
 * would teach them to lie about the date.
 *
 * The expected harvest is derived rather than typed (§2). Correcting when
 * something actually went in has to move the harvest window with it, and a
 * stored copy is the one that would not.
 */

interface Draft {
  readonly bedId: string;
  readonly varietyId: string;
  readonly method: PlantingMethod;
  readonly indoorStartedOn: string;
  readonly plantedOn: string;
  readonly status: PlantingStatus;
  readonly quantity: string;
  readonly notes: string;
}

const BLANK: Draft = {
  bedId: "",
  varietyId: "",
  method: "transplant",
  indoorStartedOn: "",
  plantedOn: "",
  status: "growing",
  quantity: "",
  notes: "",
};

export function PlantingsPanel({
  plantings,
  beds,
  varieties,
  crops,
  harvests,
  care,
  loading,
  propertyId,
  actorId,
  focusedBedId,
  onNeedsBeds,
}: {
  readonly plantings: readonly Planting[];
  readonly beds: readonly Bed[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly harvests: readonly HarvestLog[];
  readonly care: readonly GardenCareLog[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly focusedBedId?: Ulid;
  readonly onNeedsBeds: () => void;
}) {
  const api = useMutations<Planting>("plantings", "plantings", plantingSchema, propertyId, actorId);
  // Deleting a planting takes its harvests and its care entries with it —
  // writes to two other tables.
  const harvestApi = useMutations<HarvestLog>(
    "harvestLogs",
    "harvestLogs",
    harvestLogSchema,
    propertyId,
    actorId,
  );
  const careApi = useMutations<GardenCareLog>(
    "gardenCareLogs",
    "gardenCareLogs",
    gardenCareLogSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Planting | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** A chip from the row above the list; "" is everything not finished or failed. */
  const [filter, setFilter] = useState("");

  const bedName = (id: Ulid) => byId(beds).get(id)?.name ?? "Unknown bed";
  const varietyOf = (id: Ulid) => byId(varieties).get(id);
  const nameOf = (id: Ulid) => varietyLabel(varietyOf(id), crops);

  const openBeds = beds.filter((bed) => bed.active);

  /**
   * The beds a planting can name: the ones in use, plus the one an existing
   * planting already names. A bed since switched off keeps its old plantings,
   * and opening one of them must show where it grew rather than quietly
   * offering the first bed on the list.
   */
  const bedOptions = (current: string) => [
    { value: "", label: "Pick one" },
    ...openBeds.map((bed) => ({ value: bed.id, label: bed.name })),
    ...(current === "" || openBeds.some((bed) => bed.id === current)
      ? []
      : [{ value: current, label: `${bedName(current as Ulid)} (switched off)` }]),
  ];

  /** What was picked from, and what was done to, each planting — gathered once. */
  const { harvestsOf, careOf } = useMemo(() => {
    const picked = new Map<Ulid, HarvestLog[]>();
    for (const log of harvests) {
      const list = picked.get(log.plantingId) ?? [];
      list.push(log);
      picked.set(log.plantingId, list);
    }
    const done = new Map<Ulid, GardenCareLog[]>();
    for (const entry of care) {
      if (entry.plantingId === undefined) continue;
      const list = done.get(entry.plantingId) ?? [];
      list.push(entry);
      done.set(entry.plantingId, list);
    }
    return {
      harvestsOf: (id: Ulid) => picked.get(id) ?? [],
      careOf: (id: Ulid) => done.get(id) ?? [],
    };
  }, [harvests, care]);

  const varietyOptions = [...varieties]
    .map((variety) => ({ value: variety.id, label: varietyLabel(variety, crops) }))
    .sort((left, right) => left.label.localeCompare(right.label));

  /**
   * The rotation warning for whatever the form currently says.
   *
   * Recomputed on every keystroke rather than on save, because the point is to
   * be visible while the bed is still being chosen — somebody who sees it as
   * they pick the bed will often just pick a different one, and that is the
   * outcome the guard is for.
   *
   * The planting being edited is excluded from its own history, or every edit
   * to an existing row would report that the bed already holds what is in it.
   */
  const warning = useMemo(() => {
    if (draft === undefined) return undefined;
    if (draft.bedId === "" || draft.varietyId === "") return undefined;

    const family = familyOf(draft.varietyId as Ulid, varieties, crops);
    if (family === undefined) return undefined;

    // Dated by what the form says, so moving a planting back a year moves the
    // warning with it rather than answering about today.
    const at = dateFromInput(draft.plantedOn) ?? new Date();

    return rotationWarning(
      draft.bedId as Ulid,
      family,
      familyHistory(plantings, varieties, crops, editing?.id),
      at,
    );
  }, [draft, plantings, varieties, crops, editing]);

  function startCreate() {
    setEditing(undefined);
    setDraft({
      ...BLANK,
      bedId: focusedBedId ?? openBeds[0]?.id ?? "",
      plantedOn: dateInputValue(new Date()),
    });
    setErrors({});
  }

  function startEdit(planting: Planting) {
    setEditing(planting);
    setDraft({
      bedId: planting.bedId,
      varietyId: planting.varietyId,
      method: planting.method,
      indoorStartedOn: dateInputValue(planting.indoorStartedOn),
      plantedOn: dateInputValue(planting.plantedOn),
      status: planting.status,
      quantity: planting.quantity === undefined ? "" : String(planting.quantity),
      notes: planting.notes ?? "",
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { bedId: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const fields = {
      bedId: draft.bedId as Ulid,
      varietyId: draft.varietyId as Ulid,
      method: draft.method,
      indoorStartedOn: dateFromInput(draft.indoorStartedOn),
      plantedOn: dateFromInput(draft.plantedOn),
      status: draft.status,
      quantity: optionalNumber(draft.quantity),
      notes: optionalText(draft.notes),
    };

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<Planting>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    // Said out loud on the way out, because the warning in the form is gone
    // the moment the modal closes and this is a decision worth remembering
    // having made.
    show({
      message:
        warning === undefined
          ? editing === undefined
            ? "Planting recorded"
            : "Planting saved"
          : `Recorded against the rotation warning — ${warning.family} was last in ${bedName(draft.bedId as Ulid)} ${formatDate(warning.lastPlantedOn)}`,
      tone: warning === undefined ? "success" : "warning",
    });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Delete a planting.
   *
   * **Cascade**, listed in the dialog: a harvest is a harvest *of* something
   * and a care entry against a planting is care *of* it, so neither means
   * anything once the planting is gone. Marking the planting failed or
   * finished is the move that keeps all three, and the dialog says so.
   */
  async function remove(planting: Planting) {
    const picked = harvestsOf(planting.id);
    const logs = careOf(planting.id);
    const label = `${nameOf(planting.varietyId)} in ${bedName(planting.bedId)}`;

    const confirmed = await confirmDelete({
      tier: picked.length + logs.length > 0 ? "elevated" : "standard",
      recordName: label,
      entity: "planting",
      dependents: [
        ...picked.map((log) => ({
          entity: "Harvest",
          label: `${quantityLabel(log.quantity, log.unit, "A picking")} on ${formatDate(log.harvestedOn)}`,
          effect: "deleted" as const,
        })),
        ...logs.map((entry) => ({
          entity: "Care entry",
          label: `${entry.action.replace(/_/g, " ")} on ${formatDate(entry.performedOn)}`,
          effect: "deleted" as const,
        })),
      ],
      consequence:
        picked.length + logs.length === 0
          ? "Nothing has been harvested from it or done to it."
          : "What was picked from it and what was done to it go with it. Marking it finished or failed instead keeps all of it, and keeps the bed's rotation history honest.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(planting.id, "Planting removed");
    if (!result.ok) {
      show({ message: "Could not delete that planting", tone: "danger" });
      return;
    }

    // Together rather than one at a time: each is a local write, and the
    // toast should not wait on the slowest of a season's harvests in turn.
    await Promise.all([
      ...picked.map((log) => harvestApi.remove(log.id, "Planting deleted")),
      ...logs.map((entry) => careApi.remove(entry.id, "Planting deleted")),
    ]);

    show({
      message: `${label} deleted`,
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(planting.id);
            await Promise.all([
              ...picked.map((log) => harvestApi.restoreRecord(log.id)),
              ...logs.map((entry) => careApi.restoreRecord(entry.id)),
            ]);
          })();
        },
      },
    });
  }

  if (loading) return <p className="text-muted">Loading plantings…</p>;

  const closedOf = (planting: Planting) => ["finished", "failed"].includes(planting.status);
  const inGroup = (planting: Planting, key: string) =>
    key === ""
      ? !closedOf(planting)
      : key === "planned"
        ? planting.status === "planned" || planting.status === "started"
        : key === "closed"
          ? closedOf(planting)
          : planting.status === key;

  // Counted over every planting, not the shown ones: these are what the
  // filter is chosen from.
  const chips = [
    { key: "", label: "Current", count: plantings.filter((p) => inGroup(p, "")).length },
    {
      key: "planned",
      label: "Planned",
      count: plantings.filter((p) => inGroup(p, "planned")).length,
    },
    {
      key: "growing",
      label: "Growing",
      count: plantings.filter((p) => inGroup(p, "growing")).length,
    },
    {
      key: "harvesting",
      label: "Harvesting",
      count: plantings.filter((p) => inGroup(p, "harvesting")).length,
    },
    {
      key: "closed",
      label: "Finished",
      count: plantings.filter((p) => inGroup(p, "closed")).length,
    },
  ].filter((chip) => chip.key === "" || chip.count > 0);

  const shown = plantings.filter((planting) => inGroup(planting, filter));
  const sorted = [...shown].sort(
    (left, right) =>
      (right.plantedOn?.getTime() ?? right.createdAt.getTime()) -
      (left.plantedOn?.getTime() ?? left.createdAt.getTime()),
  );
  const canPlant = openBeds.length > 0 && varieties.length > 0;

  /** The one line: where, how, when it went in, when to expect it, how much came off. */
  function lineFor(planting: Planting): string {
    const variety = varietyOf(planting.varietyId);
    const expected = variety === undefined ? undefined : expectedHarvestDate(planting, variety);
    const harvest = totalHarvest(harvestsOf(planting.id), planting.id);
    return [
      bedName(planting.bedId),
      METHOD_LABEL[planting.method],
      planting.plantedOn === undefined
        ? "not in the ground yet"
        : `planted ${formatDate(planting.plantedOn)}`,
      // Only while something is still to come: an expected date on a
      // finished row is a forecast about the past.
      expected === undefined || closedOf(planting) ? undefined : `expect ${formatDate(expected)}`,
      planting.quantity === undefined ? undefined : `${planting.quantity} in`,
      ...[...harvest.entries()].map(([unit, amount]) => `${quantityLabel(amount, unit)} picked`),
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  /** Growing is the normal state and goes unsaid; everything else is the chip. */
  function chipFor(planting: Planting): RowChip | undefined {
    if (planting.status === "growing") return undefined;
    return {
      tone:
        planting.status === "failed"
          ? "danger"
          : planting.status === "harvesting"
            ? "calm"
            : "neutral",
      label: STATUS_LABEL[planting.status],
    };
  }

  return (
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      {openBeds.length === 0 ? (
        <EmptyState
          title="No beds to plant in"
          detail="A planting names the ground it is in. Add a bed first."
          action={
            <Button variant="primary" onClick={onNeedsBeds}>
              Go to beds
            </Button>
          }
        />
      ) : (
        <>
          {/*
            One record per variety per bed per go. The expected harvest is
            worked out from the variety's days to maturity, so correcting the
            planting date moves it.
          */}
          <div className="flex items-center justify-between gap-density">
            <div className="min-w-0 flex-1">
              <ChipGroup
                label="Filter plantings"
                chips={chips}
                value={filter}
                onChange={setFilter}
              />
            </div>
            <AddAction label="Plant something" onClick={startCreate} disabled={!canPlant} />
          </div>

          <FilteredLine
            shown={sorted.length}
            total={plantings.length}
            labels={filter === "" ? [] : [chips.find((chip) => chip.key === filter)?.label ?? ""]}
            onClear={() => setFilter("")}
          />

          {sorted.length === 0 ? (
            <EmptyState
              title={plantings.length === 0 ? "Nothing planted yet" : "Nothing here"}
              detail={
                plantings.length === 0
                  ? "Record what is in the ground. The rotation guard reads these, so enter the old ones too."
                  : filter === ""
                    ? "Everything on record is finished or failed."
                    : undefined
              }
              {...(plantings.length === 0
                ? {
                    action: (
                      <Button variant="primary" onClick={startCreate} disabled={!canPlant}>
                        Plant something
                      </Button>
                    ),
                  }
                : {})}
            />
          ) : (
            <RowList label="Plantings">
              {sorted.map((planting) => (
                <LandRow
                  key={planting.id}
                  title={nameOf(planting.varietyId)}
                  openLabel={`Edit ${nameOf(planting.varietyId)} in ${bedName(planting.bedId)}`}
                  line={lineFor(planting)}
                  chip={chipFor(planting)}
                  quiet={closedOf(planting)}
                  onOpen={() => startEdit(planting)}
                />
              ))}
            </RowList>
          )}
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "New planting" : "Editing a planting"}
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined
                  ? warning === undefined
                    ? "Record planting"
                    : "Plant it anyway"
                  : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                // Delete lives here now the row has no room for it. The editor
                // closes first, so the confirmation is the only dialog open.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const planting = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(planting);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            {/*
              Above the fields rather than beside the bed dropdown, and above
              rather than below: §5.5 asks for a visible warning, and the whole
              value of it is being seen before the bed is settled on.
            */}
            {warning === undefined ? null : (
              <RotationCallout warning={warning} bedName={bedName(warning.bedId)}>
                A warning, not a block. Say why in the notes and save.
              </RotationCallout>
            )}

            <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
              <Select
                label="Bed"
                required
                options={bedOptions(draft.bedId)}
                value={draft.bedId}
                error={errors["bedId"]}
                onChange={(event) => setDraft({ ...draft, bedId: event.target.value })}
              />
              <Select
                label="Variety"
                required
                options={[{ value: "", label: "Pick one" }, ...varietyOptions]}
                value={draft.varietyId}
                error={errors["varietyId"]}
                onChange={(event) => setDraft({ ...draft, varietyId: event.target.value })}
              />
              <Select
                label="Method"
                options={METHOD_OPTIONS}
                value={draft.method}
                error={errors["method"]}
                onChange={(event) =>
                  setDraft({ ...draft, method: event.target.value as PlantingMethod })
                }
              />
              <Select
                label="Status"
                options={STATUS_OPTIONS}
                value={draft.status}
                error={errors["status"]}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as PlantingStatus })
                }
              />
              <TextInput
                label="Started indoors"
                type="date"
                hint="Only for a tray start. Maturity counts from the transplant."
                value={draft.indoorStartedOn}
                error={errors["indoorStartedOn"]}
                onChange={(event) => setDraft({ ...draft, indoorStartedOn: event.target.value })}
              />
              <TextInput
                label="Went in the ground"
                type="date"
                hint="The expected harvest counts from this."
                value={draft.plantedOn}
                error={errors["plantedOn"]}
                onChange={(event) => setDraft({ ...draft, plantedOn: event.target.value })}
              />
              <TextInput
                label="How many"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                numeric
                hint="Plants, or feet of row."
                value={draft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              hint="Spacing, what it followed — and why, if against a rotation warning."
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
