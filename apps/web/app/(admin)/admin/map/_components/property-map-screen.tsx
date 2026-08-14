"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  describeZoneExtent,
  isOnProperty,
  standingDividers,
  zoneSchema,
  type GeoPoint,
  type Property,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import {
  dashPattern,
  mapsNamespace,
  type MapsMap,
  type MapsPolygon,
  type MapsPolyline,
} from "@/lib/google-maps-api";
import { loadGoogleMaps, mapsApiKey, mapsNotConfigured } from "@/lib/google-maps";
import {
  DEFAULT_ZOOM,
  dividerPaint,
  isTraceable,
  openingView,
  traceHint,
  zonePaint,
} from "@/lib/map-geometry";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The property map (spec §7, §8).
 *
 * Pens traced over live aerial imagery, stored as real lat/lng. The storage
 * decision is the whole design: a boundary in latitudes renders over Google
 * online and over an owned NAIP snapshot on a kiosk with no signal, and neither
 * background knows about the other. A pen stored in screen coordinates would
 * have to be redrawn for the second one.
 *
 * The map is the one screen here that needs the network, and it says so rather
 * than showing a grey rectangle — a blank map reads as a broken app, and the
 * two reasons it can be blank (no key, no coordinates) are fixed in completely
 * different places.
 */

