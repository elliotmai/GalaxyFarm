"use client";

import { useEffect, useRef } from "react";

import type { SpatialView } from "@galaxy-farm/ui";

import { loadGoogleMaps } from "@/lib/google-maps";
import { mapsNamespace, type MapsMap } from "@/lib/google-maps-api";

/**
 * Google's satellite tiles, as a passive background (spec §8).
 *
 * The editor above owns the view — where it is centred, how far in — and this
 * follows it. That is the opposite of how the old map screen worked, and the
 * inversion is the point: Google was the map and the pens were drawn into it,
 * so nothing about a pen could be shown without Google, and the offline
 * background could never be the same code path. Now the pens are the map, this
 * is a photograph behind them, and the barn kiosk swaps the photograph for one
 * of ours (`GeoImage`) without the editor noticing.
 *
 * **The tiles are never stored.** Their terms do not permit it, which is the
 * entire reason the NAIP fallback exists. This component renders them live,
 * caches nothing, and is simply absent when there is no signal.
 *
 * ## Why every gesture is turned off
 *
 * Two things that both pan would fight each other, and the one on top would
 * win by accident of stacking rather than by design. So the map takes no
 * input at all — no gestures, no keyboard, no clickable places of interest —
 * and the editor's own panning drives it. The container takes no pointer
 * events either, so a click meant for a pen corner is never swallowed by a
 * restaurant label.
 */
export function GoogleSatelliteLayer({
  view,
  onFailure,
}: {
  readonly view: SpatialView;
  /** Called with a sentence a person can act on. The screen shows it. */
  readonly onFailure?: (reason: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapsMap | undefined>(undefined);

  // Read through a ref so the map is created once, at whatever the view is
  // then. A dependency on the view would build a second map — and bill a
  // second load — every time somebody nudged the pan.
  const latest = useRef(view);
  latest.current = view;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await loadGoogleMaps();
        if (cancelled) return;

        const maps = mapsNamespace();
        if (maps === undefined || host.current === null) return;

        map.current = new maps.Map(host.current, {
          center: latest.current.centre,
          zoom: Math.round(latest.current.zoom),
          // Hybrid rather than plain satellite: the road and the county-road
          // label are how somebody orients themselves before the pens exist.
          mapTypeId: "hybrid",
          // Straight down. The 45° view is prettier and useless for tracing —
          // a fence line at a tilt does not sit where it is clicked.
          tilt: 0,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
          clickableIcons: false,
        });
      } catch (caught) {
        if (cancelled) return;
        onFailure?.(caught instanceof Error ? caught.message : "The aerial view would not load.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately once, with no dependencies. Re-running would build a second
    // map over the first and bill a second load; `onFailure` is left out for
    // the same reason the view is.
  }, []);

  /**
   * Follow the editor.
   *
   * Whole zoom levels, because these are raster tiles: at a fractional zoom
   * Google resamples the photograph and the fence lines go soft, which is
   * exactly the detail somebody is tracing against.
   */
  useEffect(() => {
    map.current?.setCenter(view.centre);
    map.current?.setZoom(Math.round(view.zoom));
  }, [view.centre, view.zoom]);

  return <div ref={host} className="h-full w-full" style={{ pointerEvents: "none" }} />;
}
