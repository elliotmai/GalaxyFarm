import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeoPoint } from "@galaxy-farm/core";

import { SpatialEditor } from "../src/spatial-editor/spatial-editor.js";
import { gardenPalette, propertyPalette } from "../src/spatial-editor/palette.js";
import { project, unproject, type Viewport } from "../src/spatial-editor/geometry.js";
import type { SpatialChip, SpatialShape } from "../src/spatial-editor/types.js";

/**
 * The editor itself (issue #8, spec §2 and §8).
 *
 * What is worth asserting here is what a screen would otherwise have to
 * discover in a barn. Corners come back as **coordinates**, never as the
 * pixels they were clicked at — that is the constraint the whole hybrid
 * imagery design rests on, and nothing on screen would show it had been
 * broken. Resting ground is hatched rather than merely dimmed. And the same
 * component, handed a garden palette, is a garden designer: the last test is
 * what makes §2's "one component, two palettes" a fact about this code rather
 * than an intention.
 */

const FARM: GeoPoint = { lat: 32.7357, lng: -97.4089 };
const PANEL = { width: 800, height: 600 };

/** The panel, as the editor measures it. jsdom lays nothing out on its own. */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: PANEL.width,
    bottom: PANEL.height,
    width: PANEL.width,
    height: PANEL.height,
    toJSON: () => ({}),
  } as DOMRect);
});

const VIEW = { centre: FARM, zoom: 18 };
const viewport: Viewport = { ...VIEW, ...PANEL };

/** A square of ground around a point, big enough to drop a chip into. */
function square(at: GeoPoint, size = 0.0008): GeoPoint[] {
  return [
    { lat: at.lat + size, lng: at.lng - size },
    { lat: at.lat + size, lng: at.lng + size },
    { lat: at.lat - size, lng: at.lng + size },
    { lat: at.lat - size, lng: at.lng - size },
  ];
}

const NORTH_TRAP: SpatialShape = {
  id: "north",
  label: "North Trap",
  boundary: square({ lat: FARM.lat + 0.002, lng: FARM.lng }),
  rank: 2,
  instructions: [{ from: "North Trap", text: "Gate chains on the south end." }],
};

const PASTURE: SpatialShape = {
  id: "pasture",
  label: "Pasture",
  boundary: square({ lat: FARM.lat - 0.002, lng: FARM.lng }),
  rank: 1,
  resting: true,
  sublabel: "part of it only, shut out of the creek",
};

const DOLLY: SpatialChip = {
  id: "dolly",
  label: "Dolly",
  shapeId: "north",
  rank: 4,
  accent: "#C62828",
  accentLabel: "Red",
  rankNote: "Kicks when cornered.",
  instructions: [
    { from: "Dolly", text: "Hand feed only. She will crowd a gate." },
    { from: "North Trap", text: "Gate chains on the south end." },
    { from: "North", text: "The road gate stays chained." },
  ],
};

/** The middle of a shape, in panel pixels — where its chips and label sit. */
function middleOf(shape: SpatialShape): { x: number; y: number } {
  const ring = shape.boundary as GeoPoint[];
  return project(
    {
      lat: ((ring[0]?.lat ?? 0) + (ring[2]?.lat ?? 0)) / 2,
      lng: ((ring[0]?.lng ?? 0) + (ring[1]?.lng ?? 0)) / 2,
    },
    viewport,
  );
}

