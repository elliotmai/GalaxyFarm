"use client";

import { useCallback, useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  SpatialEditor,
  gardenPalette,
  rankOf,
  useToast,
  type Column,
  type SpatialDraft,
  type SpatialReassignment,
} from "@galaxy-farm/ui";
import type { Property, Ulid, Zone } from "@galaxy-farm/core";
import {
  bedSchema,
  plantingSchema,
  type Bed,
  type Crop,
  type Planting,
  type PlantingMethod,
  type Variety,
} from "@galaxy-farm/module-garden";

import { METHOD_OPTIONS, formatDate } from "@/app/(admin)/admin/garden/_components/labels";
import { RotationCallout } from "@/app/(admin)/admin/garden/_components/rotation-callout";
import { familyOf, varietyLabel } from "@/lib/garden";
import {
  ROTATION_CLEAR,
  bedGeometry,
  bedRotationWarning,
  bedShapes,
  gardenGrid,
  gardenOrigin,
  plantingChips,
  type BedGeometry,
} from "@/lib/garden-plan";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The garden layout designer (spec §5.5, §7 `/admin/garden/layout`).
 *
 * The shared `SpatialEditor` in garden mode — the same component the property
 * map draws pens with, handed `gardenPalette` (§2: "one component, two
 * palettes"). Nothing in `packages/ui` learned what a crop is to make this
 * work; `lib/garden-plan.ts` flattens beds and plantings into rings and chips
 * on the way in, and turns a drawn ring back into the four numbers a `Bed`
 * stores on the way out.
 *
 * ## Two views of one Zone tree
 *
 * The beds belong to a garden `Zone`, and the plan is hung off that zone's
 * north-west corner. So this screen and `/admin/map` are drawings of the same
 * records rather than parallel worlds: trace the garden on the property map and
 * the whole plan moves onto the ground it actually occupies.
 *
 * ## Where the rotation guard shows
 *
 * §5.5 wants the warning where you plant, and there are two moments here.
 * Choosing what to plant colours **every bed** by the rotation guard for that
 * botanical family before a bed has been picked at all — which is early enough
 * to change the answer rather than to regret it. And dragging a planting into a
 * bed that grew its family recently raises the same warning as a challenge.
 * Both are warnings. Neither refuses.
 *
 * The guard itself is `rotationWarning` in the garden domain, reached through
 * the one path `lib/garden.ts` already built for the plantings form.
 */

/** What a quick-planted row is, until somebody edits it on the plantings screen. */
const QUICK_PLANT_STATUS = "growing";

/** All four numbers, or the plan has nothing to draw. */
function isDrawn(bed: Bed): boolean {
  return (
    bed.x !== undefined &&
    bed.y !== undefined &&
    bed.lengthFt !== undefined &&
    bed.widthFt !== undefined
  );
}

export function GardenLayoutScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { show } = useToast();
  const query = useMemo(() => ({ propertyId }), [propertyId]);

  const { records: beds, loading: bedsLoading } = useRecords<Bed>("beds", query);
  const { records: plantings } = useRecords<Planting>("plantings", query);
  const { records: varieties } = useRecords<Variety>("varieties", query);
  const { records: crops } = useRecords<Crop>("crops", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: properties } = useRecords<Property>("properties", query);

  const bedApi = useMutations<Bed>("beds", "beds", bedSchema, propertyId, actorId);
  const plantingApi = useMutations<Planting>(
    "plantings",
    "plantings",
    plantingSchema,
    propertyId,
    actorId,
  );

  const [zoneId, setZoneId] = useState<Ulid | undefined>();
  const [draft, setDraft] = useState<SpatialDraft | undefined>();
  const [saving, setSaving] = useState(false);
  const [selectedBedId, setSelectedBedId] = useState<Ulid | undefined>();
  const [varietyId, setVarietyId] = useState<string>("");
  const [method, setMethod] = useState<PlantingMethod>("direct_sow");
  /** A drawing that would overwrite dimensions somebody typed (§4.5). */
  const [resize, setResize] = useState<{ bed: Bed; geometry: BedGeometry } | undefined>();
  /** A planting dragged into a bed that grew its family recently. */
  const [challenge, setChallenge] = useState<{ planting: Planting; bed: Bed } | undefined>();

  // Read once per mount. "Is this bed clear" is a question about now, and a
  // fresh Date every render would recolour the plan on every keystroke.
  const now = useMemo(() => new Date(), []);

  /**
   * Which zones can hold a plan.
   *
   * Garden areas, plus any zone that already has beds in it — §5.5 says a bed
   * is a child of a garden zone, and the beds form (#36) deliberately lets one
   * be recorded against another kind of zone rather than blocking on somebody
   * having drawn a garden first. A designer that then refused to show those
   * beds would hide records the app itself allowed.
   */
  const places = useMemo(() => {
    const withBeds = new Set(beds.map((bed) => bed.zoneId));
    return zones
      .filter((zone) => zone.active && (zone.type === "garden_area" || withBeds.has(zone.id)))
      .sort((left, right) =>
        left.type === right.type
          ? left.name.localeCompare(right.name)
          : left.type === "garden_area"
            ? -1
            : 1,
      );
  }, [beds, zones]);

  const zone = places.find((entry) => entry.id === zoneId) ?? places[0];
  const property = properties.find((entry) => entry.id === propertyId) ?? properties[0];
  const origin = useMemo(() => gardenOrigin(zone, property), [zone, property]);

  const inZone = useMemo(
    () => beds.filter((bed) => zone !== undefined && bed.zoneId === zone.id),
    [beds, zone],
  );

  const family = familyOf(varietyId === "" ? undefined : (varietyId as Ulid), varieties, crops);

  const shapes = useMemo(
    () =>
      origin === undefined
        ? []
        : bedShapes(inZone, plantings, varieties, crops, origin, now, family),
    [inZone, plantings, varieties, crops, origin, now, family],
  );
  /**
   * Only this garden's rows.
   *
   * A planting in another garden's bed has no bed on this plan to stand in, so
   * it would land in the tray of chips the editor could not place — which is
   * there to say "this row's bed has not been drawn yet", not "this row belongs
   * to a plan you are not looking at".
   */
  const chips = useMemo(() => {
    const here = new Set(inZone.map((bed) => bed.id));
    return plantingChips(
      plantings.filter((planting) => here.has(planting.bedId)),
      varieties,
      crops,
    );
  }, [inZone, plantings, varieties, crops]);

  const bedById = useCallback(
    (id: Ulid | undefined) => inZone.find((bed) => bed.id === id),
    [inZone],
  );
  const selectedBed = bedById(selectedBedId);

  /** The rotation answer for the bed on screen and the variety in the picker. */
  const warning = useMemo(
    () =>
      selectedBed === undefined
        ? undefined
        : bedRotationWarning(selectedBed.id, family, plantings, varieties, crops, now),
    [selectedBed, family, plantings, varieties, crops, now],
  );

  /**
   * Write a drawn rectangle onto the bed.
   *
   * The drawing and the tape measure are the same two numbers, so this writes
   * the dimensions as well as the position — a bed drawn eight feet long is
   * eight feet long, and leaving `lengthFt` saying otherwise would give the
   * plan and the beds list two different answers about one bed.
   */
  const persist = useCallback(
    async (bed: Bed, geometry: BedGeometry) => {
      setSaving(true);
      try {
        const outcome = await bedApi.update(bed.id, geometry);
        if (outcome.ok) {
          show({
            tone: "success",
            message: `${bed.name} drawn — ${geometry.lengthFt}′ × ${geometry.widthFt}′.`,
          });
          setDraft(undefined);
        } else {
          show({ tone: "danger", message: `${bed.name} would not save at that size.` });
        }
      } finally {
        setSaving(false);
      }
    },
    [bedApi, show],
  );

  const saveDraft = useCallback(() => {
    if (draft === undefined || origin === undefined) return;

    // The editor deals in plain string ids — it has never heard of a ULID, and
    // that is the boundary (§4.1). This is the seam where they become ours
    // again; the id came out of a bed we handed it in the first place.
    const bed = bedById(draft.shapeId as Ulid);
    if (bed === undefined) return;

    const geometry = bedGeometry(draft.boundary, origin);
    if (geometry === undefined) {
      show({
        tone: "warning",
        message: "That outline encloses no ground. Move a corner and retry.",
      });
      return;
    }

    // Redrawing a bed that already has dimensions overwrites numbers somebody
    // measured with a tape, which is not a delete but is the same kind of
    // surprise §4.5 exists to prevent. Only when they actually disagree —
    // confirming that 8 × 4 is about to become 8 × 4 teaches people to click
    // through dialogs.
    const changed = bed.lengthFt !== geometry.lengthFt || bed.widthFt !== geometry.widthFt;
    if (bed.lengthFt !== undefined && bed.widthFt !== undefined && changed) {
      setResize({ bed, geometry });
      return;
    }

    void persist(bed, geometry);
  }, [bedById, draft, origin, persist, show]);

  /** Move a planting to another bed — one field, because a bed is where it is. */
  const movePlanting = useCallback(
    async (planting: Planting, bed: Bed) => {
      const outcome = await plantingApi.update(planting.id, { bedId: bed.id });
      show(
        outcome.ok
          ? { tone: "success", message: `Moved to ${bed.name}` }
          : { tone: "danger", message: "That move would not save." },
      );
    },
    [plantingApi, show],
  );

  const onReassign = useCallback(
    (move: SpatialReassignment) => {
      const planting = plantings.find((entry) => entry.id === move.chipId);
      const bed = bedById(move.toShapeId as Ulid);
      if (planting === undefined || bed === undefined) return;

      const moved = bedRotationWarning(
        bed.id,
        familyOf(planting.varietyId, varieties, crops),
        plantings,
        varieties,
        crops,
        now,
        // Against the rest of the bed's history and not against itself: a row
        // dragged out of a bed and back would otherwise warn about its own
        // presence there.
        planting.id,
      );

      if (moved !== undefined) {
        setChallenge({ planting, bed });
        return;
      }

      void movePlanting(planting, bed);
    },
    [bedById, crops, movePlanting, now, plantings, varieties],
  );

  /** Record a row straight from the plan: this variety, in the bed on screen. */
  const plantHere = useCallback(async () => {
    if (selectedBed === undefined || varietyId === "") return;

    const result = await plantingApi.create({
      bedId: selectedBed.id,
      varietyId: varietyId as Ulid,
      method,
      plantedOn: now,
      status: QUICK_PLANT_STATUS,
    } as never);

    if (!result.ok) {
      show({ tone: "danger", message: "That planting would not save." });
      return;
    }

    // Said on the way out, because the warning on screen goes with the
    // selection and this is a decision worth remembering having made — the
    // same sentence the plantings form uses.
    show({
      tone: warning === undefined ? "success" : "warning",
      message:
        warning === undefined
          ? `Planted in ${selectedBed.name}`
          : `Recorded against the rotation warning — ${warning.family} was last in ${selectedBed.name} ${formatDate(warning.lastPlantedOn)}`,
    });
  }, [method, now, plantingApi, selectedBed, show, varietyId, warning]);

  const varietyOptions = useMemo(
    () =>
      [...varieties]
        .map((variety) => ({ value: variety.id, label: varietyLabel(variety, crops) }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [varieties, crops],
  );

  const columns = useMemo<Column<Bed>[]>(
    () => [
      { key: "name", header: "Bed", primary: true, render: (bed) => bed.name },
      {
        key: "size",
        header: "Size",
        render: (bed) =>
          bed.lengthFt === undefined || bed.widthFt === undefined
            ? "—"
            : `${bed.lengthFt}′ × ${bed.widthFt}′`,
      },
      {
        key: "drawn",
        header: "On the plan",
        // Drawn means all four numbers, which is what `bedBoundary` needs — a
        // pill saying "drawn" over a bed the plan leaves out would be the one
        // place the two views disagree.
        render: (bed) =>
          isDrawn(bed) ? (
            <Pill tone="calm">
              {bed.x}′ east, {bed.y}′ south
            </Pill>
          ) : (
            <Pill tone="neutral">Not drawn</Pill>
          ),
      },
      {
        key: "draw",
        header: "",
        render: (bed) =>
          draft?.shapeId === bed.id ? (
            <Button variant="ghost" onClick={() => setDraft(undefined)}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() =>
                // Adjusting starts from the rectangle that is already there;
                // drawing starts empty. Throwing away a drawn bed is "Start
                // over", where its corners are on screen to be looked at first.
                setDraft({
                  shapeId: bed.id,
                  boundary:
                    origin === undefined
                      ? []
                      : (shapes.find((shape) => shape.id === bed.id)?.boundary ?? []).slice(),
                })
              }
            >
              {isDrawn(bed) ? "Adjust" : "Draw"}
            </Button>
          ),
      },
    ],
    [draft, origin, shapes],
  );

  const drawn = inZone.filter(isDrawn).length;

  if (bedsLoading) return <p className="text-muted">Loading the garden…</p>;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Land"
        title="Garden layout"
        subtitle="The beds as they sit on the ground, with what is growing in them. The same editor as the property map, wearing the garden's palette."
        meta={
          <Pill tone="neutral">
            {drawn} of {inZone.length} drawn
          </Pill>
        }
      />

      {places.length === 0 ? (
        <EmptyState
          title="No garden zone yet"
          detail="A bed sits inside a zone — the garden area it is part of. Add one under Settings → Property, then record the beds under Plantings → Beds and come back to draw them."
        />
      ) : origin === undefined ? (
        <Callout tone="action" title="The garden has nowhere to hang">
          A plan is drawn against real ground. Either trace {zone?.name ?? "the garden"} on the
          property map, or set the property&rsquo;s coordinates under Settings → Property — either
          one gives the beds a corner to be measured from.
        </Callout>
      ) : (
        <>
          {places.length === 1 ? null : (
            <Select
              label="Garden"
              hint="Beds are children of a zone, so this plan and the property map are two drawings of the same tree."
              options={places.map((entry) => ({ value: entry.id, label: entry.name }))}
              value={zone?.id ?? ""}
              onChange={(event) => {
                setZoneId(event.target.value as Ulid);
                setDraft(undefined);
                setSelectedBedId(undefined);
              }}
            />
          )}

          <Section
            title="Plan"
            description={
              draft === undefined
                ? "Tap a bed or a planting for its notes. Drag a planting to move it to another bed."
                : "Click the corners of the bed. Three is enough — a bed is the rectangle around them — and corners snap to the foot."
            }
            actions={
              draft === undefined ? undefined : (
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setDraft({ shapeId: draft.shapeId, boundary: draft.boundary.slice(0, -1) })
                    }
                    disabled={draft.boundary.length === 0 || saving}
                  >
                    Undo corner
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDraft({ shapeId: draft.shapeId, boundary: [] })}
                    disabled={draft.boundary.length === 0 || saving}
                  >
                    Start over
                  </Button>
                  <Button variant="ghost" onClick={() => setDraft(undefined)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={saveDraft} disabled={draft.boundary.length < 3 || saving}>
                    {saving ? "Saving…" : "Save the bed"}
                  </Button>
                </span>
              )
            }
          >
            <Card>
              <SpatialEditor
                palette={gardenPalette}
                shapes={shapes}
                chips={chips}
                grid={gardenGrid(origin)}
                fallbackCentre={origin}
                {...(draft === undefined ? {} : { draft })}
                onDraftChange={setDraft}
                onSelectShape={(id) => setSelectedBedId(id as Ulid | undefined)}
                onSelectChip={(id) => {
                  if (id !== undefined) setSelectedBedId(undefined);
                }}
                onReassign={onReassign}
                label="Plan of the garden beds"
              />
            </Card>
          </Section>

          <Section
            title="Planting"
            description="Choose what is going in and every bed colours itself by the rotation guard — before a bed has been picked, which is the only moment the warning can still change the answer."
          >
            {varietyOptions.length === 0 ? (
              <EmptyState
                title="No varieties yet"
                detail="Rotation runs on the botanical family, which lives on the crop. Add the crops and varieties under Garden → Seeds and the plan will colour itself."
              />
            ) : (
              <div className="flex flex-col gap-density">
                <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
                  <Select
                    label="Variety"
                    hint="What you are about to put in the ground."
                    options={[{ value: "", label: "Nothing chosen" }, ...varietyOptions]}
                    value={varietyId}
                    onChange={(event) => setVarietyId(event.target.value)}
                  />
                  <Select
                    label="How"
                    options={METHOD_OPTIONS}
                    value={method}
                    onChange={(event) => setMethod(event.target.value as PlantingMethod)}
                  />
                </div>

                {family === undefined ? (
                  <p className="m-0 text-density text-muted">
                    {varietyId === ""
                      ? "Nothing chosen, so the beds are drawn plain — whether a bed is clear is not a question it can answer on its own."
                      : "That variety has no crop behind it, so there is no family to check the rotation on."}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-density text-muted">
                      {gardenPalette.rankTitle} for {family}:
                    </span>
                    {[ROTATION_CLEAR, 2, 3].map((step) => {
                      const rank = rankOf(gardenPalette, step);
                      if (rank === undefined) return null;
                      return (
                        <span
                          key={step}
                          className="rounded-density px-2 py-1 text-xs"
                          style={{ backgroundColor: rank.color, color: rank.ink }}
                        >
                          {rank.label}
                        </span>
                      );
                    })}
                  </div>
                )}

                {selectedBed === undefined ? (
                  <p className="m-0 text-density text-muted">
                    Tap a bed on the plan to plant in it.
                  </p>
                ) : (
                  <>
                    {warning === undefined ? null : (
                      <RotationCallout warning={warning} bedName={selectedBed.name}>
                        This does not stop you. Another bed is one tap away, and if you know why you
                        are doing it, plant it and say so in the notes on the plantings screen.
                      </RotationCallout>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        disabled={varietyId === "" || !selectedBed.active}
                        onClick={() => void plantHere()}
                      >
                        Plant it in {selectedBed.name}
                      </Button>
                      {selectedBed.active ? null : (
                        <span className="text-density text-muted">
                          {selectedBed.name} is switched off. Turn it back on under Plantings → Beds
                          to plant in it.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Section>

          <Section
            title="Beds"
            description="Everything in this garden, and whether it has been drawn yet. Position is measured in feet from the garden's north-west corner."
          >
            {inZone.length === 0 ? (
              <EmptyState
                title="No beds in this garden yet"
                detail="Add them under Plantings → Beds. A bed is a record before it is a rectangle — this screen draws the ones that already exist."
              />
            ) : (
              <DataTable
                caption="Beds and where they sit"
                columns={columns}
                rows={inZone}
                rowKey={(bed) => bed.id}
              />
            )}
          </Section>
        </>
      )}

      {resize === undefined ? null : (
        <Modal title={`Resize ${resize.bed.name}?`} onClose={() => setResize(undefined)}>
          <p className="text-density text-ink">
            {resize.bed.name} is recorded as {resize.bed.lengthFt}′ × {resize.bed.widthFt}′. Saving
            this drawing makes it {resize.geometry.lengthFt}′ × {resize.geometry.widthFt}′, and the
            square footage every planting is planned against changes with it.
          </p>
          <div className="mt-density flex gap-2">
            <Button variant="ghost" onClick={() => setResize(undefined)}>
              Keep the measured size
            </Button>
            <Button
              onClick={() => {
                const { bed, geometry } = resize;
                setResize(undefined);
                void persist(bed, geometry);
              }}
            >
              Use the drawing
            </Button>
          </div>
        </Modal>
      )}

      {challenge === undefined ? null : (
        <RotationChallenge
          planting={challenge.planting}
          bed={challenge.bed}
          plantings={plantings}
          varieties={varieties}
          crops={crops}
          at={now}
          onClose={() => setChallenge(undefined)}
          onConfirm={() => {
            const { planting, bed } = challenge;
            setChallenge(undefined);
            void movePlanting(planting, bed);
          }}
        />
      )}
    </PageBody>
  );
}

/**
 * The guard, raised on a drag rather than on a form (spec §5.5).
 *
 * Dragging a row into a bed *is* planting it there, so it gets the same warning
 * the form gives — challenged, not refused, exactly as the property map
 * challenges a move onto resting ground rather than blocking it.
 */
function RotationChallenge({
  planting,
  bed,
  plantings,
  varieties,
  crops,
  at,
  onClose,
  onConfirm,
}: {
  readonly planting: Planting;
  readonly bed: Bed;
  readonly plantings: readonly Planting[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly at: Date;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const variety = varieties.find((entry) => entry.id === planting.varietyId);
  const warning = bedRotationWarning(
    bed.id,
    familyOf(planting.varietyId, varieties, crops),
    plantings,
    varieties,
    crops,
    at,
    planting.id,
  );

  return (
    <Modal title={`Move ${varietyLabel(variety, crops)} into ${bed.name}?`} onClose={onClose}>
      {warning === undefined ? null : (
        <RotationCallout warning={warning} bedName={bed.name}>
          This does not stop you — it is the reason to look before you drop.
        </RotationCallout>
      )}
      <div className="mt-density flex gap-2">
        <Button variant="ghost" onClick={onClose}>
          Leave it where it is
        </Button>
        <Button onClick={onConfirm}>Move it anyway</Button>
      </div>
    </Modal>
  );
}
