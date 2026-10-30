"use client";

import Link from "next/link";

import { Button, Checkbox, Modal, TextArea, TextInput } from "@galaxy-farm/ui";
import {
  dividersWithoutWater,
  type Divider,
  type Ulid,
  type WaterSource,
  type Zone,
} from "@galaxy-farm/core";

import { MOST_FENCES, type FenceDraft } from "@/app/(admin)/admin/map/_components/fences";
import {
  LandRow,
  RowAction,
  RowList,
  StatusLine,
} from "@/app/(admin)/admin/pastures/_components/land-kit";

/**
 * One zone, as the map knows it: its boundary and the temporary fencing
 * across it (spec §8).
 *
 * The map writes two things about a zone, and this is where each of them is
 * seen, changed and removed. Everything else about the zone — its name, its
 * water, its capacity — has one editor, under Pastures and water, and this
 * links there rather than growing a second copy that would drift from it.
 *
 * Presentational: the screen owns the writes and the confirmations, so a
 * delete from here goes through the same `useConfirmDelete` as every other.
 */
export function ZoneMapPanel({
  zone,
  water,
  onClose,
  onTrace,
  onRemoveBoundary,
  onAddFence,
  onOpenFence,
  onToggleFence,
}: {
  readonly zone: Zone;
  readonly water: readonly WaterSource[];
  readonly onClose: () => void;
  /** Start drawing the boundary — from its corners if it has some. */
  readonly onTrace: () => void;
  readonly onRemoveBoundary: () => void;
  readonly onAddFence: () => void;
  readonly onOpenFence: (fence: Divider) => void;
  readonly onToggleFence: (fence: Divider) => void;
}) {
  const corners = zone.boundary?.length ?? 0;
  const drawn = corners >= 3;
  const fences = zone.dividers ?? [];
  const waterName = (id: Ulid) => water.find((source) => source.id === id)?.name ?? "a tank";
  const active = new Set(water.filter((source) => source.active).map((source) => source.id));
  const dry = new Set(dividersWithoutWater(zone, active).map((fence) => fence.id));

  return (
    <Modal
      placement="side"
      title={zone.name}
      description="Its boundary on the map, and any temporary fencing across it."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Done</Button>
          {/* A link, not a second editor: the zone's details have one home. */}
          <Link
            href={`/admin/pastures?zone=${zone.id}`}
            className="ml-auto inline-flex min-h-target items-center rounded-density px-3 font-semibold text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-action"
          >
            Edit zone details
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-density">
        <section aria-label="Boundary" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Boundary</h3>
          <p className="text-sm text-muted">
            {drawn
              ? `Drawn, ${corners} corners.`
              : "Not drawn yet. Animals in it show beside the map rather than on it."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onTrace}>{drawn ? "Adjust on the map" : "Draw on the map"}</Button>
            {!drawn ? null : (
              <Button variant="danger" onClick={onRemoveBoundary}>
                Remove boundary
              </Button>
            )}
          </div>
        </section>

        <section aria-label="Temporary fencing" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Temporary fencing</h3>
          {fences.length === 0 ? (
            <p className="text-sm text-muted">
              None. A cross-fence that shuts the stock out of part of the field goes here, so the
              Pen Board can say which part they are in.
            </p>
          ) : (
            <RowList label={`Temporary fencing in ${zone.name}`}>
              {fences.map((fence) => (
                <LandRow
                  key={fence.id}
                  title={fence.name}
                  openLabel={`Edit ${fence.name}`}
                  quiet={!fence.up}
                  line={[
                    fence.up ? "up" : "down",
                    fence.closes === undefined ? undefined : `shuts out ${fence.closes}`,
                    fence.waterSourceIds.length === 0
                      ? "no water on their side"
                      : `water: ${fence.waterSourceIds.map(waterName).join(", ")}`,
                  ]
                    .filter((part) => part !== undefined)
                    .join(" · ")}
                  chip={dry.has(fence.id) ? { tone: "danger", label: "No water" } : undefined}
                  onOpen={() => onOpenFence(fence)}
                  action={
                    <RowAction
                      label={fence.up ? `Take ${fence.name} down` : `Put ${fence.name} up`}
                      onClick={() => onToggleFence(fence)}
                    >
                      {fence.up ? "Take down" : "Put up"}
                    </RowAction>
                  }
                />
              ))}
            </RowList>
          )}
          <div>
            <Button onClick={onAddFence} disabled={fences.length >= MOST_FENCES}>
              Add a fence
            </Button>
          </div>
          {fences.length < MOST_FENCES ? null : (
            <p className="text-sm text-muted">
              {MOST_FENCES} is the most one zone holds — delete one to add another.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

/**
 * One temporary fence: what it is called, whether it is up, and what water
 * the stock can still reach while it is.
 *
 * The line itself is drawn on the map; this is the form either side of that.
 * A new fence arrives here with its line already traced, and "Redraw the
 * line" goes back to the map with the draft kept.
 */
export function FenceEditor({
  zone,
  draft,
  editing,
  water,
  errors,
  busy,
  onChange,
  onRedraw,
  onSave,
  onCancel,
  onDelete,
}: {
  readonly zone: Zone;
  readonly draft: FenceDraft;
  /** The fence being edited; absent for a new one. */
  readonly editing: Divider | undefined;
  readonly water: readonly WaterSource[];
  readonly errors: Readonly<Record<string, string>>;
  readonly busy: boolean;
  readonly onChange: (next: FenceDraft) => void;
  readonly onRedraw: () => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}) {
  const noWater =
    draft.up &&
    !draft.waterSourceIds.some((id) => water.some((source) => source.id === id && source.active));

  return (
    <Modal
      placement="side"
      title={editing === undefined ? `New fence in ${zone.name}` : `Editing ${editing.name}`}
      description="Temporary fencing: a hot wire or panels run across part of the zone."
      onClose={onCancel}
      footer={
        <>
          <Button variant="primary" busy={busy} onClick={onSave}>
            {editing === undefined ? "Add fence" : "Save changes"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
          {editing === undefined ? null : (
            <Button variant="danger" className="ml-auto" onClick={onDelete}>
              Delete
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-density">
        <TextInput
          label="Name"
          required
          hint="What it is called at the gate — “West strip wire”."
          value={draft.name}
          error={errors["name"]}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm ${errors["line"] === undefined ? "text-muted" : "text-danger"}`}>
            {errors["line"] ??
              (draft.line.length < 2
                ? "Not drawn yet."
                : `Drawn on the map, ${draft.line.length} points.`)}
          </p>
          <RowAction onClick={onRedraw}>
            {draft.line.length < 2 ? "Draw the line" : "Redraw the line"}
          </RowAction>
        </div>
        <Checkbox
          label="Up now"
          hint="Untick when it is down. A fence that is down changes nothing at the gate."
          checked={draft.up}
          onChange={(event) => onChange({ ...draft, up: event.target.checked })}
        />
        <TextInput
          label="Shuts them out of"
          hint="Optional — “the creek bottom”. The Pen Board says this instead of the zone name."
          value={draft.closes}
          error={errors["closes"]}
          onChange={(event) => onChange({ ...draft, closes: event.target.value })}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-density font-medium text-ink">Water on their side</legend>
          {water.length === 0 ? (
            <p className="text-sm text-muted">No tanks yet — add them under Pastures and water.</p>
          ) : (
            water.map((source) => (
              <Checkbox
                key={source.id}
                label={`${source.name}${source.active ? "" : " (stowed)"}`}
                checked={draft.waterSourceIds.includes(source.id)}
                onChange={(event) =>
                  onChange({
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
        {!noWater ? null : (
          <StatusLine tone="danger">
            While it is up, nothing ticked here is out — the stock would be shut in with nothing to
            drink.
          </StatusLine>
        )}
        <TextArea
          label="Notes"
          rows={2}
          value={draft.notes}
          error={errors["notes"]}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </div>
    </Modal>
  );
}