function drag(element: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(element, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe("drawing a boundary", () => {
  it("hands back the coordinate that was clicked, never the pixel", () => {
    // The constraint the whole design rests on (§8): a boundary stored in
    // screen coordinates renders over exactly one background at exactly one
    // zoom, and the offline NAIP path would have to redraw every pen.
    const onDraftChange = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[{ id: "new", label: "New pen" }]}
        view={VIEW}
        draft={{ shapeId: "new", boundary: [] }}
        onDraftChange={onDraftChange}
      />,
    );

    const canvas = screen.getByRole("application");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 400, clientY: 300 });

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const [corner] = (onDraftChange.mock.calls[0]?.[0]?.boundary ?? []) as GeoPoint[];

    // The middle of the panel is the middle of the view, by definition.
    expect(corner?.lat).toBeCloseTo(FARM.lat, 9);
    expect(corner?.lng).toBeCloseTo(FARM.lng, 9);
  });

  it("moves the corner a handle is dragged to, and leaves the others alone", () => {
    const boundary = square(FARM);
    const onDraftChange = vi.fn();

    const { container } = render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[{ id: "new", label: "New pen" }]}
        view={VIEW}
        draft={{ shapeId: "new", boundary }}
        onDraftChange={onDraftChange}
      />,
    );

    const handles = container.querySelectorAll("circle");
    expect(handles).toHaveLength(4);

    const first = project(boundary[0] as GeoPoint, viewport);
    drag(handles[0] as Element, first, { x: first.x + 40, y: first.y });

    const next = onDraftChange.mock.calls.at(-1)?.[0]?.boundary as GeoPoint[];
    expect(next[0]?.lng).toBeCloseTo(unproject({ x: first.x + 40, y: first.y }, viewport).lng, 9);
    expect(next[1]).toEqual(boundary[1]);
  });

  it("puts a corner on the grid when snapping is on", () => {
    const onDraftChange = vi.fn();
    const grid = { metres: 5, anchor: FARM };

    render(
      <SpatialEditor
        palette={gardenPalette}
        shapes={[{ id: "bed", label: "Bed 1" }]}
        view={VIEW}
        grid={grid}
        draft={{ shapeId: "bed", boundary: [] }}
        onDraftChange={onDraftChange}
      />,
    );

    // A click a couple of pixels off the anchor, which at zoom 18 is well
    // under one grid square.
    const canvas = screen.getByRole("application");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 402, clientY: 301 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 402, clientY: 301 });

    const [corner] = (onDraftChange.mock.calls[0]?.[0]?.boundary ?? []) as GeoPoint[];
    expect(corner?.lat).toBeCloseTo(FARM.lat, 9);
    expect(corner?.lng).toBeCloseTo(FARM.lng, 9);
  });

  it("says how many corners are down and how many more it needs", () => {
    const { rerender } = render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[{ id: "new", label: "New pen" }]}
        view={VIEW}
        draft={{ shapeId: "new", boundary: [] }}
      />,
    );
    expect(screen.getByText(/Three is the fewest/)).toBeInTheDocument();

    rerender(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[{ id: "new", label: "New pen" }]}
        view={VIEW}
        draft={{ shapeId: "new", boundary: [FARM, FARM] }}
      />,
    );
    expect(screen.getByText(/at least 1 more/)).toBeInTheDocument();
  });
});

describe("chips", () => {
  it("stands them in the shape they belong to and reassigns a dragged one", () => {
    const onReassign = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP, PASTURE]}
        chips={[DOLLY]}
        view={VIEW}
        onReassign={onReassign}
      />,
    );

    const chip = screen.getByRole("button", { name: /Dolly/ });
    drag(chip, middleOf(NORTH_TRAP), middleOf(PASTURE));

    expect(onReassign).toHaveBeenCalledWith({
      chipId: "dolly",
      fromShapeId: "north",
      toShapeId: "pasture",
    });
  });

  it("leaves a chip where it was when it is dropped on nothing", () => {
    const onReassign = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP, PASTURE]}
        chips={[DOLLY]}
        view={VIEW}
        onReassign={onReassign}
      />,
    );

    drag(screen.getByRole("button", { name: /Dolly/ }), middleOf(NORTH_TRAP), { x: 10, y: 590 });

    expect(onReassign).not.toHaveBeenCalled();
  });

  it("refuses ground that holds nothing", () => {
    // An area groups pens; a working facility holds cattle under handling.
    // Nothing lives in either, so a drag that ends there must write nothing.
    const onReassign = vi.fn();
    const yard: SpatialShape = {
      id: "yard",
      label: "Working pens",
      boundary: square({ lat: FARM.lat - 0.002, lng: FARM.lng }),
      acceptsChips: false,
    };

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP, yard]}
        chips={[DOLLY]}
        view={VIEW}
        onReassign={onReassign}
      />,
    );

    drag(screen.getByRole("button", { name: /Dolly/ }), middleOf(NORTH_TRAP), middleOf(yard));

    expect(onReassign).not.toHaveBeenCalled();
  });

  it("moves one by tapping, which is the only route a keyboard has", () => {
    // A pointer drag is unreachable without a pointer, and the barn's
    // touchscreen already moves animals by tapping twice (#19). Same
    // reassignment, both ways in.
    const onReassign = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP, PASTURE]}
        chips={[DOLLY]}
        view={VIEW}
        onReassign={onReassign}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Dolly/ }));
    expect(screen.getByText(/Choose a zone to move Dolly there/)).toBeInTheDocument();

    // Every shape now offers itself as the destination, by name.
    fireEvent.click(screen.getByRole("button", { name: "Move Dolly to Pasture" }));

    expect(onReassign).toHaveBeenCalledWith({
      chipId: "dolly",
      fromShapeId: "north",
      toShapeId: "pasture",
    });
  });

  it("collects the ones with nowhere on the map to stand", async () => {
    // A zone nobody has traced, or somewhere off the property entirely. An
    // animal missing from the map is indistinguishable from an animal missing.
    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP, { id: "collection", label: "Collection facility" }]}
        chips={[DOLLY, { id: "bull", label: "Ranger", shapeId: "collection" }]}
        view={VIEW}
      />,
    );

    expect(screen.getByText("Not on the map (1):")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Ranger/ }));
    expect(screen.getByRole("heading", { name: "Ranger" })).toBeInTheDocument();
  });
});

