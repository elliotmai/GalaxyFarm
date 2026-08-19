"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
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
  DEFAULT_ROTATION_YEARS,
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
  quantityLabel,
} from "@/app/(admin)/admin/garden/_components/labels";
import { familyHistory, familyOf, varietyLabel } from "@/lib/garden";
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

/** The statuses that mean something is standing in that ground right now. */
const LIVE_STATUSES: readonly PlantingStatus[] = ["growing", "harvesting"];

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
  const [showFinished, setShowFinished] = useState(false);

  const bedName = (id: Ulid) => beds.find((bed) => bed.id === id)?.name ?? "Unknown bed";
  const varietyOf = (id: Ulid) => varieties.find((variety) => variety.id === id);
  const nameOf = (id: Ulid) => varietyLabel(varietyOf(id), crops);

  const openBeds = beds.filter((bed) => bed.active);
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
      quantity: draft.quantity.trim() === "" ? undefined : Number(draft.quantity.trim()),
      notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
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
    const picked = harvests.filter((log) => log.plantingId === planting.id);
    const logs = care.filter((entry) => entry.plantingId === planting.id);
    const label = `${nameOf(planting.varietyId)} in ${bedName(planting.bedId)}`;

    const confirmed = await confirmDelete({
      tier: picked.length + logs.length > 0 ? "elevated" : "standard",
      recordName: label,
      entity: "planting",
      dependents: [
        ...picked.map((log) => ({
          entity: "Harvest",
          label: `${quantityLabel(log.quantity, log.unit)} on ${formatDate(log.harvestedOn)}`,
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

    for (const log of picked) await harvestApi.remove(log.id, "Planting deleted");
    for (const entry of logs) await careApi.remove(entry.id, "Planting deleted");

    show({
      message: `${label} deleted`,
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(planting.id);
            for (const log of picked) await harvestApi.restoreRecord(log.id);
            for (const entry of logs) await careApi.restoreRecord(entry.id);
          })();
        },
      },
    });
  }

  if (loading) return <p className="text-muted">Loading plantings…</p>;

  const shown = plantings.filter(
    (planting) => showFinished || !["finished", "failed"].includes(planting.status),
  );
  const sorted = [...shown].sort(
    (left, right) =>
      (right.plantedOn?.getTime() ?? right.createdAt.getTime()) -
      (left.plantedOn?.getTime() ?? left.createdAt.getTime()),
  );
  const closed = plantings.length - plantings.filter((planting) => shown.includes(planting)).length;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="In the ground"
        description="One record per variety per bed per go. The expected harvest is worked out from the variety's days to maturity, so correcting the planting date moves it."
        actions={
          <div className="flex flex-wrap gap-2">
            {closed === 0 ? null : (
              <Button variant="ghost" onClick={() => setShowFinished(!showFinished)}>
                {showFinished ? "Hide finished" : `Show ${closed} finished`}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={startCreate}
              disabled={openBeds.length === 0 || varieties.length === 0}
            >
              Plant something
            </Button>
          </div>
        }
      >
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
        ) : sorted.length === 0 ? (
          <EmptyState
            title={plantings.length === 0 ? "Nothing planted yet" : "Nothing growing"}
            detail={
              plantings.length === 0
                ? "Record what is in the ground. The rotation guard reads these, so it is worth entering the old ones too."
                : "Everything on record is finished or failed."
            }
            action={
              <Button variant="primary" onClick={startCreate} disabled={varieties.length === 0}>
                Plant something
              </Button>
            }
          />
        ) : (
          <CardGrid columns={3}>
            {sorted.map((planting) => {
              const variety = varietyOf(planting.varietyId);
              const harvest = totalHarvest(harvests, planting.id);
              const expected =
                variety === undefined ? undefined : expectedHarvestDate(planting, variety);
              const live = LIVE_STATUSES.includes(planting.status);

              return (
                <RecordCard
                  key={planting.id}
                  tone={
                    planting.status === "failed"
                      ? "danger"
                      : planting.status === "finished"
                        ? "neutral"
                        : planting.status === "harvesting"
                          ? "calm"
                          : "identity"
                  }
                  title={nameOf(planting.varietyId)}
                  subtitle={`${bedName(planting.bedId)} · ${METHOD_LABEL[planting.method]}`}
                  actions={
                    <Pill tone={live ? "calm" : "neutral"} dot={!live}>
                      {STATUS_LABEL[planting.status]}
                    </Pill>
                  }
                  meta={
                    <>
                      {planting.plantedOn === undefined ? (
                        <Pill tone="neutral">not in the ground yet</Pill>
                      ) : (
                        <Pill tone="neutral">planted {formatDate(planting.plantedOn)}</Pill>
                      )}
                      {expected === undefined ? (
                        <Pill tone="neutral">no days-to-maturity on the variety</Pill>
                      ) : (
                        <Pill tone="action">expect {formatDate(expected)}</Pill>
                      )}
                      {planting.quantity === undefined ? null : (
                        <Pill tone="neutral">{planting.quantity} in</Pill>
                      )}
                      {[...harvest.entries()].map(([unit, amount]) => (
                        <Pill key={unit} tone="calm">
                          {quantityLabel(amount, unit)} picked
                        </Pill>
                      ))}
                    </>
                  }
                >
                  {planting.notes === undefined ? null : (
                    <p className="text-sm text-muted">{planting.notes}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => startEdit(planting)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(planting)}>
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
          title={editing === undefined ? "New planting" : "Editing a planting"}
          description="Which variety, which bed, and when it went in."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            {/*
              Above the fields rather than beside the bed dropdown, and above
              rather than below: §5.5 asks for a visible warning, and the whole
              value of it is being seen before the bed is settled on.
            */}
            {warning === undefined ? null : (
              <Callout tone="danger" title="Rotation warning">
                <p>
                  {warning.family} was last in {bedName(warning.bedId)} on{" "}
                  {formatDate(warning.lastPlantedOn)} — {warning.yearsSince.toFixed(1)} years ago,
                  inside the {DEFAULT_ROTATION_YEARS}-year rotation. Same family means the same
                  soil-borne diseases and the same feeders.
                </p>
                <p className="mt-2 text-sm">
                  This does not stop you. If you know why you are doing it, say so in the notes and
                  save.
                </p>
              </Callout>
            )}

            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Bed"
                required
                options={[
                  { value: "", label: "Pick one" },
                  ...openBeds.map((bed) => ({ value: bed.id, label: bed.name })),
                ]}
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
                hint="Only for something started in a tray. Days to maturity is counted from the transplant, not from this."
                value={draft.indoorStartedOn}
                error={errors["indoorStartedOn"]}
                onChange={(event) => setDraft({ ...draft, indoorStartedOn: event.target.value })}
              />
              <TextInput
                label="Went in the ground"
                type="date"
                hint="The date the expected harvest is counted from."
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
                hint="Plants, or feet of row. Whatever you would count."
                value={draft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              hint="How it was spaced, what it followed, why — including why you planted against a rotation warning."
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined
                  ? warning === undefined
                    ? "Record planting"
                    : "Plant it anyway"
                  : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
