"use client";

import { useCallback, useMemo, useState } from "react";

import {
  Button,
  Card,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Section,
  SpatialEditor,
  propertyPalette,
  useToast,
  type SpatialDraft,
  type SpatialReassignment,
  type SpatialView,
} from "@galaxy-farm/ui";
import {
  describeZoneExtent,
  encodeUlid,
  isOnProperty,
  moveToZone,
  standingDividers,
  zoneAssignmentSchema,
  zoneSchema,
  type Property,
  type Ulid,
  type Zone,
  type ZoneAssignment,
  type Animal,
} from "@galaxy-farm/core";

import { GoogleSatelliteLayer } from "@/app/(admin)/admin/map/_components/google-satellite-layer";
import {
  ChipGroup,
  LandRow,
  RowAction,
  RowList,
  StatusLine,
} from "@/app/(admin)/admin/pastures/_components/land-kit";
import { mapsApiKey, mapsNotConfigured } from "@/lib/google-maps";
import { animalChips, zoneShapes } from "@/lib/map-shapes";
import { offlineImagery, offlineImageryGap } from "@/lib/offline-imagery";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The property map (spec §7, §8) — the shared `SpatialEditor` in property mode.
 *
 * This screen used to be the map: it loaded the Maps API, built Google
 * polygons out of zone boundaries, and listened for clicks on Google's canvas.
 * Everything about a pen therefore needed Google to be reachable, and the
 * offline background §8 asks for could never have been the same code path — it
 * would have been a second implementation of the same drawing.
 *
 * So the editor draws the pens now, in SVG over lat/lng, and the background is
 * a slot: Google's tiles online, an owned NAIP snapshot when there is no
 * signal, neither knowing about the other. What is left here is composition —
 * flattening zones and animals into shapes and chips, and turning a dragged
 * chip into the two writes that move an animal.
 */

