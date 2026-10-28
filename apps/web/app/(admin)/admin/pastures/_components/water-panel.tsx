"use client";

import { useState } from "react";

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
import {
  coversToFit,
  freezeCheckTargets,
  WATER_SOURCE_TYPES,
  waterSourceSchema,
  zoneSchema,
  type TankCover,
  type Ulid,
  type WaterSource,
  type WaterSourceType,
  type Zone,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

import {
  AddAction,
  ChipGroup,
  FilteredLine,
  LandRow,
  RowAction,
  RowList,
  StatusLine,
  type RowChip,
} from "./land-kit";

/**
 * The tanks (spec §5.1, §6).
 *
 * Water is its own record because tanks are shared: four of them serve eight
 * zones here, one serving three. That is what makes this a screen rather than
 * a checkbox on a zone — a tank is out or stowed, covered or not, and serves a
 * list of places, and all three of those are facts about the tank.
 *
 * Covers, not heaters, are what this place does about a freeze: nothing here
 * is heated and nothing is going to be. So the cover is the state this screen
 * leads with, and the one it makes changeable in a single tap — it is the
 * thing somebody walks out and changes twice a year, and again on the evening
 * a hard freeze is forecast.
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

const COVER_OPTIONS = [
  { value: "none", label: "No cover for this tank" },
  { value: "off", label: "Has a cover — currently off" },
  { value: "on", label: "Has a cover — currently on" },
];

const COVER_PILL: Readonly<Record<TankCover, string>> = {
  none: "no cover",
  off: "cover off",
  on: "covered",
};

interface Draft {
  readonly name: string;
  readonly type: WaterSourceType;
  readonly hasHeater: boolean;
  readonly cover: TankCover;
  readonly active: boolean;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  type: "auto_refill",
  hasHeater: false,
  cover: "off",
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
  /** Covers that exist and are not on — the job before the freeze, not during. */
  const toFit = coversToFit(targets);

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
      // A tank recorded before covers existed reads as having none, which is
      // the honest answer to a question nobody was asked.
      cover: source.cover ?? "none",
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
      cover: draft.cover,
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

  /**
   * On, or off — one tap.
   *
   * The whole point of tracking the cover is that somebody moves it, and the
   * moment they move it is the moment the app should hear about it. A form
   * standing between the barn and that fact is how the record ends up saying
   * the cover is on all summer.
   */
  async function toggleCover(source: WaterSource) {
    const next: TankCover = source.cover === "on" ? "off" : "on";
    const result = await mutations.update(source.id, { cover: next });
    if (!result.ok) {
      show({ message: "Could not change that", tone: "danger" });
      return;
    }

    show(
      next === "on"
        ? { message: `${source.name} is covered`, tone: "success" }
        : { message: `${source.name} uncovered — it goes back on before the next freeze` },
    );
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

  const [filter, setFilter] = useState("");

  /** The one line under a tank's name: what it is, its cover, what it serves. */
  function lineFor(source: WaterSource): string {
    const drinkers = servedBy(source);
    return [
      TYPE_LABEL[source.type],
      COVER_PILL[source.cover ?? "none"],
      source.hasHeater ? "heated" : undefined,
      drinkers.length === 0
        ? "serves nothing"
        : `serves ${drinkers.map((zone) => zone.name).join(", ")}`,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  /**
   * The one chip. Stowed first, because nothing else about a tank in the barn
   * matters tonight; then a cover that is off, which is the job before a
   * freeze; then a tank in use with nothing over it, which is what the freeze
   * alert will name.
   */
  function chipFor(source: WaterSource): RowChip | undefined {
    const cover: TankCover = source.cover ?? "none";
    if (!source.active) return { tone: "neutral", label: "Stowed" };
    if (cover === "off") return { tone: "action", label: "Cover off" };
    if (servedBy(source).length > 0 && cover !== "on") return { tone: "danger", label: "Exposed" };
    return undefined;
  }

  const stowedCount = water.filter((source) => !source.active).length;
  const chips = [
    { key: "", label: "All", count: water.length },
    { key: "out", label: "Out", count: water.length - stowedCount },
    ...(stowedCount === 0 ? [] : [{ key: "stowed", label: "Stowed", count: stowedCount }]),
    ...(toFit.length === 0 ? [] : [{ key: "cover", label: "Cover off", count: toFit.length }]),
  ];
  const coverOffIds = new Set(toFit.map((target) => target.waterSource.id));
  const shown = water.filter((source) =>
    filter === "out"
      ? source.active
      : filter === "stowed"
        ? !source.active
        : filter === "cover"
          ? coverOffIds.has(source.id)
          : true,
  );

  if (loading) return <p className="text-muted">Loading tanks…</p>;

  return (
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      {/*
        What the freeze asks of the tanks, as two lines rather than two boxes
        of prose. Covers first: that is the job that has to happen the evening
        before rather than the morning after. The heaterless line is quiet —
        it is true every day here, and nothing on this place is going to be
        heated — but it names where the ice-breaking chores will land.
      */}
      {toFit.length === 0 ? null : (
        <StatusLine tone="action">
          <span className="font-semibold">
            {toFit.length} cover{toFit.length === 1 ? "" : "s"} to put on before a freeze:
          </span>{" "}
          {toFit.map((target) => target.waterSource.name).join(", ")}
        </StatusLine>
      )}
      {vulnerable.length === 0 ? null : (
        <p className="text-sm text-muted">
          No heater, in use: {vulnerable.map((target) => target.waterSource.name).join(", ")} — the
          freeze-morning chores land here.
        </p>
      )}

      {water.length === 0 ? null : (
        <div className="flex items-center justify-between gap-density">
          <div className="min-w-0 flex-1">
            <ChipGroup label="Filter tanks" chips={chips} value={filter} onChange={setFilter} />
          </div>
          <AddAction label="Add tank" onClick={startCreate} />
        </div>
      )}

      <FilteredLine
        shown={shown.length}
        total={water.length}
        labels={filter === "" ? [] : [chips.find((chip) => chip.key === filter)?.label ?? ""]}
        onClear={() => setFilter("")}
      />

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
        /*
         * One record per tank, not per zone — tanks are shared, and a chore
         * list that sends someone to the same trough twice stops being read.
         */
        <RowList label="Tanks">
          {shown.map((source) => {
            const cover: TankCover = source.cover ?? "none";
            return (
              <LandRow
                key={source.id}
                title={source.name}
                openLabel={`Edit ${source.name}`}
                line={lineFor(source)}
                chip={chipFor(source)}
                quiet={!source.active}
                onOpen={() => startEdit(source)}
                // The cover is the one-tap job, when there is one to move. A
                // tank with no cover keeps the other one-tap job — out or in.
                action={
                  cover === "none" ? (
                    <RowAction
                      label={source.active ? `Stow ${source.name}` : `Put ${source.name} out`}
                      onClick={() => void toggleActive(source)}
                    >
                      {source.active ? "Stow" : "Put out"}
                    </RowAction>
                  ) : (
                    <RowAction
                      label={
                        cover === "on"
                          ? `Take the cover off ${source.name}`
                          : `Put the cover on ${source.name}`
                      }
                      onClick={() => void toggleCover(source)}
                    >
                      {cover === "on" ? "Uncover" : "Cover"}
                    </RowAction>
                  )
                }
              />
            );
          })}
        </RowList>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "New tank" : `Editing ${editing.name}`}
          description="A trough, a tank, a pond — anywhere the stock drinks."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add tank" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <>
                  {/* Out or in for a tank with a cover lives here, since the
                      row's one quick action is the cover. Applied at once,
                      like the row toggle, and the editor closes behind it. */}
                  {(editing.cover ?? "none") === "none" ? null : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const source = editing;
                        setDraft(undefined);
                        setEditing(undefined);
                        void toggleActive(source);
                      }}
                    >
                      {editing.active ? "Stow it" : "Put it out"}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    className="ml-auto"
                    onClick={() => {
                      const source = editing;
                      setDraft(undefined);
                      setEditing(undefined);
                      void removeSource(source);
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="Name"
              required
              hint="Name it for what it serves — &ldquo;Pen 1 / 2nd Pen tank&rdquo;, not &ldquo;Tank 2&rdquo;."
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
            <Select
              label="Cover"
              options={COVER_OPTIONS}
              value={draft.cover}
              hint="A cover that is off becomes a chore the evening before a freeze."
              onChange={(event) => setDraft({ ...draft, cover: event.target.value as TankCover })}
            />
            <Checkbox
              label="Has a heater"
              hint="Heaterless tanks are the ones the freeze alert names."
              checked={draft.hasHeater}
              onChange={(event) => setDraft({ ...draft, hasHeater: event.target.checked })}
            />
            <Checkbox
              label="Out and in use"
              hint="Untick while it is stowed — a tank that is in raises no chore."
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

            {/* Said because the obvious place to look for it is here. */}
            <p className="text-sm text-muted">Which zones drink from it is ticked on each zone.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
