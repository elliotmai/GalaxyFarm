"use client";

import Link from "next/link";
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
  cropGrowing,
  cropSchema,
  gardenCropFor,
  gardenEntryFor,
  GROWING,
  inferFamily,
  normaliseFamily,
  seedInventorySchema,
  varietySchema,
  type Crop,
  type GrowingFacts,
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
import { GrowingFields } from "@/app/(admin)/admin/garden/seeds/_components/growing-fields";
import {
  growingForPick,
  PlantSuggestions,
  type PlantPick,
} from "@/app/(admin)/admin/garden/seeds/_components/plant-suggestions";
import {
  AddAction,
  ChipGroup,
  FilteredLine,
  LandRow,
  RowList,
} from "@/app/(admin)/admin/pastures/_components/land-kit";
import { byId, cropFields, growingDraft, varietyFacts, type GrowingDraft } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * What the garden grows — one list of plants (spec §5.5).
 *
 * There used to be two: crops ("Pepper", with its family and how it grows)
 * and varieties under them ("Early Jalapeño", off the packet). Every planting,
 * plan and packet names a variety, and the crop is what the rotation guard and
 * the planting dates read. Two lists for one idea read as bookkeeping, and
 * nobody could say which one a jalapeño went in.
 *
 * So there is one: a **plant** is the variety record, named however the
 * packet names it. What it *grows like* — the crop — is worked out from the
 * name ("Early Jalapeño" grows like a pepper) and created the first time it
 * is needed, shown as one line, and changed only when the name gets it wrong.
 * The facts every plant of that kind shares (sun, sowing, frost, when it goes
 * in) sit behind a disclosure on the plant, saved to the crop underneath.
 *
 * The records are unchanged, so nothing is migrated: a crop with no plant
 * under it still shows here, as a row to fill in or delete.
 *
 * **Deleting a plant is `restrict` (§4.5)** while a planting or a plan names
 * it. Its seed goes with it, and so does its crop when it was the last plant
 * that grew like it — all three come back on undo.
 */

interface PlantDraft {
  readonly name: string;
  /** "" works it out from the name; else a crop's id, or `NEW_TYPE`. */
  readonly growsLike: string;
  readonly daysToMaturity: string;
  readonly spacingInches: string;
  readonly source: string;
  readonly notes: string;
  /** "" is "worked out"; anything else overrides the crop's family. */
  readonly family: string;
  /** The crop's shared facts, once somebody has changed one. */
  readonly growing?: GrowingDraft | undefined;
}

const BLANK: PlantDraft = {
  name: "",
  growsLike: "",
  daysToMaturity: "",
  spacingInches: "",
  source: "",
  notes: "",
  family: "",
};

/** "Its own kind of plant": a new crop named after the plant. */
const NEW_TYPE = "__own";

/** Families worth offering, so the common ones are picked rather than spelled. */
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

const fold = (value: string | undefined) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** What a plant grows like: a crop already recorded, or one to create. */
export type GrowsLike =
  | { readonly kind: "existing"; readonly crop: Crop }
  | {
      readonly kind: "new";
      readonly name: string;
      readonly scientificName: string;
      readonly family: string;
      readonly growing: GrowingFacts | undefined;
    };

/**
 * Work out what a plant grows like.
 *
 * The built-in table knows "Early Jalapeño" is a pepper; the crop list is
 * searched for a pepper already recorded under any name the table reads as
 * one. A plant the table has never heard of grows like a recorded crop its
 * name contains ("Heavenly Blue moonflower" → Moonflower), else like itself.
 */
export function resolveGrowsLike(
  name: string,
  crops: readonly Crop[],
  choice: string,
  pick: PlantPick | undefined,
): GrowsLike | undefined {
  const trimmed = name.trim();
  if (choice !== "" && choice !== NEW_TYPE) {
    const crop = byId(crops).get(choice as Ulid);
    if (crop !== undefined) return { kind: "existing", crop };
  }
  if (trimmed === "") return undefined;
  const fromPick = pick !== undefined && fold(pick.commonName) === fold(trimmed) ? pick : undefined;

  if (choice === NEW_TYPE) {
    return {
      kind: "new",
      name: trimmed,
      scientificName: fromPick?.scientificName ?? "",
      family: fromPick?.family ?? "",
      growing: fromPick?.growing,
    };
  }

  const base = gardenCropFor(trimmed);
  if (base !== undefined) {
    const recorded =
      crops.find((crop) => fold(crop.name) === fold(base.name)) ??
      crops.find((crop) => gardenCropFor(crop.name)?.name === base.name);
    if (recorded !== undefined) return { kind: "existing", crop: recorded };
    return {
      kind: "new",
      name: base.name,
      scientificName: base.scientificName,
      family: base.family,
      growing: GROWING.get(base.name),
    };
  }

  const padded = ` ${fold(trimmed)} `;
  const contained = [...crops]
    .sort((left, right) => right.name.length - left.name.length)
    .find((crop) => fold(crop.name) !== "" && padded.includes(` ${fold(crop.name)} `));
  if (contained !== undefined) return { kind: "existing", crop: contained };

  return {
    kind: "new",
    name: trimmed,
    scientificName: fromPick?.scientificName ?? "",
    family: fromPick?.family ?? "",
    growing: fromPick?.growing,
  };
}