describe("tapping for instructions", () => {
  it("reads out a zone's, and says plainly when there are none", async () => {
    render(<SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP, PASTURE]} view={VIEW} />);

    await userEvent.click(screen.getByRole("button", { name: /^North Trap/ }));
    expect(screen.getByText(/Gate chains on the south end/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Pasture/ }));
    expect(screen.getByText("No instructions recorded for this zone.")).toBeInTheDocument();
  });

  it("reads out an animal's, halter and all", async () => {
    render(
      <SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP]} chips={[DOLLY]} view={VIEW} />,
    );

    // The halter colour is named as well as drawn: two calves in navy and
    // black are the same chip in a dark barn.
    await userEvent.click(screen.getByRole("button", { name: /Dolly, Red halter/ }));
    expect(screen.getByText(/She will crowd a gate/)).toBeInTheDocument();
  });

  it("names the safety level in the label, not only in the colour", () => {
    render(<SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP]} view={VIEW} />);

    expect(
      screen.getByRole("button", { name: /Safety level 2 — Safe with basic caution/ }),
    ).toBeInTheDocument();
  });

  it("keeps every merged line attributed to what it came from", async () => {
    // The whole point of merging three levels into one panel: a helper reading
    // "hand feed only" has to know whether that is true of this cow or of
    // everything standing in the trap.
    render(
      <SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP]} chips={[DOLLY]} view={VIEW} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Dolly, Red halter/ }));

    for (const [from, text] of [
      ["Dolly", "Hand feed only. She will crowd a gate."],
      ["North Trap", "Gate chains on the south end."],
      ["North", "The road gate stays chained."],
    ]) {
      const term = screen.getByText(from as string, { selector: "dt" });
      expect(term.nextElementSibling).toHaveTextContent(text as string);
    }
  });

  it("reads the level out as a number beside its colour, and says what made it that", async () => {
    // §5.1: the colour is the fast path, never the only one. A swatch on its
    // own is nothing to a colour-blind reader and nothing to anybody at dusk.
    render(
      <SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP]} chips={[DOLLY]} view={VIEW} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Dolly, Red halter/ }));
    expect(screen.getByText(/Safety level 4 —/)).toBeInTheDocument();
    expect(screen.getByText(/Kicks when cornered/)).toBeInTheDocument();
  });
});

describe("resting ground", () => {
  it("hatches it as well as dimming it, and says so", () => {
    // Dimming alone is a difference in degree. A pasture being rested is a
    // difference in kind — it is the state a move into it is challenged for.
    const { container } = render(
      <SpatialEditor palette={propertyPalette} shapes={[PASTURE]} view={VIEW} />,
    );

    expect(screen.getByRole("button", { name: /Pasture.*resting/ })).toBeInTheDocument();
    expect(container.querySelector("pattern")).toBeInTheDocument();
    expect(container.innerHTML).toContain("url(#");
  });
});

describe("the view", () => {
  it("opens on everything drawn when nobody has said where to look", () => {
    render(<SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP, PASTURE]} />);

    // Both pens are on screen, which is what a fit means.
    expect(screen.getByRole("button", { name: /^North Trap/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pasture/ })).toBeInTheDocument();
  });

  it("says there is nowhere to open when nothing has coordinates", () => {
    render(<SpatialEditor palette={propertyPalette} shapes={[{ id: "pen", label: "Pen" }]} />);

    expect(screen.getByText(/Nothing is drawn yet/)).toBeInTheDocument();
  });

  it("reports every move, so a background can follow it", async () => {
    // The Google satellite layer is a passive backdrop driven by this. If the
    // editor kept a move to itself the shapes would slide off the imagery.
    const onViewChange = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP]}
        view={VIEW}
        onViewChange={onViewChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onViewChange).toHaveBeenLastCalledWith({ centre: FARM, zoom: 19 });

    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onViewChange).toHaveBeenLastCalledWith({ centre: FARM, zoom: 17 });

    const canvas = screen.getByRole("application");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 460, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 460, clientY: 300 });

    expect(onViewChange.mock.calls.at(-1)?.[0]?.centre.lng).toBeLessThan(FARM.lng);
  });

  it("keeps the ground under the pointer still while the wheel zooms", () => {
    const onViewChange = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP]}
        view={VIEW}
        onViewChange={onViewChange}
      />,
    );

    fireEvent.wheel(screen.getByRole("application"), { deltaY: -100, clientX: 600, clientY: 200 });

    const next = onViewChange.mock.calls.at(-1)?.[0] as { centre: GeoPoint; zoom: number };
    expect(next.zoom).toBe(19);
    expect(project(unproject({ x: 600, y: 200 }, viewport), { ...next, ...PANEL }).x).toBeCloseTo(
      600,
      3,
    );
  });
});

