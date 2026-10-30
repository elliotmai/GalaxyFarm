"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Modal,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  cropFamily,
  cropSchema,
  inferFamily,
  normaliseFamily,
  seedInventorySchema,
  varietySchema,
  type Crop,
  type PlannedPlanting,
  type Planting,
  type SeedInventory,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  optionalNumber,
  optionalText,
  quantityLabel,
} from "@/app/(admin)/admin/garden/_components/labels";
import {
  PlantSuggestions,
  type PlantPick,
} from "@/app/(admin)/admin/garden/seeds/_components/plant-suggestions";
import {
  AddAction,
  ChipGroup,
  FilteredLine,
  LandRow,
  RowAction,
  RowList,
  StatusLine,
} from "@/app/(admin)/admin/pastures/_components/land-kit";
import { byId, cropFields } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * The catalogue the rest of the garden is written against (spec §5.5).
 *
 * A crop carries the **botanical family**, and that field is the whole reason
 * crops are a record rather than a string on each variety. The rotation guard
 * runs on the family: tomatoes following peppers is the mistake rotation
 * exists to prevent, and a check on the crop name would wave it through.
 *
 * **Nobody is asked for the family any more.** It is inferred from the crop's
 * name by the built-in table in the garden module (`cropFamily`), offline, so
 * "Tomato" is a nightshade the moment it is typed. The name box doubles as a
 * plant search (`PlantSuggestions`, backed by `/api/plants/search`): picking a
 * match fills the name, the scientific name and — for a plant the table does
 * not know — the family GBIF gives. The family can still be set by hand,
 * behind a disclosure, for the gardener who knows better than the table.
 *
 * **Deleting a variety is `restrict` (§4.5).** A planting or a plan that names
 * it is a record about ground and a record about a season, and neither
 * survives losing what was in it. Seed *does* go with the variety, because a
 * packet is of that variety and of nothing else.
 */

interface CropDraft {
  readonly name: string;
  readonly scientificName: string;
  /** "" is "infer it from the name"; anything else is an override. */
  readonly family: string;
  readonly notes: string;
}

interface VarietyDraft {
  readonly cropId: string;
  readonly name: string;
  readonly daysToMaturity: string;
  readonly spacingInches: string;
  readonly source: string;
  readonly notes: string;
}

const BLANK_CROP: CropDraft = { name: "", scientificName: "", family: "", notes: "" };

const BLANK_VARIETY: VarietyDraft = {
  cropId: "",
  name: "",
  daysToMaturity: "",
  spacingInches: "",
  source: "",
  notes: "",
};

/** The crop picker's value for "the plant you just found, as a new crop". */
const NEW_CROP = "__new-crop";

/**
 * Families worth offering, so the common ones are picked rather than spelled.
 *
 * A datalist rather than a closed dropdown: this is not an exhaustive list of
 * plant families and a garden that grows something unusual must not be stuck.
 */
const COMMON_FAMILIES = [
  "Solanaceae",
  "Cucurbitaceae",
  "Brassicaceae",
  "Fabaceae",
  "Apiaceae",
  "Asteraceae",
  "Amaryllidaceae",
  "Amaranthaceae",
  "Poaceae",
  "Malvaceae",
  "Lamiaceae",
];

/** "Solanaceae", or a plain admission that rotation has nothing to go on. */
function familyLine(crop: Crop): string {
  return cropFamily(crop) ?? "family unknown — rotation not checked";
}

