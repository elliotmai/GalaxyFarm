import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CrudError, Divider, Ulid, WaterSource, Zone } from "@galaxy-farm/core";

import {
  BLANK_FENCE,
  draftFromFence,
  fenceErrors,
  fenceFromDraft,
  withFence,
  withFenceToggled,
  withoutFence,
} from "../app/(admin)/admin/map/_components/fences.js";
import { FenceEditor, ZoneMapPanel } from "../app/(admin)/admin/map/_components/zone-map-panel.js";

/**
 * The property map's own records (spec §8): a zone's boundary and the
 * temporary fencing across it.
 *
 * Fences live inside their zone, so every create, edit, toggle and delete is
 * one write of the zone's whole list. The list arithmetic is pinned here, and
 * so is the panel every zone row on the map now opens — the record's own
 * place to be seen, changed and removed.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const NOW = new Date("2026-10-15T12:00:00Z");
const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

const WIRE: Divider = {
  id: "wire-1",
  name: "Creek wire",
  line: [
    { lat: 36.1, lng: -95.9 },
    { lat: 36.101, lng: -95.899 },
  ],
  up: true,
  waterSourceIds: [id(10)],
  closes: "the creek bottom",
};

const PASTURE: Zone = {
  id: id(1),
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  name: "Pasture",
  type: "pasture",
  indoor: false,
  baselineSafetyLevel: 2,
  waterSourceIds: [id(10)],
  resting: false,
  active: true,
  boundary: [
    { lat: 36.1, lng: -95.9 },
    { lat: 36.1, lng: -95.89 },
    { lat: 36.11, lng: -95.89 },
  ],
  dividers: [WIRE],
} as Zone;

const TANK: WaterSource = {
  id: id(10),
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  name: "Pasture tank",
  type: "static_tank",
  hasHeater: false,
  cover: "none",
  active: true,
} as WaterSource;

describe("fence list arithmetic", () => {
  it("adds a new fence and replaces an edited one in place", () => {
    const added = withFence(PASTURE, { ...WIRE, id: "wire-2", name: "Top wire" });
    expect(added.map((fence) => fence.name)).toEqual(["Creek wire", "Top wire"]);

    const edited = withFence(PASTURE, { ...WIRE, name: "Lower wire" });
    expect(edited.map((fence) => fence.name)).toEqual(["Lower wire"]);
  });

  it("toggles and removes only the fence named", () => {
    const zone = { dividers: [WIRE, { ...WIRE, id: "wire-2", up: false }] };
    expect(withFenceToggled(zone, "wire-2").map((fence) => fence.up)).toEqual([true, true]);
    expect(withoutFence(zone, "wire-1").map((fence) => fence.id)).toEqual(["wire-2"]);
  });

  it("starts from a zone with no fencing at all", () => {
    expect(withFence({ dividers: undefined }, WIRE)).toEqual([WIRE]);
  });

  it("leaves blank text off rather than storing it as empty", () => {
    const fence = fenceFromDraft("x", { ...BLANK_FENCE, name: " Top wire ", line: WIRE.line });
    expect(fence.name).toBe("Top wire");
    expect(fence).not.toHaveProperty("closes");
    expect(fence).not.toHaveProperty("notes");
    expect(fenceFromDraft(WIRE.id, draftFromFence(WIRE))).toEqual(WIRE);
  });

  it("puts the schema's complaints about this fence on its fields", () => {
    const error: CrudError = {
      kind: "validation",
      issues: [
        { path: ["dividers", 0, "name"], message: "Somebody else's fence" },
        { path: ["dividers", 1, "name"], message: "A fence needs a name" },
      ],
    } as unknown as CrudError;
    expect(fenceErrors(error, 1)).toEqual({ name: "A fence needs a name" });
  });
});

describe("a zone's map panel", () => {
  function panel() {
    const calls = {
      trace: vi.fn(),
      removeBoundary: vi.fn(),
      addFence: vi.fn(),
      openFence: vi.fn(),
      toggleFence: vi.fn(),
    };
    render(
      <ZoneMapPanel
        zone={PASTURE}
        water={[TANK]}
        onClose={() => {}}
        onTrace={calls.trace}
        onRemoveBoundary={calls.removeBoundary}
        onAddFence={calls.addFence}
        onOpenFence={calls.openFence}
        onToggleFence={calls.toggleFence}
      />,
    );
    return calls;
  }

  it("offers every write the map makes about the zone", async () => {
    const user = userEvent.setup();
    const calls = panel();

    await user.click(screen.getByRole("button", { name: "Adjust on the map" }));
    await user.click(screen.getByRole("button", { name: "Remove boundary" }));
    await user.click(screen.getByRole("button", { name: "Add a fence" }));
    await user.click(screen.getByRole("button", { name: "Edit Creek wire" }));
    await user.click(screen.getByRole("button", { name: "Take Creek wire down" }));

    expect(calls.trace).toHaveBeenCalledOnce();
    expect(calls.removeBoundary).toHaveBeenCalledOnce();
    expect(calls.addFence).toHaveBeenCalledOnce();
    expect(calls.openFence).toHaveBeenCalledWith(WIRE);
    expect(calls.toggleFence).toHaveBeenCalledWith(WIRE);
  });

  it("links to the zone's one editor rather than copying it", () => {
    panel();

    expect(screen.getByRole("link", { name: "Edit zone details" })).toHaveAttribute(
      "href",
      `/admin/pastures?zone=${PASTURE.id}`,
    );
  });
});

describe("the fence form", () => {
  it("warns when the fence would shut the stock away from all water", () => {
    render(
      <FenceEditor
        zone={PASTURE}
        draft={{ ...draftFromFence(WIRE), waterSourceIds: [] }}
        editing={WIRE}
        water={[TANK]}
        errors={{}}
        busy={false}
        onChange={() => {}}
        onRedraw={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
        onDelete={() => {}}
      />,
    );

    const form = screen.getByRole("dialog");
    expect(within(form).getByText(/shut in with nothing to drink/)).toBeInTheDocument();
    // Only the name is required; what it closes off, the water and the notes
    // are all optional.
    expect(within(form).getByLabelText(/Shuts them out of/)).not.toBeRequired();
    expect(within(form).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