function growsLikeName(resolved: GrowsLike | undefined): string | undefined {
  if (resolved === undefined) return undefined;
  return resolved.kind === "existing" ? resolved.crop.name : resolved.name;
}

export function growsLikeFacts(resolved: GrowsLike | undefined): GrowingFacts | undefined {
  if (resolved === undefined) return undefined;
  return resolved.kind === "existing" ? cropGrowing(resolved.crop) : resolved.growing;
}

/** The crop's name, unless the plant's name already says it. */
function typeLabel(plantName: string, cropName: string | undefined): string | undefined {
  if (cropName === undefined) return undefined;
  const padded = ` ${fold(plantName)} `;
  if (padded.includes(` ${fold(cropName)} `) || fold(plantName) === fold(cropName)) {
    return undefined;
  }
  return cropName;
}

/** Days and spacing for a plant: its kind's when it has one ("Habanero"), else its crop's. */
export function figuresFor(
  name: string,
  resolved: GrowsLike | undefined,
): GrowingFacts | undefined {
  const entry = gardenEntryFor(name);
  return (entry === undefined ? undefined : GROWING.get(entry.name)) ?? growsLikeFacts(resolved);
}

export function PlantsPanel({
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
  const api = useMutations<Variety>("varieties", "varieties", varietySchema, propertyId, actorId);
  const cropApi = useMutations<Crop>("crops", "crops", cropSchema, propertyId, actorId);
  // Deleting a plant takes its seed with it, a write to another table.
  const seedApi = useMutations<SeedInventory>(
    "seedInventory",
    "seedInventory",
    seedInventorySchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  /** The plant being edited, or the crop with no plant being filled in. */
  const [editing, setEditing] = useState<Variety | undefined>();
  const [emptyCrop, setEmptyCrop] = useState<Crop | undefined>();
  const [draft, setDraft] = useState<PlantDraft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<PlantPick | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [filter, setFilter] = useState("");

  const cropById = useMemo(() => byId(crops), [crops]);

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

  const plantsOf = useMemo(() => {
    const map = new Map<Ulid, Variety[]>();
    for (const variety of varieties) {
      map.set(variety.cropId, [...(map.get(variety.cropId) ?? []), variety]);
    }
    return map;
  }, [varieties]);

  if (loading) return <p className="text-muted">Loading the plants…</p>;

  const resolved =
    draft === undefined ? undefined : resolveGrowsLike(draft.name, crops, draft.growsLike, pick);

  function open(next: PlantDraft, variety?: Variety, crop?: Crop) {
    setEditing(variety);
    setEmptyCrop(crop);
    setDraft(next);
    setErrors({});
    setSearching(false);
    setPick(undefined);
    setNote(undefined);
  }

  function startEdit(variety: Variety) {
    const crop = cropById.get(variety.cropId);
    open(
      {
        name: variety.name,
        // Pinned: an existing plant does not move because its name is edited.
        growsLike: variety.cropId,
        daysToMaturity: variety.daysToMaturity === undefined ? "" : String(variety.daysToMaturity),
        spacingInches: variety.spacingInches === undefined ? "" : String(variety.spacingInches),
        source: variety.source ?? "",
        notes: variety.notes ?? "",
        family: crop?.family ?? "",
      },
      variety,
    );
  }

  function startFromCrop(crop: Crop) {
    const facts = cropGrowing(crop);
    open(
      {
        ...BLANK,
        name: crop.name,
        growsLike: crop.id,
        daysToMaturity: facts?.daysToMaturity === undefined ? "" : String(facts.daysToMaturity),
        spacingInches: facts?.spacingInches === undefined ? "" : String(facts.spacingInches),
        notes: crop.notes ?? "",
        family: crop.family ?? "",
      },
      undefined,
      crop,
    );
  }

  /** A pick is the plant: its name, and its days and spacing. */
  function choose(match: PlantPick) {
    if (draft === undefined) return;
    setSearching(false);
    setPick(match);
    const next = { ...draft, name: match.commonName, growsLike: "", growing: undefined };
    const facts =
      match.growing ??
      figuresFor(match.commonName, resolveGrowsLike(match.commonName, crops, "", match));
    setDraft({
      ...next,
      daysToMaturity: facts?.daysToMaturity === undefined ? "" : String(facts.daysToMaturity),
      spacingInches: facts?.spacingInches === undefined ? "" : String(facts.spacingInches),
    });
    if (facts !== undefined) {
      setNote(
        `Days and spacing filled in for ${match.commonName}. Change them to match the packet.`,
      );
      return;
    }
    setNote(`Looking up how ${match.commonName} grows…`);
    void growingForPick(match).then((found) => {
      if (found !== undefined) {
        setPick((current) =>
          current?.commonName === match.commonName ? { ...current, growing: found } : current,
        );
      }
      setDraft((current) =>
        current === undefined ||
        fold(current.name) !== fold(match.commonName) ||
        found === undefined
          ? current
          : {
              ...current,
              daysToMaturity:
                current.daysToMaturity !== "" || found.daysToMaturity === undefined
                  ? current.daysToMaturity
                  : String(found.daysToMaturity),
              spacingInches:
                current.spacingInches !== "" || found.spacingInches === undefined
                  ? current.spacingInches
                  : String(found.spacingInches),
            },
      );
      setNote(
        found === undefined
          ? `Nothing known about growing ${match.commonName} — fill in what the packet says.`
          : `Filled in for ${match.commonName} from Growstuff. Change anything.`,
      );
    });
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});
    const name = draft.name.trim();
    if (name === "") {
      setErrors({ name: "What is it called?" });
      return;
    }
    const target = resolveGrowsLike(name, crops, draft.growsLike, pick);
    if (target === undefined) return;

    // The crop underneath: created the first time, updated when its shared
    // facts or family were changed here.
    let cropId: Ulid;
    if (target.kind === "new") {
      const created = await cropApi.create(
        cropFields({
          name: target.name,
          scientificName: target.scientificName,
          family: draft.family !== "" ? draft.family : target.family,
          growing: draft.growing ?? growingDraft(target.growing),
        }) as never,
      );
      if (!created.ok) {
        setErrors(fieldErrors(created.error, "name"));
        return;
      }
      cropId = created.value.id;
    } else {
      cropId = target.crop.id;
      const familyChanged = fold(draft.family) !== fold(target.crop.family);
      if (draft.growing !== undefined || familyChanged) {
        const updated = await cropApi.update(
          target.crop.id,
          cropFields({
            name: target.crop.name,
            scientificName: target.crop.scientificName ?? "",
            family: draft.family,
            notes: target.crop.notes ?? "",
            growing: draft.growing ?? growingDraft(cropGrowing(target.crop)),
          }) as Partial<Crop>,
        );
        if (!updated.ok) {
          setErrors(fieldErrors(updated.error, "family"));
          return;
        }
      }
    }
    // Pinned from here, so a retry after a plant error does not add it twice.
    setDraft({ ...draft, growsLike: cropId });

    const fields = {
      cropId,
      name,
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

    show({
      message: editing === undefined ? `${name} added to your ideas` : `${name} saved`,
      tone: "success",
    });
    setDraft(undefined);
    setEditing(undefined);
    setEmptyCrop(undefined);
  }

  async function remove(variety: Variety) {
    const found = usage.get(variety.id);
    const blocking = [...new Set(found?.blocking ?? [])];
    const packets = found?.seed ?? [];

    if (blocking.length > 0) {
      show({
        message: `${variety.name} is still named by ${blocking.join(" and ")}. Delete or change those first.`,
        tone: "warning",
      });
      return;
    }

    // The last plant that grew like its crop takes the crop along, so no
    // empty "Pepper" is left behind to wonder about.
    const crop = cropById.get(variety.cropId);
    const lastOfCrop =
      crop !== undefined && (plantsOf.get(crop.id) ?? []).every((held) => held.id === variety.id);

    const confirmed = await confirmDelete({
      tier: packets.length > 0 ? "elevated" : "standard",
      recordName: variety.name,
      entity: "plant",
      dependents: packets.map((packet) => ({
        entity: "Seed",
        label: quantityLabel(packet.quantity, packet.unit, "Seed, not counted"),
        effect: "deleted" as const,
      })),
      consequence:
        packets.length === 0
          ? "Nothing is planted or planned for it, and you have no seeds for it."
          : "The seeds you recorded for it go too.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(variety.id, "Removed from the plants");
    if (!result.ok) {
      show({ message: `Could not delete ${variety.name}`, tone: "danger" });
      return;
    }
    await Promise.all([
      ...packets.map((packet) => seedApi.remove(packet.id, `${variety.name} deleted`)),
      ...(lastOfCrop && crop !== undefined
        ? [cropApi.remove(crop.id, `${variety.name} deleted`)]
        : []),
    ]);

    show({
      message: `${variety.name} deleted`,
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            if (lastOfCrop && crop !== undefined) await cropApi.restoreRecord(crop.id);
            await api.restoreRecord(variety.id);
            await Promise.all(packets.map((packet) => seedApi.restoreRecord(packet.id)));
          })();
        },
      },
    });
  }

  async function removeEmptyCrop(crop: Crop) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: crop.name,
      entity: "plant",
      dependents: [],
      consequence: "Nothing is recorded under it.",
      action: "Delete",
    });
    if (!confirmed) return;
    const result = await cropApi.remove(crop.id, "Removed from the plants");
    if (!result.ok) {
      show({ message: `Could not delete ${crop.name}`, tone: "danger" });
      return;
    }
    show({
      message: `${crop.name} deleted`,
      action: { label: "Undo", onAct: () => void cropApi.restoreRecord(crop.id) },
    });
  }

  /* --------------------------------------------------------------- list */

  type Row =
    | { readonly kind: "plant"; readonly variety: Variety; readonly name: string }
    | { readonly kind: "empty"; readonly crop: Crop; readonly name: string };

  const rows: Row[] = [
    ...varieties.map((variety) => ({ kind: "plant" as const, variety, name: variety.name })),
    // A crop recorded before there was one list, with nothing under it.
    ...crops
      .filter((crop) => (plantsOf.get(crop.id) ?? []).length === 0)
      .map((crop) => ({ kind: "empty" as const, crop, name: crop.name })),
  ].sort((left, right) => left.name.localeCompare(right.name));

  const cropOf = (row: Row) => (row.kind === "plant" ? row.variety.cropId : row.crop.id);

  function lineFor(row: Row): string {
    if (row.kind === "empty") {
      return "Nothing recorded yet — open it to add days and spacing, or delete it";
    }
    const { variety } = row;
    const facts = varietyFacts(variety.id, varieties, crops);
    const found = usage.get(variety.id);
    const packets = found?.seed.length ?? 0;
    return [
      typeLabel(variety.name, cropById.get(variety.cropId)?.name),
      facts?.daysToMaturity === undefined ? undefined : `${facts.daysToMaturity} days`,
      facts?.spacingInches === undefined ? undefined : `${facts.spacingInches}" apart`,
      packets === 0 ? "no seeds yet" : `seeds on hand (${packets})`,
      ...new Set(found?.blocking ?? []),
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  const perCrop = new Map<Ulid, number>();
  for (const row of rows) perCrop.set(cropOf(row), (perCrop.get(cropOf(row)) ?? 0) + 1);
  const chips = [
    { key: "", label: "All", count: rows.length },
    ...[...crops]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((crop) => ({ key: crop.id, label: crop.name, count: perCrop.get(crop.id) ?? 0 }))
      .filter((chip) => chip.count > 1),
  ];
  const shown = rows.filter((row) => filter === "" || cropOf(row) === filter);

  /* --------------------------------------------------------------- form */

  const typeName = growsLikeName(resolved);
  const autoName =
    draft === undefined || draft.name.trim() === ""
      ? undefined
      : growsLikeName(resolveGrowsLike(draft.name, crops, "", pick));
  const growsLikeOptions = [
    {
      value: "",
      label: autoName === undefined ? "Worked out from the name" : `${autoName} (from the name)`,
    },
    ...[...crops]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((crop) => ({ value: crop.id, label: crop.name })),
    { value: NEW_TYPE, label: "Its own kind of plant" },
  ];
  const inferredFamily =
    resolved === undefined
      ? undefined
      : resolved.kind === "existing"
        ? cropFamily({ ...resolved.crop, family: undefined })
        : (normaliseFamily(resolved.family) ?? inferFamily(resolved.name, resolved.scientificName));
  const shared = resolved?.kind === "existing" ? (plantsOf.get(resolved.crop.id) ?? []).length : 0;

  return (
    <Section
      title="Ideas"
      actions={
        <span className="flex items-center gap-2">
          {varieties.length === 0 ? null : (
            <Link
              href="/admin/garden/plantings?tab=plan&plan=ideas"
              className="inline-flex min-h-target items-center rounded-density px-3 text-sm font-semibold text-action hover:bg-raised"
            >
              Plan these
            </Link>
          )}
          <AddAction label="Add idea" onClick={() => open(BLANK)} />
        </span>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing yet. Jot down anything you might like to grow — “jalapeño”, “cherry tomato”,
          “zinnias”. No seeds needed. Each one says how it grows, and when the list feels right,
          “Plan these” works out when and where.
        </p>
      ) : (
        <>
          {chips.length <= 2 ? null : (
            <ChipGroup label="Filter plants" chips={chips} value={filter} onChange={setFilter} />
          )}
          <FilteredLine
            shown={shown.length}
            total={rows.length}
            labels={filter === "" ? [] : [cropById.get(filter as Ulid)?.name ?? "A kind"]}
            onClear={() => setFilter("")}
          />
          <RowList label="Ideas">
            {shown.map((row) => (
              <LandRow
                key={row.kind === "plant" ? row.variety.id : row.crop.id}
                title={row.name}
                openLabel={`Edit ${row.name}`}
                line={lineFor(row)}
                onOpen={() =>
                  row.kind === "plant" ? startEdit(row.variety) : startFromCrop(row.crop)
                }
              />
            ))}
          </RowList>
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? emptyCrop?.id ?? "new-plant"}
          placement="side"
          title={
            editing === undefined
              ? (emptyCrop?.name ?? "Something to grow")
              : `Edit ${editing.name}`
          }
          description="A name is enough — “jalapeño” will do. Days and spacing fill in; a packet's figures can replace them later."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add to ideas" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined && emptyCrop === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const variety = editing;
                    const crop = emptyCrop;
                    setDraft(undefined);
                    setEditing(undefined);
                    setEmptyCrop(undefined);
                    if (variety !== undefined) void remove(variety);
                    else if (crop !== undefined) void removeEmptyCrop(crop);
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
                placeholder="Early Jalapeño, Cherokee Purple tomato, basil…"
                autoComplete="off"
                value={draft.name}
                error={errors["name"]}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  setSearching(true);
                  setNote(undefined);
                }}
              />
              {searching ? (
                <PlantSuggestions
                  query={draft.name}
                  onPick={choose}
                  label="Plants matching the name"
                />
              ) : null}
              {note === undefined ? null : (
                <p className="m-0 text-xs text-muted" role="status">
                  {note}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
              <Select
                label="Grows like"
                hint="For rotation, companions and planting dates. Worked out from the name."
                options={growsLikeOptions}
                value={draft.growsLike}
                error={errors["growsLike"]}
                onChange={(event) =>
                  setDraft({ ...draft, growsLike: event.target.value, growing: undefined })
                }
              />
              <TextInput
                label="Days to maturity"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                numeric
                hint="From transplant, for a plant set out as a seedling."
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
                label="Where to get seed"
                placeholder="Baker Creek, a neighbour, the feed store"
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

            {typeName === undefined ? null : (
              <details className="group text-sm">
                <summary className="flex min-h-target cursor-pointer list-none flex-wrap items-center gap-x-2 [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-ink">How {typeName} grows</span>
                  <span className="text-muted">
                    {resolved?.kind === "existing" && shared > 1
                      ? `shared by your ${shared} plants that grow like it`
                      : "sun, sowing, frost, when it goes in"}
                  </span>
                  <span className="font-semibold text-action">Change</span>
                </summary>
                <div className="flex flex-col gap-density pt-2">
                  <TextInput
                    label="Plant family"
                    list="garden-families"
                    placeholder={inferredFamily ?? "Solanaceae"}
                    hint={
                      inferredFamily === undefined
                        ? "Not known from the name. Rotation is checked on this."
                        : `Worked out as ${inferredFamily}. Rotation is checked on this.`
                    }
                    value={draft.family}
                    error={errors["family"]}
                    onChange={(event) => setDraft({ ...draft, family: event.target.value })}
                  />
                  <datalist id="garden-families">
                    {COMMON_FAMILIES.map((family) => (
                      <option key={family} value={family} />
                    ))}
                  </datalist>
                  <GrowingFields
                    legend={`What every ${typeName.toLowerCase()} shares`}
                    withoutDaysAndSpacing
                    value={draft.growing ?? growingDraft(growsLikeFacts(resolved))}
                    onChange={(growing) => setDraft({ ...draft, growing })}
                    errors={errors}
                  />
                </div>
              </details>
            )}
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
