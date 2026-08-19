"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  DataTable,
  Modal,
  Pill,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  cropSchema,
  seedInventorySchema,
  varietySchema,
  type Crop,
  type PlannedPlanting,
  type Planting,
  type SeedInventory,
  type Variety,
} from "@galaxy-farm/module-garden";

import { quantityLabel } from "@/app/(admin)/admin/garden/_components/labels";
import { useMutations } from "@/lib/local/mutations";

/**
 * The catalogue the rest of the garden is written against (spec §5.5).
 *
 * A crop carries the **botanical family**, and that field is the whole reason
 * crops are a record rather than a string on each variety. The rotation guard
 * runs on the family: tomatoes following peppers is the mistake rotation
 * exists to prevent, and a check on the crop name would wave it through.
 * Typing the family on every variety would give three spellings of
 * "Solanaceae" and a guard that silently matched none of them.
 *
 * **Deleting a variety is `restrict` (§4.5).** A planting or a plan that names
 * it is a record about ground and a record about a season, and neither
 * survives losing what was in it. Seed *does* go with the variety, because a
 * packet is of that variety and of nothing else.
 */

interface CropDraft {
  readonly name: string;
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

const BLANK_CROP: CropDraft = { name: "", family: "", notes: "" };

const BLANK_VARIETY: VarietyDraft = {
  cropId: "",
  name: "",
  daysToMaturity: "",
  spacingInches: "",
  source: "",
  notes: "",
};

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
];

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
    <div className="flex flex-col gap-density">
      <Crops crops={crops} varieties={varieties} propertyId={propertyId} actorId={actorId} />
      <Varieties
        crops={crops}
        varieties={varieties}
        seed={seed}
        plantings={plantings}
        planned={planned}
        propertyId={propertyId}
        actorId={actorId}
      />
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

  const varietiesOf = (cropId: Ulid) => varieties.filter((variety) => variety.cropId === cropId);

  function startEdit(crop: Crop) {
    setEditing(crop);
    setDraft({ name: crop.name, family: crop.family, notes: crop.notes ?? "" });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const fields = {
      name: draft.name.trim(),
      family: draft.family.trim(),
      notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
    };

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

  const columns: readonly Column<Crop>[] = [
    { key: "name", header: "Crop", primary: true, render: (row) => row.name },
    {
      key: "family",
      header: "Family",
      render: (row) => <Pill tone="identity">{row.family}</Pill>,
    },
    {
      key: "varieties",
      header: "Varieties",
      numeric: true,
      render: (row) => varietiesOf(row.id).length,
    },
    {
      key: "notes",
      header: "Notes",
      render: (row) =>
        row.notes === undefined ? <span className="text-muted">—</span> : row.notes,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Section
      title="Crops"
      description="A crop and the botanical family it belongs to. The family is what the rotation guard checks, so two nightshades filed under the same family is the point rather than an accident."
      actions={
        <Button
          variant="primary"
          onClick={() => {
            setEditing(undefined);
            setDraft(BLANK_CROP);
            setErrors({});
          }}
        >
          Add a crop
        </Button>
      }
    >
      <DataTable
        rows={[...crops].sort((left, right) => left.name.localeCompare(right.name))}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Crops"
        empty="No crops yet. Add tomatoes, then the varieties under them."
      />

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new-crop"}
          title={editing === undefined ? "New crop" : `Editing ${editing.name}`}
          description="What it is, and what family it is in."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="Name"
              required
              hint="&ldquo;Tomato&rdquo;, &ldquo;Okra&rdquo;, &ldquo;Sweet corn&rdquo;."
              value={draft.name}
              error={errors["name"]}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <TextInput
              label="Botanical family"
              required
              list="garden-families"
              hint="Tomatoes, peppers, potatoes and aubergines are all Solanaceae — which is exactly why rotation is checked on this and not on the name."
              value={draft.family}
              error={errors["family"]}
              onChange={(event) => setDraft({ ...draft, family: event.target.value })}
            />
            <datalist id="garden-families">
              {COMMON_FAMILIES.map((family) => (
                <option key={family} value={family} />
              ))}
            </datalist>
            <TextArea
              label="Notes"
              rows={3}
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add crop" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
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

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Variety | undefined>();
  const [draft, setDraft] = useState<VarietyDraft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const cropName = (cropId: Ulid) => crops.find((crop) => crop.id === cropId)?.name;

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

  function startEdit(variety: Variety) {
    setEditing(variety);
    setDraft({
      cropId: variety.cropId,
      name: variety.name,
      daysToMaturity: variety.daysToMaturity === undefined ? "" : String(variety.daysToMaturity),
      spacingInches: variety.spacingInches === undefined ? "" : String(variety.spacingInches),
      source: variety.source ?? "",
      notes: variety.notes ?? "",
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());
    const number = (value: string) => (value.trim() === "" ? undefined : Number(value.trim()));
    const fields = {
      cropId: draft.cropId as Ulid,
      name: draft.name.trim(),
      daysToMaturity: number(draft.daysToMaturity),
      spacingInches: number(draft.spacingInches),
      source: text(draft.source),
      notes: text(draft.notes),
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
        label: quantityLabel(packet.quantity, packet.unit),
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

    for (const packet of packets) {
      await seedApi.remove(packet.id, `Variety ${variety.name} deleted`);
    }

    show({
      message: `${variety.name} deleted`,
      action: {
        label: "Undo",
        // Both halves, or the undo is a lie.
        onAct: () => {
          void (async () => {
            await api.restoreRecord(variety.id);
            for (const packet of packets) await seedApi.restoreRecord(packet.id);
          })();
        },
      },
    });
  }

  const columns: readonly Column<Variety>[] = [
    { key: "name", header: "Variety", primary: true, render: (row) => row.name },
    {
      key: "crop",
      header: "Crop",
      render: (row) => cropName(row.cropId) ?? <span className="text-muted">unfiled</span>,
    },
    {
      key: "dtm",
      header: "Days to maturity",
      numeric: true,
      render: (row) =>
        row.daysToMaturity === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          row.daysToMaturity
        ),
    },
    {
      key: "spacing",
      header: "Spacing",
      numeric: true,
      render: (row) =>
        row.spacingInches === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          `${row.spacingInches}"`
        ),
    },
    {
      key: "used",
      header: "Named by",
      render: (row) => {
        const found = usage.get(row.id);
        const blocking = [...new Set(found?.blocking ?? [])];
        const packets = found?.seed.length ?? 0;

        if (blocking.length === 0 && packets === 0) {
          return <span className="text-muted">nothing yet</span>;
        }

        return (
          <span className="flex flex-wrap gap-1.5">
            {blocking.map((label) => (
              <Pill key={label}>{label}</Pill>
            ))}
            {packets === 0 ? null : <Pill tone="calm">{packets} in the box</Pill>}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Section
      title="Varieties"
      description="Which tomato. Days to maturity is what the expected harvest date is worked out from, so it is the field worth copying off the packet."
      actions={
        <Button
          variant="primary"
          disabled={crops.length === 0}
          onClick={() => {
            setEditing(undefined);
            setDraft(BLANK_VARIETY);
            setErrors({});
          }}
        >
          Add a variety
        </Button>
      }
    >
      {crops.length === 0 ? (
        <Callout tone="action" title="Add a crop first">
          A variety is a variety of something, and the crop is what carries the botanical family the
          rotation guard reads.
        </Callout>
      ) : null}

      <DataTable
        rows={[...varieties].sort(
          (left, right) =>
            (cropName(left.cropId) ?? "").localeCompare(cropName(right.cropId) ?? "") ||
            left.name.localeCompare(right.name),
        )}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Varieties"
        empty="No varieties yet."
      />

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new-variety"}
          size="wide"
          title={editing === undefined ? "New variety" : `Editing ${editing.name}`}
          description="Off the packet: what it is called, how long it takes, and how far apart it goes."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Crop"
                required
                options={[
                  { value: "", label: "Pick one" },
                  ...[...crops]
                    .sort((left, right) => left.name.localeCompare(right.name))
                    .map((crop) => ({ value: crop.id, label: `${crop.name} (${crop.family})` })),
                ]}
                value={draft.cropId}
                error={errors["cropId"]}
                onChange={(event) => setDraft({ ...draft, cropId: event.target.value })}
              />
              <TextInput
                label="Name"
                required
                hint="&ldquo;Cherokee Purple&rdquo;, &ldquo;Clemson Spineless&rdquo;."
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
                hint="Counted from transplant for a transplanted crop, which is what the expected harvest date assumes."
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
                hint="Who it came from, so re-ordering does not need a search."
                value={draft.source}
                error={errors["source"]}
                onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              hint="How it did, what it tasted like, whether it cracked."
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add variety" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
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
