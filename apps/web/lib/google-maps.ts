/**
 * The Google Maps satellite layer (spec §8).
 *
 * Pens are stored as real lat/lng polygons, never as screen coordinates, and
 * that is the whole design: the same boundary renders over Google's imagery
 * online and over an owned NAIP snapshot on a barn kiosk with no signal.
 * Nothing about a zone knows which background it is being drawn on.
 *
 * ## Why the key is public, and why that is fine
 *
 * `NEXT_PUBLIC_` puts it in the bundle, because the Maps JavaScript API runs
 * in the browser and there is nowhere else for it to be. What protects it is
 * an HTTP-referrer restriction set on the key in the Google Cloud console, not
 * secrecy — a browser key is meant to be read. It is the one credential in this
 * app that is deliberately not hidden, and it must never be given any API that
 * bills per call without that restriction in place.
 *
 * ## Loaded once
 *
 * The API installs a global. Two scripts on one page is a console error and a
 * second billed map load, so the promise is memoised and every caller waits on
 * the same one.
 */

/** The library the editor needs beyond the base map. */
const LIBRARIES = ["geometry"] as const;

export function mapsApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"];
  return key === undefined || key.trim() === "" ? undefined : key.trim();
}

/**
 * Whether the aerial view can load at all.
 *
 * Not being configured is a real state rather than a fault, exactly as with the
 * association catalogue: the map is one screen, and a farm with no key still
 * has every record it ever had. What it must not do is fail silently — a blank
 * grey rectangle reads as a broken app rather than as an unset variable.
 */
export function mapsNotConfigured(): string {
  return (
    "The aerial view is not connected on this server. Set " +
    "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to a browser key from Google Cloud, " +
    "restricted to this site's address, and restart. Pens can still be given " +
    "coordinates by hand without it."
  );
}

export function mapsScriptUrl(key: string): string {
  const query = new URLSearchParams({
    key,
    libraries: LIBRARIES.join(","),
    // Pinned rather than tracking whatever "weekly" happens to be, so a Google
    // release cannot change how the map behaves between two mornings.
    v: "3.58",
  });
  return `https://maps.googleapis.com/maps/api/js?${query.toString()}`;
}

/** Set once the script resolves, so a second mount does not load it again. */
let loading: Promise<void> | undefined;

/**
 * Load the API, or say why it cannot be.
 *
 * Rejects rather than resolving to a broken map: the caller shows the reason,
 * and "it did not load" with no explanation is the failure this is written to
 * avoid.
 */
export async function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") throw new Error("The map only loads in a browser.");

  const key = mapsApiKey();
  if (key === undefined) throw new Error(mapsNotConfigured());

  // Already there — a hot reload, or a second screen mounting.
  if ((window as { google?: { maps?: unknown } }).google?.maps !== undefined) return;

  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = mapsScriptUrl(key);
    script.async = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      // Let the next attempt try again. A key rejected once because the
      // referrer restriction was still propagating should not leave the screen
      // permanently broken until a reload.
      loading = undefined;
      reject(
        new Error(
          "Google Maps would not load. The usual cause is the key's website " +
            "restriction not listing this address, or billing not being enabled " +
            "on the Google Cloud project.",
        ),
      );
    });
    document.head.append(script);
  });

  return loading;
}
