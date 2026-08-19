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
  SpatialEditor,
  propertyPalette,
  useToast,
  type Column,
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

  const columns = useMemo<Column<Zone>[]>(
    () => [
      { key: "name", header: "Zone", primary: true, render: (zone) => describeZoneExtent(zone) },
      { key: "type", header: "Kind", render: (zone) => zone.type.replace(/_/g, " ") },
      {
        key: "drawn",
        header: "On the map",
        render: (zone) =>
          zone.boundary === undefined || zone.boundary.length < 3 ? (
            <Pill tone="neutral">Not drawn</Pill>
          ) : (
            <Pill tone="calm">{zone.boundary.length} corners</Pill>
          ),
      },
      {
        key: "fencing",
        header: "Temporary fencing",
        render: (zone) => {
          const standing = standingDividers(zone);
          if ((zone.dividers ?? []).length === 0) return "—";
          return standing.length === 0 ? (
            <Pill tone="neutral">Down</Pill>
          ) : (
            <Pill tone="action">{standing.length} up</Pill>
          );
        },
      },
      {
        key: "trace",
        header: "",
        render: (zone) =>
          draft?.shapeId === zone.id ? (
            <Button variant="ghost" onClick={() => setDraft(undefined)}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() =>
                // Adjusting starts from the corners that are already there;
                // drawing starts empty. Redrawing a traced pen from scratch is
                // "Start over" once the corners are on screen, where somebody
                // can see what they are about to throw away.
                setDraft({ shapeId: zone.id, boundary: zone.boundary ?? [] })
              }
            >
              {zone.boundary === undefined ? "Draw" : "Adjust"}
            </Button>
          ),
      },
    ],
    [draft],
  );

  const noKey = mapsApiKey() === undefined;
  const gap = property === undefined ? undefined : offlineImageryGap(property);
  const drawnCount = zones.filter((zone) => (zone.boundary?.length ?? 0) >= 3).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Today"
        title="Property map"
        subtitle="Pens traced over aerial imagery, with everything standing in them. Boundaries are stored as real coordinates, so the same shapes render on a barn screen with no signal."
        meta={
          <Pill tone="neutral">
            {drawnCount} of {zones.length} drawn
          </Pill>
        }
      />

      {noKey ? (
        <Callout tone="neutral" title="The aerial view is not connected">
          {mapsNotConfigured()}
        </Callout>
      ) : null}

      {error === undefined ? null : (
        <Callout tone="danger" title="The aerial view could not be shown">
          {error} The pens are still drawn and still editable — they are stored as coordinates, not
          as a picture.
        </Callout>
      )}

      {imagery === undefined && gap !== undefined ? (
        <Callout tone="neutral" title="No offline background yet">
          {gap} Google&rsquo;s tiles cannot stand in for it: their terms do not permit storing them,
          which is the whole reason for keeping our own.
        </Callout>
      ) : null}

      <Section
        title="Aerial view"
        description={
          draft === undefined
            ? "Tap a pen or an animal for its instructions. Drag an animal to move it."
            : "Click each corner. Drag a corner to move it."
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

      <Section title="Zones" description="Everything on the place, and whether it is on the map.">
        {zones.length === 0 ? (
          <EmptyState
            title="No zones yet"
            detail="Add the pens and pastures under Settings → Zones, then come back and draw them."
          />
        ) : (
          <DataTable
            caption="Zones and their boundaries"
            columns={columns}
            rows={zones}
            rowKey={(zone) => zone.id}
          />
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
