import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Property, Ulid, Zone } from "@galaxy-farm/core";
import type { Bed, Crop, Planting, Variety } from "@galaxy-farm/module-garden";

/**
 * `/admin/garden/layout` (spec §5.5, §7, issue #33).
 *
 * Two of the issue's criteria are only true if the *screen* is true, and both
 * are driven here rather than asserted on a helper.
 *
 * **Bed geometry round-trips.** A bed drawn on the plan has to come back off it
 * as the same feet. `garden-plan.test.ts` pins the arithmetic; what this pins is
 * the composition around it — that the designer opens a draft from the bed's
 * stored rectangle and writes that rectangle back, rather than the pixels it
 * happened to be drawn at.
 *
 * **The rotation guard shows where you plant.** Twice over: the plan colours
 * itself for the family in the picker before a bed has been chosen at all, and
 * dropping a row into a bed that grew its family recently is challenged. Both
 * are warnings — the last assertion is that "Move it anyway" moves it.
 *
 * The panel is stubbed to a size because jsdom lays nothing out, and the editor
 * cannot project a coordinate onto a panel of zero pixels.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const GARDEN_ZONE = "01ARZ3NDEKTSV4RRFFQ69G5FZ1" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");

const PANEL = { width: 800, height: 600 };

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
const writes = vi.hoisted(() => ({
  beds: [] as { id: string; patch: Record<string, unknown> }[],
  plantings: [] as { id: string; patch: Record<string, unknown> }[],
  created: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      writes.created.push({ store, ...input });
      return { ok: true, value: input };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      (store === "beds" ? writes.beds : writes.plantings).push({ id, patch });
      return { ok: true, value: patch };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("@/app/_components/sync-provider", () => ({
  useSync: () => ({
    offline: false,
    problem: undefined,
    syncing: false,
    pending: 0,
    stuck: 0,
    retryStuck: async () => {},
  }),
  useSyncEngine: () => ({ store: undefined, syncNow: async () => {}, retryStuck: async () => {} }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { GardenLayoutScreen } =
  await import("../app/(admin)/admin/garden/layout/_components/garden-layout-screen.js");

const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };
const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

/** The garden itself, traced on the property map — the corner the plan hangs on. */
const GARDEN: Zone = {
  ...base,
  id: GARDEN_ZONE,
  name: "Kitchen garden",
  type: "garden_area",
  indoor: false,
  baselineSafetyLevel: 1,
  waterSourceIds: [],
  resting: false,
  active: true,
  boundary: [
    { lat: 32.7361, lng: -97.4093 },
    { lat: 32.7361, lng: -97.4083 },
    { lat: 32.7353, lng: -97.4083 },
    { lat: 32.7353, lng: -97.4093 },
  ],
} as Zone;

const PROPERTY_RECORD = {
  ...base,
  id: PROPERTY,
  name: "Galaxy Farm",
  latitude: 32.7357,
  longitude: -97.4089,
} as Property;

/** Twelve feet by three, ten feet east and four feet south of the corner. */
const LONG_BED: Bed = {
  ...base,
  id: id(1),
  zoneId: GARDEN_ZONE,
  name: "The long bed",
  type: "raised_bed",
  active: true,
  x: 10,
  y: 4,
  lengthFt: 12,
  widthFt: 3,
} as Bed;

const SIDE_BED: Bed = {
  ...LONG_BED,
  id: id(2),
  name: "Side bed",
  x: 10,
  y: 20,
  lengthFt: 6,
  widthFt: 3,
} as Bed;

const TOMATO: Crop = { ...base, id: id(10), name: "Tomato", family: "Solanaceae" } as Crop;
const KALE: Crop = { ...base, id: id(11), name: "Kale", family: "Brassicaceae" } as Crop;

const CHEROKEE: Variety = {
  ...base,
  id: id(20),
  cropId: TOMATO.id,
  name: "Cherokee Purple",
} as Variety;
const RED_RUSSIAN: Variety = {
  ...base,
  id: id(21),
  cropId: KALE.id,
  name: "Red Russian",
} as Variety;

/** Nightshades came out of the long bed three months ago. */
const LAST_SEASON: Planting = {
  ...base,
  id: id(30),
  bedId: LONG_BED.id,
  varietyId: CHEROKEE.id,
  method: "transplant",
  status: "finished",
  plantedOn: new Date("2026-03-01T12:00:00Z"),
} as Planting;

/** Kale growing in the side bed, ready to be dragged somewhere it should not go. */
const KALE_ROW: Planting = {
  ...base,
  id: id(31),
  bedId: SIDE_BED.id,
  varietyId: RED_RUSSIAN.id,
  method: "direct_sow",
  status: "growing",
  plantedOn: new Date("2026-05-01T12:00:00Z"),
} as Planting;

function view() {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <GardenLayoutScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

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

  writes.beds = [];
  writes.plantings = [];
  writes.created = [];

  stored.current = {
    beds: [LONG_BED, SIDE_BED],
    plantings: [LAST_SEASON, KALE_ROW],
    varieties: [CHEROKEE, RED_RUSSIAN],
    crops: [TOMATO, KALE],
    zones: [GARDEN],
    properties: [PROPERTY_RECORD],
  };
});

describe("the garden skin", () => {
  it("is the shared editor wearing the garden's palette", () => {
    // §2's "one component, two palettes", from the screen's end: the words are
    // the palette's, and the drawing is the same component the property map
    // uses. Snapping is on, because a bed is built to a tape measure.
    view();

    expect(
      screen.getByRole("application", { name: "Plan of the garden beds" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tap a bed or a planting for its notes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn grid snap off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^The long bed/ })).toBeInTheDocument();
  });
});