export function CatalogPanel({
  crops,
  varieties,
  seed,
  plantings,
  planned,
  loading,
  propertyId,
  actorId,
}: {
  readonly crops: readonly Crop[];
  readonly varieties: readonly Variety[];
  readonly seed: readonly SeedInventory[];
  readonly plantings: readonly Planting[];
  readonly planned: readonly PlannedPlanting[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  if (loading) return <p className="text-muted">Loading the catalogue…</p>;

  return (
    // Varieties lead: they are what gets looked up and added to. Crops are
    // the short list behind them, changed a few times a year.
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      <Varieties
        crops={crops}
        varieties={varieties}
        seed={seed}
        plantings={plantings}
        planned={planned}
        propertyId={propertyId}
        actorId={actorId}
      />
      <Crops crops={crops} varieties={varieties} propertyId={propertyId} actorId={actorId} />
    </div>
  );
}

function Crops({
  crops,
  varieties,
  propertyId,
  actorId,
}: {
  readonly crops: readonly Crop[];
  readonly varieties: readonly Variety[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<Crop>("crops", "crops", cropSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Crop | undefined>();
  const [draft, setDraft] = useState<CropDraft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** True while the name is being typed; a pick or an opened record stops it. */
  const [searching, setSearching] = useState(false);

  // Grouped once, so each crop row is a lookup rather than a scan.
  const varietiesByCrop = useMemo(() => {
    const map = new Map<Ulid, Variety[]>();
    for (const variety of varieties) {
      const list = map.get(variety.cropId) ?? [];
      list.push(variety);
      map.set(variety.cropId, list);
    }
    return map;
  }, [varieties]);
  const varietiesOf = (cropId: Ulid) => varietiesByCrop.get(cropId) ?? [];

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK_CROP);
    setErrors({});
    setSearching(false);
  }

  function startEdit(crop: Crop) {
    setEditing(crop);
    setDraft({
      name: crop.name,
      scientificName: crop.scientificName ?? "",
      family: crop.family ?? "",
      notes: crop.notes ?? "",
    });
    setErrors({});
    setSearching(false);
  }

  function pick(match: PlantPick) {
    if (draft === undefined) return;
    setDraft({
      ...draft,
      name: match.commonName,
      scientificName: match.scientificName,
      family: match.family ?? "",
    });
    setSearching(false);
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const fields = cropFields(draft);

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<Crop>);

    if (!result.ok) {
      setErrors(fieldErrors(result.error, "name"));
      return;
    }

    show({ message: editing === undefined ? "Crop added" : "Crop saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Deleting a crop is **restrict** while it has varieties.
   *
   * Not cascade: a variety carries days to maturity, spacing and a source, and
   * every planting and plan on the place names one. Taking a dozen of them out
   * because somebody tidied up the crop list is a loss nobody would choose,
   * and the alternative — delete the varieties first, deliberately — is one
   * screen away and says what it is doing.
   */
  async function remove(crop: Crop) {
    const owned = varietiesOf(crop.id);

    if (owned.length > 0) {
      show({
        message: `${crop.name} still has ${owned.map((variety) => variety.name).join(", ")}. Delete those varieties first.`,
        tone: "warning",
      });
      return;
    }

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: crop.name,
      entity: "crop",
      dependents: [],
      consequence: "No varieties are filed under it.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(crop.id, "Removed from the crop list");
    if (!result.ok) {
      show({ message: `Could not delete ${crop.name}`, tone: "danger" });
      return;
    }

    show({
      message: `${crop.name} deleted`,
      action: { label: "Undo", onAct: () => void api.restoreRecord(crop.id) },
    });
  }

  // What the family would be with nothing typed in the override.
  const inferred =
    draft === undefined ? undefined : inferFamily(draft.name, optionalText(draft.scientificName));
  const effective = draft === undefined ? undefined : (normaliseFamily(draft.family) ?? inferred);

  return (
    // The family is what the rotation guard checks, so two nightshades filed
    // under the same family is the point rather than an accident.
    <Section title="Crops" actions={<RowAction onClick={startCreate}>+ Add crop</RowAction>}>
      {crops.length === 0 ? (
        <p className="text-sm text-muted">
          No crops yet. Add tomatoes, then the varieties under them.
        </p>
      ) : (
        <RowList label="Crops">
          {[...crops]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((crop) => {
              const count = varietiesOf(crop.id).length;
              return (
                <LandRow
                  key={crop.id}
                  title={crop.name}
                  openLabel={`Edit ${crop.name}`}
                  line={[
                    familyLine(crop),
                    `${count} variet${count === 1 ? "y" : "ies"}`,
                    crop.notes,
                  ]
                    .filter((part) => part !== undefined)
                    .join(" · ")}
                  onOpen={() => startEdit(crop)}
                />
              );
            })}
        </RowList>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new-crop"}
          placement="side"
          title={editing === undefined ? "New crop" : `Editing ${editing.name}`}
          description="Type a name or pick a match — the family is worked out for you."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add crop" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const crop = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(crop);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <div className="flex flex-col gap-1">
              <TextInput
                label="Name"
                required
                placeholder="Tomato"
                autoComplete="off"
                value={draft.name}
                error={errors["name"]}
                onChange={(event) => {
                  // A new name is a new plant: the scientific name a pick
                  // filled in no longer describes it.
                  setDraft({ ...draft, name: event.target.value, scientificName: "" });
                  setSearching(true);
                }}
              />
              {searching ? (
                <PlantSuggestions
                  query={draft.name}
                  onPick={pick}
                  label="Plants matching the name"
                />
              ) : null}
            </div>

            {/*
              The family as a sentence, and the override behind it: nobody
              should have to know it, and somebody who does can still say so.
            */}
            <details className="group text-sm" open={errors["family"] !== undefined}>
              <summary className="flex min-h-target cursor-pointer list-none flex-wrap items-center gap-x-2 [&::-webkit-details-marker]:hidden">
                <span className="text-muted">Family</span>
                <span className="font-medium text-ink">
                  {effective ?? (draft.name.trim() === "" ? "from the name" : "not known")}
                </span>
                {effective !== undefined && normaliseFamily(draft.family) === undefined ? (
                  <span className="text-muted">(worked out from the name)</span>
                ) : null}
                <span className="font-semibold text-action">Change</span>
              </summary>
              <div className="flex flex-col gap-density pt-2 sm:grid sm:grid-cols-2">
                <TextInput
                  label="Botanical family"
                  list="garden-families"
                  placeholder={inferred ?? "Solanaceae"}
                  hint="Leave blank to use the one worked out from the name. Rotation is checked on this."
                  value={draft.family}
                  error={errors["family"]}
                  onChange={(event) => setDraft({ ...draft, family: event.target.value })}
                />
                <TextInput
                  label="Scientific name"
                  placeholder="Solanum lycopersicum"
                  value={draft.scientificName}
                  error={errors["scientificName"]}
                  onChange={(event) => setDraft({ ...draft, scientificName: event.target.value })}
                />
                <datalist id="garden-families">
                  {COMMON_FAMILIES.map((family) => (
                    <option key={family} value={family} />
                  ))}
                </datalist>
              </div>
            </details>

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
    </Section>
  );
}

function Varieties({
  crops,
  varieties,
  seed,
  plantings,
  planned,
  propertyId,
  actorId,
}: {
  readonly crops: readonly Crop[];
  readonly varieties: readonly Variety[];
  readonly seed: readonly SeedInventory[];
  readonly plantings: readonly Planting[];
  readonly planned: readonly PlannedPlanting[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<Variety>("varieties", "varieties", varietySchema, propertyId, actorId);
  // Deleting a variety takes its seed with it, which is a write to another
  // table and so needs its own mutations.
  const seedApi = useMutations<SeedInventory>(
    "seedInventory",
    "seedInventory",
    seedInventorySchema,
    propertyId,
    actorId,
  );
  // A variety found through the plant search may bring a crop nobody has
  // recorded yet, which is created on save.
  const cropApi = useMutations<Crop>("crops", "crops", cropSchema, propertyId, actorId);

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Variety | undefined>();
  const [draft, setDraft] = useState<VarietyDraft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** What is typed into "Find the plant". */
  const [plantQuery, setPlantQuery] = useState("");
  /** A plant picked from the search that is not in the crop list yet. */
  const [newCrop, setNewCrop] = useState<PlantPick | undefined>();

  const cropName = (cropId: Ulid) => byId(crops).get(cropId)?.name;

  /** What stands in the way of deleting each variety, and what goes with it. */
  const usage = useMemo(() => {
    const map = new Map<Ulid, { blocking: string[]; seed: SeedInventory[] }>();
    const entry = (varietyId: Ulid) => {
      const current = map.get(varietyId) ?? { blocking: [], seed: [] };
      map.set(varietyId, current);
      return current;
    };

    for (const planting of plantings) entry(planting.varietyId).blocking.push("a planting");
    for (const plan of planned) entry(plan.varietyId).blocking.push("a season plan");
    for (const packet of seed) entry(packet.varietyId).seed.push(packet);

    return map;
  }, [plantings, planned, seed]);

  function open(next: VarietyDraft, variety: Variety | undefined) {
    setEditing(variety);
    setDraft(next);
    setErrors({});
    setPlantQuery("");
    setNewCrop(undefined);
  }

  function startEdit(variety: Variety) {
    open(
      {
        cropId: variety.cropId,
        name: variety.name,
        daysToMaturity: variety.daysToMaturity === undefined ? "" : String(variety.daysToMaturity),
        spacingInches: variety.spacingInches === undefined ? "" : String(variety.spacingInches),
        source: variety.source ?? "",
        notes: variety.notes ?? "",
      },
      variety,
    );
  }

  /**
   * A plant picked from the search: the crop it already is, or a new one.
   *
   * Matched on the scientific name first — "Solanum lycopersicum" is the same
   * plant whatever the crop was called when it was typed — then on the name.
   */
  function pickPlant(match: PlantPick) {
    if (draft === undefined) return;
    const fold = (value: string | undefined) => (value ?? "").trim().toLowerCase();
    const existing =
      crops.find(
        (crop) =>
          crop.scientificName !== undefined &&
          fold(crop.scientificName) === fold(match.scientificName) &&
          fold(crop.name) === fold(match.commonName),
      ) ??
      crops.find((crop) => fold(crop.name) === fold(match.commonName)) ??
      crops.find(
        (crop) =>
          crop.scientificName !== undefined &&
          fold(crop.scientificName) === fold(match.scientificName),
      );

    setPlantQuery("");
    if (existing !== undefined) {
      setNewCrop(undefined);
      setDraft({ ...draft, cropId: existing.id });
    } else {
      setNewCrop(match);
      setDraft({ ...draft, cropId: NEW_CROP });
    }
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    let cropId = draft.cropId;
    if (cropId === NEW_CROP && newCrop !== undefined) {
      const created = await cropApi.create(
        cropFields({
          name: newCrop.commonName,
          scientificName: newCrop.scientificName,
          family: newCrop.family ?? "",
        }) as never,
      );
      if (!created.ok) {
        setErrors({ cropId: "Could not add that crop. Add it under Crops, then pick it." });
        return;
      }
      // Pointed at the real crop now, so a retry after a variety error does
      // not add the same crop twice.
      cropId = created.value.id;
      setNewCrop(undefined);
      setDraft({ ...draft, cropId });
    }

    const fields = {
      cropId: cropId as Ulid,
      name: draft.name.trim(),
      daysToMaturity: optionalNumber(draft.daysToMaturity),
      spacingInches: optionalNumber(draft.spacingInches),
      source: optionalText(draft.source),
      notes: optionalText(draft.notes),
    };

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<Variety>);

    if (!result.ok) {
      setErrors(fieldErrors(result.error, "name"));
      return;
    }

    show({ message: editing === undefined ? "Variety added" : "Variety saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * **Restrict**, and it is the §4.5 case the acceptance criteria name.
   *
   * A planting is the record of what was in that bed that year and a planned
   * planting is a decision somebody made about a season; neither means
   * anything with the variety removed from under it, and neither is something
   * a tidy-up should be allowed to take. So the delete is refused and the
   * dependents are named — "still named by a planting" is actionable in a way
   * that "could not delete" is not.
   *
   * Seed **cascades**. A packet is of that variety and of nothing else, so it
   * is listed in the dialog and goes with it — restorable together, because
   * the undo puts back both.
   */
  async function remove(variety: Variety) {
    const found = usage.get(variety.id);
    const blocking = [...new Set(found?.blocking ?? [])];
    const packets = found?.seed ?? [];

    if (blocking.length > 0) {
      show({
        message: `${variety.name} is still named by ${blocking.join(" and ")}. Delete or re-point those first.`,
        tone: "warning",
      });
      return;
    }

    const confirmed = await confirmDelete({
      // Elevated once seed hangs off it: §4.5 puts a record with dependents
      // above the standard tier, and the dialog lists them.
      tier: packets.length > 0 ? "elevated" : "standard",
      recordName: variety.name,
      entity: "variety",
      dependents: packets.map((packet) => ({
        entity: "Seed",
        label: quantityLabel(packet.quantity, packet.unit, "Seed, not counted"),
        effect: "deleted" as const,
      })),
      consequence:
        packets.length === 0
          ? "Nothing is planted, planned, or in the box against it."
          : "The seed in the box goes with it — a packet is of this variety and nothing else.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(variety.id, "Removed from the catalogue");
    if (!result.ok) {
      show({ message: `Could not delete ${variety.name}`, tone: "danger" });
      return;
    }

    // Together: each is a local write and none waits on another.
    await Promise.all(
      packets.map((packet) => seedApi.remove(packet.id, `Variety ${variety.name} deleted`)),
    );

    show({
      message: `${variety.name} deleted`,
      action: {
        label: "Undo",
        // Both halves, or the undo is a lie.
        onAct: () => {
          void (async () => {
            await api.restoreRecord(variety.id);
            await Promise.all(packets.map((packet) => seedApi.restoreRecord(packet.id)));
          })();
        },
      },
    });
  }

  const [cropFilter, setCropFilter] = useState("");

  /** The one line: what crop, how long, how far apart, what uses it. */
  function lineFor(variety: Variety): string {
    const found = usage.get(variety.id);
    const packets = found?.seed.length ?? 0;
    return [
      cropName(variety.cropId) ?? "unfiled",
      variety.daysToMaturity === undefined ? undefined : `${variety.daysToMaturity} days`,
      variety.spacingInches === undefined ? undefined : `${variety.spacingInches}" apart`,
      packets === 0 ? undefined : `${packets} in the box`,
      ...new Set(found?.blocking ?? []),
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  const sorted = [...varieties].sort(
    (left, right) =>
      (cropName(left.cropId) ?? "").localeCompare(cropName(right.cropId) ?? "") ||
      left.name.localeCompare(right.name),
  );
  // The crops that have varieties, as the chips — the filter is "which
  // tomato", and a crop with nothing under it has nothing to show.
  const perCrop = new Map<Ulid, number>();
  for (const variety of varieties) {
    perCrop.set(variety.cropId, (perCrop.get(variety.cropId) ?? 0) + 1);
  }
  const chips = [
    { key: "", label: "All", count: varieties.length },
    ...[...crops]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((crop) => ({ key: crop.id, label: crop.name, count: perCrop.get(crop.id) ?? 0 }))
      .filter((chip) => chip.count > 0),
  ];
  const shown = sorted.filter((variety) => cropFilter === "" || variety.cropId === cropFilter);

  const cropOptions = [
    { value: "", label: "Pick one" },
    ...(newCrop === undefined
      ? []
      : [
          {
            value: NEW_CROP,
            label: `${newCrop.commonName} — new crop (${newCrop.family ?? "family unknown"})`,
          },
        ]),
    ...[...crops]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((crop) => ({
        value: crop.id,
        label: `${crop.name} (${cropFamily(crop) ?? "family unknown"})`,
      })),
  ];

  return (
    // Days to maturity is what the expected harvest date is worked out from,
    // so it is the field worth copying off the packet.
    <Section
      title="Varieties"
      actions={<AddAction label="Add variety" onClick={() => open(BLANK_VARIETY, undefined)} />}
    >
      {crops.length === 0 ? (
        <StatusLine tone="action">
          Add a variety and find its plant — the crop is filed for you.
        </StatusLine>
      ) : null}

      {varieties.length === 0 ? (
        <p className="text-sm text-muted">No varieties yet.</p>
      ) : (
        <>
          {chips.length <= 2 ? null : (
            <ChipGroup
              label="Filter by crop"
              chips={chips}
              value={cropFilter}
              onChange={setCropFilter}
            />
          )}
          <FilteredLine
            shown={shown.length}
            total={varieties.length}
            labels={cropFilter === "" ? [] : [cropName(cropFilter as Ulid) ?? "A crop"]}
            onClear={() => setCropFilter("")}
          />
          <RowList label="Varieties">
            {shown.map((variety) => (
              <LandRow
                key={variety.id}
                title={variety.name}
                openLabel={`Edit ${variety.name}`}
                line={lineFor(variety)}
                onOpen={() => startEdit(variety)}
              />
            ))}
          </RowList>
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new-variety"}
          placement="side"
          title={editing === undefined ? "New variety" : `Editing ${editing.name}`}
          description="Off the packet: name, days to maturity, spacing."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add variety" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const variety = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(variety);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            {/* The plant first: it files the variety under its crop, adding
                the crop if the list does not have it yet. */}
            <div className="flex flex-col gap-1">
              <TextInput
                label="Find the plant"
                placeholder="Tomato, okra, basil…"
                autoComplete="off"
                hint="Picks the crop below, or adds it."
                value={plantQuery}
                onChange={(event) => setPlantQuery(event.target.value)}
              />
              <PlantSuggestions query={plantQuery} onPick={pickPlant} />
            </div>

            <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
              <Select
                label="Crop"
                required
                options={cropOptions}
                value={draft.cropId}
                error={errors["cropId"]}
                onChange={(event) => setDraft({ ...draft, cropId: event.target.value })}
              />
              <TextInput
                label="Name"
                required
                placeholder="Cherokee Purple"
                value={draft.name}
                error={errors["name"]}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <TextInput
                label="Days to maturity"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                numeric
                hint="From transplant, for a transplanted crop."
                value={draft.daysToMaturity}
                error={errors["daysToMaturity"]}
                onChange={(event) => setDraft({ ...draft, daysToMaturity: event.target.value })}
              />
              <TextInput
                label="Spacing (inches)"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                numeric
                value={draft.spacingInches}
                error={errors["spacingInches"]}
                onChange={(event) => setDraft({ ...draft, spacingInches: event.target.value })}
              />
              <TextInput
                label="Source"
                value={draft.source}
                error={errors["source"]}
                onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              placeholder="How it did, how it tasted, whether it cracked"
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
        </Modal>
      )}
    </Section>
  );
}

/** §4.5 clause 2: the message lands on the field that caused it. */
function fieldErrors(error: CrudError, fallbackField: string): Record<string, string> {
  return error.kind === "validation"
    ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
    : { [fallbackField]: "Could not save. Check the fields and try again." };
}
