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
import {
  freezeCheckTargets,
  WATER_SOURCE_TYPES,
  waterSourceSchema,
  zoneSchema,
  type Ulid,
  type WaterSource,
  type WaterSourceType,
  type Zone,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

/**
 * The tanks (spec §5.1, §6).
 *
 * Water is its own record because tanks are shared: four of them serve eight
 * zones here, one serving three. That is what makes this a screen rather than
 * a checkbox on a zone — a tank has a heater or does not, is out or stowed,
 * and serves a list of places, and all three of those are facts about the tank.
 *
 * The freeze chore in §6 is derived per tank from exactly these fields, so
 * what this screen shows is what somebody will be sent to break ice on.
 */

const TYPE_OPTIONS = WATER_SOURCE_TYPES.map((type) => ({
  value: type,
  label: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));

const TYPE_LABEL: Readonly<Record<WaterSourceType, string>> = {
  auto_refill: "Auto-refill",
  static_tank: "Static tank",
  pond: "Pond",
  creek: "Creek",
};

interface Draft {
  readonly name: string;
  readonly type: WaterSourceType;
  readonly hasHeater: boolean;
  readonly active: boolean;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  type: "auto_refill",
  hasHeater: false,
  active: true,
  notes: "",
};

export function WaterPanel({
  water,
  zones,
  loading,
  propertyId,
  actorId,
}: {
  readonly water: readonly WaterSource[];
  readonly zones: readonly Zone[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<WaterSource>(
    "waterSources",
    "waterSources",
    waterSourceSchema,
    propertyId,
    actorId,
  );
  // Deleting a tank has to take it off the zones that drink from it, or they
  // are left pointing at a record that is gone.
  const zoneMutations = useMutations<Zone>("zones", "zones", zoneSchema, propertyId, actorId);

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<WaterSource | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const servedBy = (source: WaterSource) =>
    zones.filter((zone) => zone.waterSourceIds.includes(source.id));

  /** What §6 will raise a chore for tonight, and which of those have no heater. */
  const targets = freezeCheckTargets(
    water,
    zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      waterSourceIds: zone.waterSourceIds,
      active: zone.active,
    })),
  );
  const vulnerable = targets.filter((target) => target.vulnerable);

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(source: WaterSource) {
    setEditing(source);
    setDraft({
      name: source.name,
      type: source.type,
      hasHeater: source.hasHeater,
      active: source.active,
      notes: source.notes ?? "",
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;

    const fields = {
      name: draft.name.trim(),
      type: draft.type,
      hasHeater: draft.hasHeater,
      active: draft.active,
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
    };

    const result =
      editing === undefined
        ? await mutations.create(fields)
        : await mutations.update(editing.id, fields);

    if (!result.ok) {
      // §4.5 clause 2: per field, so nobody has to guess which input the
      // complaint is about.
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { name: "Could not save. Check the fields and try again." },
      );
      return;
    }

    show({ message: editing === undefined ? "Tank added" : "Tank saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Put out, or stow — one tap.
   *
   * A seasonal tank is out for part of the year and in the barn for the rest,
   * and `active` is what §6 reads to decide whether to raise an ice-breaking
   * chore for it. Somebody who has just dragged the West Pen tank out should
   * not have to open a form to say so.
   */
  async function toggleActive(source: WaterSource) {
    const result = await mutations.update(source.id, { active: !source.active });
    if (!result.ok) {
      show({ message: "Could not change that", tone: "danger" });
      return;
    }

    show({
      message: source.active
        ? `${source.name} stowed — no freeze chore while it is in`
        : `${source.name} is out and in use`,
    });
  }

  async function removeSource(source: WaterSource) {
    const drinkers = servedBy(source);

    const confirmed = await confirmDelete({
      // Elevated, not Typed: a tank is a small record with references pointing
      // at it rather than an aggregate with a history hanging off it — but the
      // zones that drink from it have to be named either way (§4.5 clause 3).
      tier: "elevated",
      recordName: source.name,
      entity: "water source",
      dependents: drinkers.map((zone) => ({
        entity: "Zone",
        label: zone.name,
        // The zone survives; it loses its water.
        effect: "detached" as const,
      })),
      ...(drinkers.length > 0
        ? {
            consequence:
              "Those zones will show no water source, and no freeze chore will name them until you give them one.",
          }
        : {}),
      action: "Delete",
    });

    if (!confirmed) return;

    const result = await mutations.remove(source.id);
    if (!result.ok) {
      show({ message: "Could not delete that tank", tone: "danger" });
      return;
    }

    // Take it off the zones, so nothing is left pointing at a tombstone.
    for (const zone of drinkers) {
      await zoneMutations.update(zone.id, {
        waterSourceIds: zone.waterSourceIds.filter((id) => id !== source.id),
      });
    }

    show({
      message: `${source.name} deleted`,
      action: {
        label: "Undo",
        // Both halves, or the undo is a lie: the tank comes back, and so do
        // the references stripped to delete it — `drinkers` was captured
        // before the strip, so it still holds each zone's original list.
        onAct: () => {
          void (async () => {
            await mutations.restoreRecord(source.id);
            for (const zone of drinkers) {
              await zoneMutations.update(zone.id, { waterSourceIds: zone.waterSourceIds });
            }
          })();
        },
      },
    });
  }

  if (loading) return <p className="text-muted">Loading tanks…</p>;

  return (
    <div className="flex flex-col gap-density">
      {vulnerable.length === 0 ? null : (
        <Callout tone="danger" title={`${vulnerable.length} in use with no heater`}>
          {vulnerable.map((target) => target.waterSource.name).join(", ")} —{" "}
          {vulnerable.length === 1 ? "this is the tank" : "these are the tanks"} §6 names in the
          freeze alert, and {vulnerable.length === 1 ? "it is" : "they are"} where the ice-breaking
          chores land on a hard-freeze morning.
        </Callout>
      )}

      <Section
        title="Tanks"
        description="One record per tank, not per zone — tanks are shared, and a chore list that sends someone to the same trough twice stops being read."
        actions={
          <Button variant="primary" onClick={startCreate}>
            Add a tank
          </Button>
        }
      >
        {water.length === 0 ? (
          <EmptyState
            title="No water sources yet"
            detail="Add the tanks first, then tick them on the zones that drink from them."
            action={
              <Button variant="primary" onClick={startCreate}>
                Add the first tank
              </Button>
            }
          />
        ) : (
          <CardGrid columns={3}>
            {water.map((source) => {
              const drinkers = servedBy(source);
              const atRisk = source.active && !source.hasHeater && drinkers.length > 0;

              return (
                <RecordCard
                  key={source.id}
                  tone={!source.active ? "neutral" : atRisk ? "danger" : "calm"}
                  title={source.name}
                  subtitle={TYPE_LABEL[source.type]}
                  actions={
                    <Pill tone={source.active ? "calm" : "neutral"} dot={!source.active}>
                      {source.active ? "out" : "stowed"}
                    </Pill>
                  }
                  meta={
                    <>
                      <Pill tone={source.hasHeater ? "calm" : "danger"}>
                        {source.hasHeater ? "heated" : "no heater"}
                      </Pill>
                      <Pill tone="neutral">
                        {drinkers.length === 0
                          ? "serves nothing"
                          : `serves ${drinkers.map((zone) => zone.name).join(", ")}`}
                      </Pill>
                    </>
                  }
                >
                  {source.notes === undefined ? null : (
                    <p className="text-sm text-muted">{source.notes}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => void toggleActive(source)}>
                      {source.active ? "Stow it" : "Put it out"}
                    </Button>
                    <Button variant="ghost" onClick={() => startEdit(source)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void removeSource(source)}>
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
          title={editing === undefined ? "New tank" : `Editing ${editing.name}`}
          description="A trough, a tank, a pond — anywhere the stock drinks."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="Name"
              required
              hint="Name it for what it serves — &ldquo;Pen 1 / 2nd Pen tank&rdquo; beats &ldquo;Tank 2&rdquo; at six in the morning."
              value={draft.name}
              error={errors["name"]}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Select
              label="Type"
              options={TYPE_OPTIONS}
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as WaterSourceType })
              }
            />
            <Checkbox
              label="Has a heater"
              hint="Heaterless tanks are the ones the freeze alert calls out by name."
              checked={draft.hasHeater}
              onChange={(event) => setDraft({ ...draft, hasHeater: event.target.checked })}
            />
            <Checkbox
              label="Out and in use"
              hint="Untick a seasonal tank while it is stowed — a tank that is in raises no chore."
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
            <TextArea
              label="Notes"
              rows={3}
              hint="Where the float valve sticks, which hydrant fills it."
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <p className="text-sm text-muted">
              Which zones drink from this is set on the zone, where the tanks are ticked — a zone
              can have more than one.
            </p>

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add tank" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