describe("the garden palette", () => {
  it("is the same component saying bed and planting", async () => {
    // §2: "the property map and the garden layout designer are the same SVG
    // editor with different palettes". Nothing below was written for a garden;
    // it is the property mode's code reading a different palette.
    const bed: SpatialShape = {
      id: "bed-1",
      label: "Bed 1",
      boundary: square(FARM, 0.0002),
      rank: 3,
      instructions: [
        { from: "Bed 3", text: "Tomatoes here last year — nightshades are out until 2029." },
      ],
    };

    render(
      <SpatialEditor
        palette={gardenPalette}
        shapes={[bed, { ...PASTURE, id: "bed-2", label: "Bed 2" }]}
        chips={[{ id: "okra", label: "Okra", shapeId: "bed-1" }]}
        view={VIEW}
        grid={{ metres: 0.5, anchor: FARM }}
      />,
    );

    expect(screen.getByText(/Tap a bed or a planting for its instructions/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Bed 1/ }));
    expect(screen.getByText(/1 planting/)).toBeInTheDocument();
    expect(screen.getByText(/nightshades are out until 2029/)).toBeInTheDocument();

    // Fallow, not resting — the same flag, the palette's own word for it.
    await userEvent.click(screen.getByRole("button", { name: /^Bed 2/ }));
    expect(screen.getByText(/Fallow/)).toBeInTheDocument();

    // Snapping is on by default in a garden and off on a property, because a
    // bed is built to a tape measure and a fence is where the posts are.
    expect(screen.getByRole("button", { name: "Turn grid snap off" })).toBeInTheDocument();
  });
});

describe("a property with a pin and nothing traced", () => {
  it("opens on the fallback rather than saying there is nowhere to look", () => {
    // The first visit: the address has been looked up, so there is a pin on
    // the house, and no pen has been drawn yet. Refusing to open the map at
    // that point is correct and unhelpful.
    const onViewChange = vi.fn();

    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[{ id: "pen", label: "North Trap" }]}
        fallbackCentre={FARM}
        onViewChange={onViewChange}
      />,
    );

    expect(screen.queryByText(/Nothing is drawn yet/)).not.toBeInTheDocument();

    // And a corner clicked in the middle of the panel lands on the pin.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onViewChange).toHaveBeenLastCalledWith({ centre: FARM, zoom: 19 });
  });
});

describe("reaching a shape without a pointer", () => {
  it("chooses one on Enter, the same as a tap", () => {
    render(<SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP]} view={VIEW} />);

    const trap = screen.getByRole("button", { name: /^North Trap/ });
    fireEvent.keyDown(trap, { key: "Enter" });

    expect(screen.getByText(/Gate chains on the south end/)).toBeInTheDocument();
  });

  it("ignores keys that are not the two that activate a button", () => {
    render(<SpatialEditor palette={propertyPalette} shapes={[NORTH_TRAP]} view={VIEW} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /^North Trap/ }), { key: "a" });

    expect(screen.getByText(/Tap a zone or an animal/)).toBeInTheDocument();
  });

  it("stops offering shapes as buttons while a boundary is being traced", () => {
    // A click inside an existing pen while tracing is a new corner, not a
    // request to read that pen's instructions. Leaving it focusable would put
    // a control in the tab order that does nothing.
    render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[NORTH_TRAP]}
        view={VIEW}
        draft={{ shapeId: NORTH_TRAP.id, boundary: [] }}
      />,
    );

    expect(screen.queryByRole("button", { name: /^North Trap/ })).not.toBeInTheDocument();
  });
});

describe("temporary fencing", () => {
  it("draws a fence that is standing solid and one that is down dashed", () => {
    // The convention off the hand-sketched map, which somebody reads without
    // being told. Backwards would be worse than not drawing it at all: the
    // question the line answers is whether the cattle can get to the far end.
    const line = [
      { lat: FARM.lat + 0.002, lng: FARM.lng - 0.0008 },
      { lat: FARM.lat + 0.002, lng: FARM.lng + 0.0008 },
    ];

    const { container } = render(
      <SpatialEditor
        palette={propertyPalette}
        shapes={[
          { ...NORTH_TRAP, lines: [{ id: "up", label: "Cross fence", points: line }] },
          {
            ...PASTURE,
            resting: false,
            lines: [{ id: "down", label: "Cross fence", points: line, dashed: true }],
          },
        ]}
        view={VIEW}
      />,
    );

    const dashed = Array.from(container.querySelectorAll("path[stroke-dasharray]"));
    expect(dashed).toHaveLength(1);
    expect(dashed[0]?.getAttribute("stroke-width")).toBe("2");
  });
});
