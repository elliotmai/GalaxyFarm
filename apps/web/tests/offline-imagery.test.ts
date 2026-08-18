import { describe, expect, it } from "vitest";

import { offlineImagery, offlineImageryBase, offlineImageryGap } from "@/lib/offline-imagery";

/**
 * The offline background (spec §8, issue #8).
 *
 * The rule underneath every case here: an aerial photograph without its extent
 * is a picture, not a map. Three separate things have to be present before one
 * can be drawn, and a missing one has to produce *no* background rather than a
 * background placed by guesswork — pens drawn over an image that is somewhere
 * plausible and wrong is the failure nobody would notice from the screen.
 */

const BOUNDS = { south: 32.73, west: -97.412, north: 32.742, east: -97.4 };
const ENV = { NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL: "https://imagery.example.com/" };

describe("offlineImagery", () => {
  it("builds the URL from the base and the key, however either was punctuated", () => {
    const imagery = offlineImagery(
      { offlineImageryKey: "/property/01/naip-2024.jpg", offlineImageryBounds: BOUNDS },
      ENV,
    );

    expect(imagery?.url).toBe("https://imagery.example.com/property/01/naip-2024.jpg");
    expect(imagery?.bounds).toEqual(BOUNDS);
    expect(imagery?.attribution).toContain("NAIP");
  });

  it("draws nothing when the georeference is missing", () => {
    // The key alone is an image nobody can place.
    expect(offlineImagery({ offlineImageryKey: "naip.jpg" }, ENV)).toBeUndefined();
  });

  it("draws nothing when there is no image, or nowhere to fetch it from", () => {
    expect(offlineImagery({ offlineImageryBounds: BOUNDS }, ENV)).toBeUndefined();
    expect(
      offlineImagery({ offlineImageryKey: "  ", offlineImageryBounds: BOUNDS }, ENV),
    ).toBeUndefined();
    expect(
      offlineImagery({ offlineImageryKey: "naip.jpg", offlineImageryBounds: BOUNDS }, {}),
    ).toBeUndefined();
  });

  it("reads the base URL, and treats blank as unset", () => {
    expect(offlineImageryBase(ENV)).toBe("https://imagery.example.com");
    expect(offlineImageryBase({ NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL: "   " })).toBeUndefined();
    expect(offlineImageryBase({})).toBeUndefined();
  });
});

describe("offlineImageryGap", () => {
  it("says which of the three things is missing, since three people fix them", () => {
    const gap = offlineImageryGap({ offlineImageryKey: "naip.jpg" }, ENV);

    expect(gap).toContain("the ground that image covers");
    expect(gap).not.toContain("NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL");
  });

  it("lists all of them when none of it has been done", () => {
    const gap = offlineImageryGap({}, {});

    expect(gap).toContain("USDA NAIP");
    expect(gap).toContain("Settings → Property");
    expect(gap).toContain("NEXT_PUBLIC_OFFLINE_IMAGERY_BASE_URL");
  });

  it("says nothing when the map will work with no signal", () => {
    expect(
      offlineImageryGap({ offlineImageryKey: "naip.jpg", offlineImageryBounds: BOUNDS }, ENV),
    ).toBeUndefined();
  });
});
