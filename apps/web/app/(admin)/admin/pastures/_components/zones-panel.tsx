"use client";

import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  SafetyBadge,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  groupedZones,
  isOverCapacity,
  possibleGroupsFor,
  SAFETY_LEVEL_DEFAULTS,
  slotForZone,
  ZONE_TYPES,
  zoneSchema,
  type Animal,
  type SafetyLevel,
  type Ulid,
  type WaterSource,
  type Zone,
  type ZoneAssignment,
  type ZoneType,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

/**
 * Zones — the full §4.5 surface (list, create, edit, delete, restore).
 *
 * The first screen in the app that writes. Everything it does goes into the
 * device's store first and the outbox second, so it works with the phone in
 * aeroplane mode and catches up later.
 *
 * The delete is the part worth reading. A zone is an aggregate root, so §4.5
 * clause 3 puts it at the Typed tier — you type its name — and the dialog
 * names the animals standing in it, because "delete North Trap?" and "delete
 * North Trap, 4 animals are assigned to it" are different questions.
 */

const TYPE_OPTIONS = ZONE_TYPES.map((type) => ({
  value: type,
  label: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));

const SAFETY_OPTIONS = Object.values(SAFETY_LEVEL_DEFAULTS).map((level) => ({
  value: String(level.level),
  label: `${level.level} — ${level.label}`,
}));

interface Draft {
  readonly name: string;
  readonly type: ZoneType;
  readonly parentZoneId: string;
  readonly indoor: boolean;
  readonly capacity: string;
  readonly baselineSafetyLevel: SafetyLevel;
  readonly waterSourceIds: readonly Ulid[];
  readonly customInstructions: string;
  readonly resting: boolean;
}

const BLANK: Draft = {
  name: "",
  type: "pen",
  parentZoneId: "",
  indoor: false,
  capacity: "",
  baselineSafetyLevel: 2,
  waterSourceIds: [],
  customInstructions: "",
  resting: false,
};

export function ZonesPanel({
  zones,
  water,
  assignments,
  animals,
  loading,
  propertyId,
  actorId,
}: {
  readonly zones: readonly Zone[];
  readonly water: readonly WaterSource[];
  readonly assignments: readonly ZoneAssignment[];
  readonly animals: readonly Animal[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const animalName = (id: Ulid) => {
    const animal = animals.find((candidate) => candidate.id === id);
    return animal?.name ?? animal?.tagNumber ?? "Untagged animal";
  };

  /** Who is standing in a zone right now — an assignment with no end date. */
  const occupantsOf = (zone: Zone) =>
    assignments.filter((a) => a.zoneId === zone.id && a.periodTo === undefined);

  const mutations = useMutations<Zone>("zones", "zones", zoneSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Zone | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * What this zone could be put in.
   *
   * Asked of the kernel rather than filtered here, so the screen and the
   * chore that reads the tree agree about what a barn may hold — and so the
   * one genuinely dangerous option, putting a barn inside its own stall, is
   * excluded by the same code that knows what a descendant is.
   */
  const groupOptions =
    draft === undefined
      ? []
      : possibleGroupsFor(zones, { id: editing?.id ?? ("" as Ulid), type: draft.type });

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(zone: Zone) {
    setEditing(zone);
    setDraft({
      name: zone.name,
      type: zone.type,
      parentZoneId: zone.parentZoneId ?? "",
      indoor: zone.indoor,
      capacity: zone.capacity === undefined ? "" : String(zone.capacity),
      baselineSafetyLevel: zone.baselineSafetyLevel,
      waterSourceIds: zone.waterSourceIds,
      customInstructions: zone.customInstructions ?? "",
      resting: zone.resting,
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;

    const fields = {
      name: draft.name.trim(),
      type: draft.type,
      // Cleared travels as undefined, or a zone taken out of a group would
      // stay in it — the patch would simply never mention the field.
      parentZoneId: draft.parentZoneId === "" ? undefined : (draft.parentZoneId as Ulid),
      indoor: draft.indoor,
      baselineSafetyLevel: draft.baselineSafetyLevel,
      waterSourceIds: draft.waterSourceIds,
      resting: draft.resting,
      active: editing?.active ?? true,
      ...(draft.capacity.trim() === "" ? {} : { capacity: Number(draft.capacity) }),
      ...(draft.customInstructions.trim() === ""
        ? {}
        : { customInstructions: draft.customInstructions.trim() }),
    };

    const result =
      editing === undefined
        ? await mutations.create(fields)
        : await mutations.update(editing.id, fields);

    if (!result.ok) {
      // §4.5 clause 2: per field, not a banner. A form that says "invalid" and
      // nothing else leaves someone guessing which of seven inputs it meant.
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { name: "Could not save. Check the fields and try again." },
      );
      return;
    }

    show({ message: editing === undefined ? "Zone added" : "Zone saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Rest, in one tap.
   *
   * Resting is a status that changes with the season and back again, and
   * §5.1 hangs real behaviour off it — resting ground renders dimmed on the
   * Pen Board and challenges a move into it. Something toggled that often
   * does not belong three clicks deep inside an edit dialog.
   */
  async function toggleResting(zone: Zone) {
    const result = await mutations.update(zone.id, { resting: !zone.resting });
    if (!result.ok) {
      show({ message: "Could not change that", tone: "danger" });
      return;
    }

    show({
      message: zone.resting ? `${zone.name} is back in rotation` : `${zone.name} is resting`,
    });
  }

  async function remove(zone: Zone) {
    // What else this touches, looked up before asking. §4.5 clause 3 requires
    // the dialog to name the dependents — "delete North Trap?" and "delete
    // North Trap, 4 animals are assigned to it" are different questions, and
    // only one of them can be answered.
    const occupants = occupantsOf(zone).map((a) => animalName(a.animalId));

    const confirmed = await confirmDelete({
      // Typed tier: a zone is an aggregate root (§4.5 clause 3).
      tier: "typed",
      recordName: zone.name,
      entity: "zone",
      dependents: occupants.map((label) => ({
        entity: "Zone assignment",
        label,
        // Detached, not deleted: the animal survives, its assignment here ends.
        effect: "detached" as const,
      })),
      ...(occupants.length > 0
        ? { consequence: "Those animals will be left without a zone until you move them." }
        : {}),
    });

    if (!confirmed) return;

    const result = await mutations.remove(zone.id);
    if (!result.ok) {
      show({ message: "Could not delete that zone", tone: "danger" });
      return;
    }

    show({
      message: `${zone.name} deleted`,
      // Soft delete is what makes the undo real — the record is a tombstone,
      // not gone.
      action: {
        label: "Undo",
        onAct: () => void mutations.restoreRecord(zone.id),
      },
    });
  }

  const columns: readonly Column<Zone>[] = [
    {
      key: "name",
      header: "Zone",
      render: (zone) => (
        <span className="flex flex-wrap items-center gap-2">
          {zone.name}
          {zone.resting ? <Pill tone="action">resting</Pill> : null}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (zone) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{zone.type.replace(/_/g, " ")}</Badge>
          {/*
            Inside or outside, on every row.
            An animal holds one of each at once — a stall in the barn and a
            pasture to go out in — and which slot a zone fills is read straight
            off this. Left as a tickbox nobody sees, a stall marked outside
            quietly takes the pasture's place and the horse looks like it has
            no turnout.
          */}
          <Badge tone={zone.indoor ? "identity" : "calm"}>
            {slotForZone(zone) === "inside" ? "inside" : "outside"}
          </Badge>
        </span>
      ),
    },
    {
      key: "occupancy",
      header: "In it",
      render: (zone) => {
        const count = occupantsOf(zone).length;
        const over = isOverCapacity(zone, count);
        return (
          <span className={over ? "text-danger" : undefined}>
            {count}
            {zone.capacity === undefined ? "" : ` / ${zone.capacity}`}
            {over ? " — over" : ""}
          </span>
        );
      },
    },
    {
      key: "water",
      header: "Water",
      render: (zone) =>
        zone.waterSourceIds.length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          zone.waterSourceIds
            .map((id) => water.find((source) => source.id === id)?.name ?? "Unknown")
            .join(", ")
        ),
    },
    {
      key: "safety",
      header: "Baseline care",
      render: (zone) => <SafetyBadge level={zone.baselineSafetyLevel} size="compact" />,
    },
    {
      key: "actions",
      header: "",
      render: (zone) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => void toggleResting(zone)}>
            {zone.resting ? "Graze" : "Rest"}
          </Button>
          <Button variant="ghost" onClick={() => startEdit(zone)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(zone)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading zones…</p>;

  return (
    <div className="flex flex-col gap-density">
      <div className="flex items-center justify-end">
        <Button variant="primary" onClick={startCreate}>
          Add a zone
        </Button>
      </div>

      {draft !== undefined ? (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "New zone" : `Editing ${editing.name}`}
          description="A pen, a trap, a pasture — anywhere an animal can be."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="Name"
              required
              value={draft.name}
              error={errors["name"]}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Select
              label="Type"
              options={TYPE_OPTIONS}
              value={draft.type}
              hint="An area is a named part of the place — North, South — that pens and pastures group into. A working facility holds cattle under handling but nothing lives there."
              onChange={(event) => setDraft({ ...draft, type: event.target.value as ZoneType })}
            />

            {/*
              The group, offered by name and filtered to what can actually hold
              this: barns for a stall, areas and barns for a pen. An empty list
              means there is nowhere to put it yet, and saying so beats an
              empty dropdown that looks broken.
            */}
            <Select
              label="Part of"
              value={draft.parentZoneId}
              hint={
                groupOptions.length === 0
                  ? "Nothing can hold this yet — add an area (North, South) or a barn first."
                  : "Leave it on its own if it belongs to nothing. That is a state, not a gap."
              }
              options={[
                { value: "", label: "On its own" },
                ...groupOptions.map((group) => ({
                  value: group.id,
                  label: `${group.name} (${group.type.replace(/_/g, " ")})`,
                })),
              ]}
              onChange={(event) => setDraft({ ...draft, parentZoneId: event.target.value })}
            />

            {/*
              Inside or outside, asked outright rather than as a tickbox
              labelled "Indoor". It decides which of an animal's two places
              this fills — one inside, one outside — so a stall marked outside
              silently takes the pasture's slot, and the horse reads as having
              no turnout.
            */}
            <Select
              label="Inside or outside"
              value={draft.indoor ? "inside" : "outside"}
              hint="An animal holds one of each at once: a stall in the barn and a pasture to go out in."
              options={[
                { value: "outside", label: "Outside — pasture, trap, lot" },
                { value: "inside", label: "Inside — stall, barn pen, coop" },
              ]}
              onChange={(event) => setDraft({ ...draft, indoor: event.target.value === "inside" })}
            />
            <TextInput
              label="Capacity"
              type="number"
              inputMode="numeric"
              min={1}
              hint="Head this place holds. Leave blank if it is not a number worth guessing."
              value={draft.capacity}
              error={errors["capacity"]}
              onChange={(event) => setDraft({ ...draft, capacity: event.target.value })}
            />
            <Select
              label="Baseline care level"
              options={SAFETY_OPTIONS}
              value={String(draft.baselineSafetyLevel)}
              hint="Hazards of the place itself. Occupants can raise it, never lower it."
              onChange={(event) =>
                setDraft({
                  ...draft,
                  baselineSafetyLevel: Number(event.target.value) as SafetyLevel,
                })
              }
            />

            <fieldset className="flex flex-col gap-1">
              <legend className="text-density font-medium text-ink">Water</legend>
              <p className="text-sm text-muted">
                Tanks are shared. Tick every source this zone drinks from.
              </p>
              {water.length === 0 ? (
                <p className="text-sm text-muted">
                  No tanks yet — add them on the Water tab, then tick them here.
                </p>
              ) : (
                water.map((source) => (
                  <Checkbox
                    key={source.id}
                    label={`${source.name}${source.hasHeater ? "" : " (no heater)"}`}
                    checked={draft.waterSourceIds.includes(source.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        waterSourceIds: event.target.checked
                          ? [...draft.waterSourceIds, source.id]
                          : draft.waterSourceIds.filter((id) => id !== source.id),
                      })
                    }
                  />
                ))
              )}
            </fieldset>

            <Checkbox
              label="Resting"
              hint="Out of rotation — no animals should be assigned here."
              checked={draft.resting}
              onChange={(event) => setDraft({ ...draft, resting: event.target.checked })}
            />

            <TextArea
              label="Care instructions"
              rows={3}
              hint="Anything a housesitter needs to know about this place."
              value={draft.customInstructions}
              onChange={(event) => setDraft({ ...draft, customInstructions: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add zone" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {zones.length === 0 ? (
        <Card>
          <EmptyState
            title="No zones yet"
            detail="Pens, pastures, and working facilities go here. Everything else hangs off them."
            action={
              <Button variant="primary" onClick={startCreate}>
                Add the first zone
              </Button>
            }
          />
        </Card>
      ) : (
        /*
         * One table per group, rather than one table with a group column and
         * nothing else to say. The place is read as North, South and the barn
         * — a flat list of nine sorted by name is a list somebody has to
         * re-sort in their head every time they open it.
         *
         * The ungrouped come last under their own heading. A zone in no group
         * is its own group, so they are collected rather than flagged.
         */
        groupedZones(zones).map((entry) => (
          <Card key={entry.group?.id ?? "on-their-own"}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-density">
              <h3 className="font-heading text-lg font-semibold text-ink">
                {entry.group?.name ?? "On their own"}
              </h3>
              <span className="flex flex-wrap items-center gap-2">
                {entry.group === undefined ? (
                  <span className="text-sm text-muted">In no group — each its own</span>
                ) : (
                  <Badge tone="neutral">{entry.group.type.replace(/_/g, " ")}</Badge>
                )}
                <Pill>
                  {entry.members.length} zone{entry.members.length === 1 ? "" : "s"}
                </Pill>
              </span>
            </div>

            {entry.members.length === 0 ? (
              // Made this morning, filled this afternoon. A group that
              // disappeared while empty would read as one the app lost.
              <EmptyState
                title="Nothing in it yet"
                detail={`Set a zone's "Part of" to ${entry.group?.name ?? "this"} and it appears here.`}
              />
            ) : (
              <DataTable
                caption={`Zones in ${entry.group?.name ?? "no group"}`}
                columns={columns}
                rows={entry.members}
                rowKey={(zone) => zone.id}
              />
            )}
          </Card>
        ))
      )}
    </div>
  );
}