export function PropertyMapScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { show } = useToast();
  const query = useMemo(() => ({ propertyId }), [propertyId]);

  const { records: allZones } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: properties } = useRecords<Property>("properties", query);

  // Off-site zones have no ground here to draw, and prompting somebody to
  // trace a boundary for a collection facility two counties away is noise.
  const zones = useMemo(() => allZones.filter(isOnProperty), [allZones]);
  const property = properties.find((entry) => entry.id === propertyId) ?? properties[0];

  const zoneApi = useMutations<Zone>("zones", "zones", zoneSchema, propertyId, actorId);
  const placements = useMutations<ZoneAssignment>(
    "zoneAssignments",
    "zoneAssignments",
    zoneAssignmentSchema,
    propertyId,
    actorId,
  );

  const [draft, setDraft] = useState<SpatialDraft | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /** A move into resting ground, waiting to be confirmed. */
  const [challenge, setChallenge] = useState<{ animal: Animal; zone: Zone } | undefined>();

  // Read once per mount. "Who is in this pen" is a question about now, and a
  // fresh Date on every render would rebuild every shape on every keystroke.
  const now = useMemo(() => new Date(), []);

  const shapes = useMemo(
    () => zoneShapes(zones, animals, assignments, now),
    [zones, animals, assignments, now],
  );
  const chips = useMemo(
    () => animalChips(zones, animals, assignments, now),
    [zones, animals, assignments, now],
  );

  const indoorZoneIds = useMemo(
    () => new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id)),
    [zones],
  );

  /**
   * Which background is behind the pens.
   *
   * Google when it is configured and loading; ours when it is not. Never both
   * — the owned image is drawn inside the editor's canvas and would cover the
   * tiles, and paying for a map load nobody can see is the worst of both.
   */
  const googleAvailable = mapsApiKey() !== undefined && error === undefined;
  const cached = useMemo(
    () => (property === undefined ? undefined : offlineImagery(property)),
    [property],
  );
  const imagery = googleAvailable ? undefined : cached;

  const onMapFailure = useCallback((reason: string) => setError(reason), []);
  const backdrop = useMemo(
    () =>
      googleAvailable
        ? (view: SpatialView) => <GoogleSatelliteLayer view={view} onFailure={onMapFailure} />
        : undefined,
    [googleAvailable, onMapFailure],
  );

  /**
   * Move an animal, as two writes rather than one edit.
   *
   * The open assignment closes and a new one opens, which is what makes "where
   * was she in March" answerable — and it is why they are separate patches: a
   * device that syncs the close but not the open must not end up with the
   * animal nowhere.
   */
  const performMove = useCallback(
    async (animal: Animal, zone: Zone) => {
      const at = new Date();
      const { closed, opened } = moveToZone(
        assignments,
        {
          id: encodeUlid(at.getTime()) as Ulid,
          propertyId,
          createdAt: at,
          updatedAt: at,
          animalId: animal.id,
          zoneId: zone.id,
          indoor: zone.indoor,
          at,
        },
        indoorZoneIds,
      );

      for (const entry of closed) {
        await placements.update(entry.id, { periodTo: entry.periodTo });
      }

      if (opened === undefined) {
        // Already there. Saying so is the honest answer to the gesture that
        // was made; writing a second identical assignment was the old one.
        show({ message: `${animal.name ?? "She"} is already in ${zone.name}`, tone: "info" });
        return;
      }

      const result = await placements.create(opened);
      show(
        result.ok
          ? { message: `Moved to ${zone.name}`, tone: "success" }
          : { message: "That move would not save.", tone: "danger" },
      );
    },
    [assignments, indoorZoneIds, placements, propertyId, show],
  );

  const onReassign = useCallback(
    (move: SpatialReassignment) => {
      const animal = animals.find((candidate) => candidate.id === move.chipId);
      const zone = zones.find((candidate) => candidate.id === move.toShapeId);
      if (animal === undefined || zone === undefined) return;

      // Resting ground is being kept empty on purpose (§5.1), and the person
      // dragging is usually not the person who rested it. Challenged, not
      // refused — sometimes you do need to put a cow on it.
      if (zone.resting) {
        setChallenge({ animal, zone });
        return;
      }

      void performMove(animal, zone);
    },
    [animals, performMove, zones],
  );

  const saveBoundary = useCallback(async () => {
    if (draft === undefined || draft.boundary.length < 3) return;
    setSaving(true);

    try {
      // The editor deals in plain string ids — it has never heard of a ULID,
      // and that is the boundary (§4.1). This is the seam where they become
      // ours again; the id came out of a zone we handed it in the first place.
      const outcome = await zoneApi.update(draft.shapeId as Ulid, { boundary: draft.boundary });
      if (outcome.ok) {
        show({ tone: "success", message: `Boundary saved — ${draft.boundary.length} corners.` });
        setDraft(undefined);
      } else {
        setError("That boundary would not save.");
      }
    } finally {
      setSaving(false);
    }
  }, [draft, show, zoneApi]);

  /**
   * Start tracing a zone, or stop.
   *
   * Adjusting starts from the corners that are already there; drawing starts
   * empty. Redrawing a traced pen from scratch is "Start over" once the
   * corners are on screen, where somebody can see what they are about to
   * throw away.
   */
  const traceAction = (zone: Zone) =>
    draft?.shapeId === zone.id ? (
      <RowAction label={`Stop tracing ${zone.name}`} onClick={() => setDraft(undefined)}>
        Cancel
      </RowAction>
    ) : (
      <RowAction
        label={`${zone.boundary === undefined ? "Draw" : "Adjust"} ${zone.name}`}
        onClick={() => setDraft({ shapeId: zone.id, boundary: zone.boundary ?? [] })}
      >
        {zone.boundary === undefined ? "Draw" : "Adjust"}
      </RowAction>
    );

  const isDrawn = (zone: Zone) => (zone.boundary?.length ?? 0) >= 3;

  /** The one line under a zone: what it is, how it is drawn, its fencing. */
  function lineFor(zone: Zone): string {
    const standing = standingDividers(zone);
    return [
      capitalise(zone.type.replace(/_/g, " ")),
      isDrawn(zone) ? `${zone.boundary?.length ?? 0} corners` : undefined,
      (zone.dividers ?? []).length === 0
        ? undefined
        : standing.length === 0
          ? "temporary fencing down"
          : `${standing.length} temporary fence${standing.length === 1 ? "" : "s"} up`,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  const [onlyUndrawn, setOnlyUndrawn] = useState(false);

  const noKey = mapsApiKey() === undefined;
  const gap = property === undefined ? undefined : offlineImageryGap(property);
  const drawnCount = zones.filter(isDrawn).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Farm"
        title="Property map"
        subtitle={`${drawnCount} of ${zones.length} zones drawn`}
      />

      {/*
        What is wrong with the background, one line each rather than a stack
        of boxes above the map. The pens are drawn either way — they are
        stored as coordinates, not as a picture — so none of this stops work,
        and the long setup text waits behind its own toggle.
      */}
      {noKey || error !== undefined || (imagery === undefined && gap !== undefined) ? (
        <div className="flex flex-col gap-1">
          {error === undefined ? null : (
            <StatusLine tone="danger">
              The aerial view could not be shown: {error} The pens are still drawn and editable.
            </StatusLine>
          )}
          {noKey ? (
            <details className="text-sm text-muted">
              <summary className="inline-flex min-h-target cursor-pointer flex-wrap items-center gap-x-1">
                The aerial view is not connected.{" "}
                <span className="font-semibold text-action">How to connect it</span>
              </summary>
              <p className="max-w-prose pb-2">{mapsNotConfigured()}</p>
            </details>
          ) : null}
          {imagery === undefined && gap !== undefined ? (
            <details className="text-sm text-muted">
              <summary className="inline-flex min-h-target cursor-pointer flex-wrap items-center gap-x-1">
                No offline background yet. <span className="font-semibold text-action">Why</span>
              </summary>
              <p className="max-w-prose pb-2">
                {gap} Google&rsquo;s tiles cannot stand in for it: their terms do not permit storing
                them, which is the whole reason for keeping our own.
              </p>
            </details>
          ) : null}
        </div>
      ) : null}

      <Section
        title="Aerial view"
        description={
          draft === undefined
            ? "Drag an animal to move it; tap one for its instructions"
            : "Tap each corner; drag a corner to move it"
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
              <Button
                variant="primary"
                onClick={() => void saveBoundary()}
                disabled={draft.boundary.length < 3 || saving}
              >
                {saving ? "Saving…" : "Save boundary"}
              </Button>
            </span>
          )
        }
      >
        <Card>
          <SpatialEditor
            palette={propertyPalette}
            shapes={shapes}
            chips={chips}
            {...(backdrop === undefined ? {} : { backdrop })}
            {...(imagery === undefined ? {} : { imagery })}
            {...(property?.latitude === undefined || property.longitude === undefined
              ? {}
              : { fallbackCentre: { lat: property.latitude, lng: property.longitude } })}
            {...(draft === undefined ? {} : { draft })}
            onDraftChange={setDraft}
            onReassign={onReassign}
            label="Aerial view of the property"
          />
        </Card>
      </Section>

      <Section title="Zones">
        {zones.length === 0 ? (
          <EmptyState
            title="No zones yet"
            detail="Add the pens and pastures under Pastures and water, then come back and draw them."
          />
        ) : (
          <>
            {drawnCount === zones.length ? null : (
              <ChipGroup
                label="Filter zones"
                chips={[
                  { key: "", label: "All", count: zones.length },
                  { key: "undrawn", label: "Not drawn", count: zones.length - drawnCount },
                ]}
                value={onlyUndrawn ? "undrawn" : ""}
                onChange={(key) => setOnlyUndrawn(key === "undrawn")}
              />
            )}
            <RowList label="Zones and their boundaries">
              {zones
                .filter((zone) => !onlyUndrawn || !isDrawn(zone))
                .map((zone) => {
                  const standing = standingDividers(zone);
                  return (
                    <LandRow
                      key={zone.id}
                      title={describeZoneExtent(zone)}
                      line={lineFor(zone)}
                      // Not drawn is the one thing to fix; fencing up is the
                      // one thing worth noticing on ground that is drawn.
                      chip={
                        !isDrawn(zone)
                          ? { tone: "neutral", label: "Not drawn" }
                          : standing.length > 0
                            ? { tone: "action", label: `${standing.length} up` }
                            : undefined
                      }
                      action={traceAction(zone)}
                    />
                  );
                })}
            </RowList>
          </>
        )}
      </Section>

      {challenge === undefined ? null : (
        <Modal
          title={`Move ${challenge.animal.name ?? "her"} onto ${challenge.zone.name}?`}
          onClose={() => setChallenge(undefined)}
        >
          <p className="text-density text-ink">
            {challenge.zone.name} is resting — it is being kept empty on purpose to let the grass
            come back. Moving stock onto it now undoes that.
          </p>
          <div className="mt-density flex gap-2">
            <Button variant="ghost" onClick={() => setChallenge(undefined)}>
              Leave her where she is
            </Button>
            <Button
              onClick={() => {
                const { animal, zone } = challenge;
                setChallenge(undefined);
                void performMove(animal, zone);
              }}
            >
              Move her anyway
            </Button>
          </div>
        </Modal>
      )}
    </PageBody>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