export function PropertyMapScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<Zone>("zones", "zones", zoneSchema, propertyId, actorId);
  const { show } = useToast();

  const { records: allZones } = useRecords<Zone>("zones", { propertyId });
  // Off-site zones have no ground here to draw, and prompting somebody to
  // trace a boundary for a collection facility two counties away is noise.
  const zones = useMemo(() => allZones.filter(isOnProperty), [allZones]);
  const { records: properties } = useRecords<Property>("properties", { propertyId });
  const property = properties.find((entry) => entry.id === propertyId) ?? properties[0];

  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapsMap | undefined>(undefined);
  /** Everything drawn, so a redraw can clear what it replaces. */
  const drawn = useRef<(MapsPolygon | MapsPolyline)[]>([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /** The zone being traced, and the corners clicked so far. */
  const [tracing, setTracing] = useState<Ulid | undefined>();
  const [path, setPath] = useState<GeoPoint[]>([]);
  const [saving, setSaving] = useState(false);

  // Read through a ref inside the map's click listener: the listener is
  // attached once, and a closure over the state would go on appending to the
  // empty array it captured on the first render.
  const tracingRef = useRef<Ulid | undefined>(undefined);
  tracingRef.current = tracing;

  const view = useMemo(() => openingView(zones, property ?? {}), [zones, property]);

  /** Load the API and put a map in the page. Once. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await loadGoogleMaps();
        if (cancelled) return;

        const maps = mapsNamespace();
        if (maps === undefined || host.current === null) return;

        const centre = view?.centre ?? { lat: 0, lng: 0 };
        const created = new maps.Map(host.current, {
          center: centre,
          zoom: DEFAULT_ZOOM,
          // Hybrid rather than plain satellite: the road and the county-road
          // label are how somebody orients themselves before the pens exist.
          mapTypeId: "hybrid",
          // Straight down. The 45° view is prettier and useless for tracing —
          // a fence line at a tilt does not sit where it is clicked.
          tilt: 0,
          streetViewControl: false,
          rotateControl: false,
          gestureHandling: "greedy",
        });

        created.addListener("click", (event) => {
          if (tracingRef.current === undefined) return;
          const at = event.latLng;
          if (at === undefined || at === null) return;
          setPath((current) => [...current, { lat: at.lat(), lng: at.lng() }]);
        });

        map.current = created;
        if (view?.bounds !== undefined) created.fitBounds(view.bounds, 48);
        setReady(true);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "The map would not load.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately once, with no dependencies: re-running would build a second
    // map over the first and bill a second load. The opening view is only ever
    // the opening view — where it moves to afterwards is the user's business.
  }, []);

  /** Redraw every shape whenever the records or the working path change. */
  useEffect(() => {
    const maps = mapsNamespace();
    const canvas = map.current;
    if (!ready || maps === undefined || canvas === undefined) return;

    for (const shape of drawn.current) shape.setMap(null);
    drawn.current = [];

    for (const zone of zones) {
      if (zone.boundary !== undefined && zone.boundary.length >= 3 && zone.id !== tracing) {
        drawn.current.push(
          new maps.Polygon({
            paths: zone.boundary.map((point) => ({ lat: point.lat, lng: point.lng })),
            map: canvas,
            clickable: false,
            ...zonePaint(zone),
          }),
        );
      }

      for (const divider of zone.dividers ?? []) {
        const paint = dividerPaint(divider);
        drawn.current.push(
          new maps.Polyline({
            path: divider.line.map((point) => ({ lat: point.lat, lng: point.lng })),
            map: canvas,
            strokeColor: paint.strokeColor,
            // A dashed line is drawn as repeated symbols along an invisible
            // stroke, so the stroke itself has to be hidden for it to read.
            strokeOpacity: paint.dashed ? 0 : paint.strokeOpacity,
            strokeWeight: paint.strokeWeight,
            zIndex: 5,
            ...(paint.dashed ? { icons: dashPattern() } : {}),
          }),
        );
      }
    }

    // The trace in progress, drawn over the top so it is always visible.
    if (path.length >= 2) {
      drawn.current.push(
        new maps.Polygon({
          paths: path.map((point) => ({ lat: point.lat, lng: point.lng })),
          map: canvas,
          clickable: false,
          strokeColor: "#FFFFFF",
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: "#FFFFFF",
          fillOpacity: 0.2,
          zIndex: 10,
        }),
      );
    }
  }, [ready, zones, path, tracing]);

  const startTracing = useCallback((zoneId: Ulid) => {
    setTracing(zoneId);
    setPath([]);
  }, []);

  const stopTracing = useCallback(() => {
    setTracing(undefined);
    setPath([]);
  }, []);

  const undoPoint = useCallback(() => {
    setPath((current) => current.slice(0, -1));
  }, []);

  const saveBoundary = useCallback(async () => {
    if (tracing === undefined || !isTraceable(path)) return;
    setSaving(true);

    try {
      const outcome = await api.update(tracing, { boundary: path });
      if (outcome.ok) {
        show({ tone: "success", message: `Boundary saved — ${path.length} corners.` });
        stopTracing();
      } else {
        setError("That boundary would not save.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That boundary would not save.");
    } finally {
      setSaving(false);
    }
  }, [api, path, show, stopTracing, tracing]);

  const columns = useMemo<Column<Zone>[]>(
    () => [
      {
        key: "name",
        header: "Zone",
        primary: true,
        render: (zone) => describeZoneExtent(zone),
      },
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
          tracing === zone.id ? (
            <Button variant="ghost" onClick={stopTracing}>
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => startTracing(zone.id)} disabled={!ready}>
              {zone.boundary === undefined ? "Draw" : "Redraw"}
            </Button>
          ),
      },
    ],
    [ready, startTracing, stopTracing, tracing],
  );

  const noKey = mapsApiKey() === undefined;
  const noCoordinates = view === undefined;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Today"
        title="Property map"
        subtitle="Pens traced over aerial imagery. Boundaries are stored as real coordinates, so the same shapes render on a barn screen with no signal."
        meta={
          <Pill tone="neutral">
            {zones.filter((zone) => (zone.boundary?.length ?? 0) >= 3).length} of {zones.length}{" "}
            drawn
          </Pill>
        }
      />

      {noKey ? (
        <Callout tone="danger" title="The aerial view is not connected">
          {mapsNotConfigured()}
        </Callout>
      ) : null}

      {error === undefined ? null : (
        <Callout tone="danger" title="The map could not be shown">
          {error}
        </Callout>
      )}

      {noCoordinates && !noKey ? (
        <Callout tone="neutral" title="Nothing to centre on yet">
          This farm has no coordinates and no pens drawn, so there is nowhere to open the map. Look
          the address up under Settings → Property first — it drops a pin on the house, and the map
          opens there.
        </Callout>
      ) : null}

      <Section
        title="Aerial view"
        description={
          tracing === undefined ? "Pick a zone below to draw its boundary." : traceHint(path)
        }
        actions={
          tracing === undefined ? undefined : (
            <span className="flex gap-2">
              <Button variant="ghost" onClick={undoPoint} disabled={path.length === 0 || saving}>
                Undo corner
              </Button>
              <Button variant="ghost" onClick={stopTracing} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void saveBoundary()} disabled={!isTraceable(path) || saving}>
                {saving ? "Saving…" : "Save boundary"}
              </Button>
            </span>
          )
        }
      >
        <Card>
          <div
            ref={host}
            aria-label="Aerial view of the property"
            className="h-[32rem] w-full rounded-density bg-raised"
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
    </PageBody>
  );
}
