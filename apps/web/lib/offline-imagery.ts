import type { Property } from "@galaxy-farm/core";
import type { SpatialImagery } from "@galaxy-farm/ui";

/**
 * The background the map falls back to with no signal (spec §8).
 *
 * Online, the editor traces over Google's satellite layer. Google's terms do
 * not permit storing those tiles, and that single sentence is the whole reason
 * this file exists: the background a barn kiosk uses is an owned one — a USDA
 * NAIP aerial of the property, public domain, roughly half-metre resolution,
 * downloaded once from EarthExplorer, reprojected to Web Mercator, and put in
 * R2. The pens over it are the same lat/lng rings drawn over Google, because
 * they were never stored in pixels.
 *
 * ## Why a plain URL rather than a presigned one
 *
 * Everything else in R2 here is private and reached through a presigned URL.
 * This one object is not, for two reasons that both point the same way. It is
 * **public-domain imagery** — there is nothing to protect, and a signature
 * would be guarding a photograph the USDA gives away. And a presigned URL
 * **expires**, which makes it exactly the wrong thing to hand a service
 * worker: the point of caching this image is that it is still there in a barn
 * with no signal next February, and a cache entry keyed on a URL that stopped
 * working in December is a blank map on the one day it was needed.
 *
 * So the bucket serves this prefix over a public custom domain and the base
 * lives in `NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL`. Nothing else in the app
 * reads it.
 */

export function offlineImageryBase(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const base = env["NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL"];
  if (base === undefined || base.trim() === "") return undefined;
  return base.trim().replace(/\/+$/, "");
}

/**
 * The cached aerial, if this property has one that can actually be drawn.
 *
 * All three parts are required and none of them can be guessed. Without the
 * key there is no file; without the bounds there is no georeference, and an
 * aerial photograph without its extent is a picture rather than a map; without
 * the base URL there is nowhere to fetch it from. Half a georeference would
 * place the pens somewhere plausible-looking and wrong, which is worse than
 * placing them over nothing.
 */
export function offlineImagery(
  property: Pick<Property, "offlineImageryKey" | "offlineImageryBounds">,
  env: Record<string, string | undefined> = process.env,
): SpatialImagery | undefined {
  const base = offlineImageryBase(env);
  const key = property.offlineImageryKey;
  const bounds = property.offlineImageryBounds;

  if (base === undefined || key === undefined || key.trim() === "" || bounds === undefined) {
    return undefined;
  }

  return {
    url: `${base}/${key.replace(/^\/+/, "")}`,
    bounds,
    // Public domain, and said out loud anyway: whoever looks at this screen in
    // five years should be able to tell at a glance which of the two
    // backgrounds they are looking at, and why one of them is allowed offline.
    attribution: "USDA NAIP · public domain",
  };
}

/**
 * What is missing, in the words of whoever would have to fix it.
 *
 * Three different people fix these three things — one sources an image, one
 * types a rectangle into settings, one sets an environment variable on the
 * deploy — and "the offline map does not work" tells none of them which they
 * are. Undefined when nothing is missing.
 */
export function offlineImageryGap(
  property: Pick<Property, "offlineImageryKey" | "offlineImageryBounds">,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const missing: string[] = [];

  if (property.offlineImageryKey === undefined || property.offlineImageryKey.trim() === "") {
    missing.push(
      "no aerial has been stored for this property (a USDA NAIP tile, reprojected to Web Mercator and uploaded to R2)",
    );
  }
  if (property.offlineImageryBounds === undefined) {
    missing.push("the ground that image covers has not been recorded under Settings → Property");
  }
  if (offlineImageryBase(env) === undefined) {
    missing.push("NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL is not set on this server");
  }

  if (missing.length === 0) return undefined;
  return `The map needs the network here: ${missing.join("; ")}.`;
}