describe("bed geometry", () => {
  it("round-trips: what is drawn is what the record already said", () => {
    // The bed's stored feet are what the plan draws, and the table reads them
    // back the same way round — east then south, from the garden's north-west
    // corner.
    view();

    // Scoped to the table: the plan draws the same size under the bed's name,
    // which is the point — one number, two places, no chance to disagree.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("12′ × 3′")).toBeInTheDocument();
    expect(table.getByText("10′ east, 4′ south")).toBeInTheDocument();
  });

  it("writes a drawn rectangle back as the four numbers a bed stores", async () => {
    // Adjusting opens the draft from the rectangle already on the plan, so
    // saving it unchanged has to write the same feet back. Anything else — a
    // pixel leaking into the record, an axis swapped on the way out — moves a
    // bed that nobody touched.
    view();

    await userEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Save the bed" }));

    expect(writes.beds).toHaveLength(1);
    expect(writes.beds[0]?.id).toBe(LONG_BED.id);

    const patch = writes.beds[0]?.patch as Record<string, number>;
    expect(patch["x"]).toBeCloseTo(10, 1);
    expect(patch["y"]).toBeCloseTo(4, 1);
    expect(patch["lengthFt"]).toBeCloseTo(12, 1);
    expect(patch["widthFt"]).toBeCloseTo(3, 1);
  });

  it("will not save an outline that encloses no ground", async () => {
    view();

    await userEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));

    // Three corners is the fewest that enclose anything, and the editor says so
    // — the button is not offered until there are three.
    expect(screen.getByRole("button", { name: "Save the bed" })).toBeDisabled();
    expect(writes.beds).toHaveLength(0);
  });
});

describe("the rotation guard, in the designer", () => {
  it("colours the plan the moment somebody says what is going in", async () => {
    // §5.5 wants the warning where you plant. This is the earliest it can
    // possibly arrive: before a bed has been chosen, while changing the answer
    // still costs nothing.
    view();

    // Nothing chosen — the beds carry no rank, because "is this bed clear" is
    // not a question a bed can answer on its own. Fallow is all it says: the
    // ground is empty, and the palette's word for that is not "resting".
    expect(screen.getByRole("button", { name: "The long bed, fallow" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Variety"), CHEROKEE.id);

    expect(
      screen.getByRole("button", { name: /The long bed, Rotation 3 — Same family last season/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Side bed, Rotation 1 — Clear to plant/ }),
    ).toBeInTheDocument();
  });

  it("says why, on the bed, and does not refuse", async () => {
    view();

    await userEvent.selectOptions(screen.getByLabelText("Variety"), CHEROKEE.id);
    await userEvent.click(
      screen.getByRole("button", { name: /The long bed, Rotation 3 — Same family last season/ }),
    );

    expect(screen.getByText(/Rotation warning/)).toBeInTheDocument();
    expect(screen.getByText(/Solanaceae was last in The long bed/)).toBeInTheDocument();

    // A warning, not a block: the row still goes in if that is what somebody
    // means to do.
    const plant = screen.getByRole("button", { name: "Plant it in The long bed" });
    expect(plant).toBeEnabled();

    await userEvent.click(plant);
    expect(writes.created).toHaveLength(1);
    expect(writes.created[0]).toMatchObject({
      bedId: LONG_BED.id,
      varietyId: CHEROKEE.id,
      status: "growing",
    });
  });

  it("challenges a row dragged into a bed that grew its family, then moves it", async () => {
    // Dropping a row into a bed *is* planting it there, so it gets the same
    // warning the form gives — challenged, exactly as the property map
    // challenges a move onto resting ground rather than blocking it.
    stored.current["plantings"] = [
      { ...LAST_SEASON, varietyId: RED_RUSSIAN.id },
      KALE_ROW,
    ] as Planting[];

    view();

    // The keyboard and single-tap path through the same reassignment a drag
    // performs: choose the chip, then choose the bed.
    // `fireEvent` rather than `userEvent`, and only here: a tap is decided by
    // where the pointer was, and jsdom lays nothing out, so every synthesised
    // pointer event carries the origin as its coordinates. The pointer path is
    // driven properly in `packages/ui/tests/spatial-editor.test.tsx`, where the
    // panel's pixels can be worked out; what this drives is the screen's half.
    fireEvent.click(screen.getByRole("button", { name: /^Red Russian · Kale/ }));
    // With a chip chosen, every bed offers itself as somewhere to put it —
    // which is what the button now says.
    fireEvent.click(
      screen.getByRole("button", { name: "Move Red Russian · Kale to The long bed" }),
    );

    expect(
      screen.getByText(/Brassicaceae was last in The long bed/, { exact: false }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move it anyway" }));

    expect(writes.plantings).toEqual([{ id: KALE_ROW.id, patch: { bedId: LONG_BED.id } }]);
  });

  it("moves a row into clear ground without asking", async () => {
    view();

    fireEvent.click(screen.getByRole("button", { name: /^Red Russian · Kale/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move Red Russian · Kale to The long bed" }),
    );

    expect(screen.queryByText(/Rotation warning/)).not.toBeInTheDocument();
    expect(writes.plantings).toEqual([{ id: KALE_ROW.id, patch: { bedId: LONG_BED.id } }]);
  });
});

describe("a garden with nowhere to hang", () => {
  it("says so rather than drawing the beds in the Gulf of Guinea", () => {
    stored.current["zones"] = [{ ...GARDEN, boundary: undefined }] as Zone[];
    stored.current["properties"] = [
      { ...PROPERTY_RECORD, latitude: undefined, longitude: undefined },
    ] as Property[];

    view();

    expect(screen.getByText(/The garden has nowhere to hang/)).toBeInTheDocument();
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
  });
});
