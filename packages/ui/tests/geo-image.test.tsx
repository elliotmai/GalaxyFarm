import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GeoImage } from "../src/spatial-editor/geo-image.js";
import { project, type Viewport } from "../src/spatial-editor/geometry.js";

/**
 * The owned aerial (spec §8, issue #8).
 *
 * This is the background a barn kiosk uses with no signal, and the only one
 * that may be stored at all — Google's terms do not permit keeping its tiles,
 * which is the entire reason a NAIP snapshot exists. What has to be right is
 * the georeference: the image goes exactly where its bounds say and nowhere
 * else, because pens drawn over a photograph placed by guesswork look
 * perfectly convincing and are wrong.
 */

const BOUNDS = { south: 32.73, west: -97.412, north: 32.742, east: -97.4 };

const view: Viewport = {
  centre: { lat: 32.736, lng: -97.406 },
  zoom: 17,
  width: 800,
  height: 600,
};

const IMAGERY = { url: "https://imagery.example.com/naip-2024.jpg", bounds: BOUNDS };

function draw(props: Parameters<typeof GeoImage>[0]) {
  const { container } = render(<svg>{GeoImage(props)}</svg>);
  return container.querySelector("image");
}

describe("GeoImage", () => {
  it("puts its corners exactly where the coordinates say", () => {
    const drawn = draw({ imagery: IMAGERY, view });

    const northWest = project({ lat: BOUNDS.north, lng: BOUNDS.west }, view);
    const southEast = project({ lat: BOUNDS.south, lng: BOUNDS.east }, view);

    expect(Number(drawn?.getAttribute("x"))).toBeCloseTo(northWest.x, 6);
    expect(Number(drawn?.getAttribute("y"))).toBeCloseTo(northWest.y, 6);
    expect(Number(drawn?.getAttribute("width"))).toBeCloseTo(southEast.x - northWest.x, 6);
    expect(Number(drawn?.getAttribute("height"))).toBeCloseTo(southEast.y - northWest.y, 6);
  });

  it("does not letterbox itself inside those bounds", () => {
    // Preserving the aspect ratio would centre the pixels in the box and leave
    // the ground somewhere other than the coordinates that placed it — which
    // is the one thing this component exists to get right.
    expect(draw({ imagery: IMAGERY, view })?.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("moves and scales with the view, since the shapes over it do", () => {
    const near = draw({ imagery: IMAGERY, view });
    const far = draw({ imagery: IMAGERY, view: { ...view, zoom: 18 } });

    expect(Number(far?.getAttribute("width"))).toBeCloseTo(
      Number(near?.getAttribute("width")) * 2,
      4,
    );
  });

  it("draws nothing at all for a georeference typed the wrong way round", () => {
    // North and south swapped. An inside-out rectangle is a file the browser
    // would decode for an element nobody can see.
    expect(
      draw({
        imagery: { ...IMAGERY, bounds: { ...BOUNDS, north: BOUNDS.south, south: BOUNDS.north } },
        view,
      }),
    ).toBeNull();
  });

  it("takes an opacity, for laying it under something else", () => {
    expect(draw({ imagery: IMAGERY, view, opacity: 0.5 })?.getAttribute("opacity")).toBe("0.5");
  });
});
