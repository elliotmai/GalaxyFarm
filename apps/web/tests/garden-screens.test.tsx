import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid, Zone } from "@galaxy-farm/core";
import type {
  Bed,
  Crop,
  HarvestLog,
  Planting,
  SeedInventory,
  Variety,
} from "@galaxy-farm/module-garden";

/**
 * The garden's list screens — plantings, seed, harvest — after the calm
 * redesign (spec §5.5, §8).
 *
 * Cards became rows and the inline Edit and Delete buttons moved into a side
 * panel. These pin that each record is still one tap from its editor, that
 * delete is still there and still confirmed, and that the filter chips say out
 * loud when they are narrowing a list.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
const writes = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  removed: [] as { store: string; id: string }[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      writes.created.push({ store, ...input });
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5GZZ", ...input } };
    },
    update: async (_id: string, patch: Record<string, unknown>) => ({ ok: true, value: patch }),
    remove: async (id: string) => {
      writes.removed.push({ store, id });
      return { ok: true, value: {} };
    },
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { PlantingsScreen } =
  await import("../app/(admin)/admin/garden/plantings/_components/plantings-screen.js");
const { SeedsScreen } =
  await import("../app/(admin)/admin/garden/seeds/_components/seeds-screen.js");
const { HarvestScreen } =
  await import("../app/(admin)/admin/garden/harvest/_components/harvest-screen.js");

const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };
const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

const GARDEN = {
  ...base,
  id: id(1),
  name: "Kitchen garden",
  type: "garden_area",
  indoor: false,
  baselineSafetyLevel: 1,
  waterSourceIds: [],
  resting: false,
  active: true,
} as Zone;

const BED: Bed = {
  ...base,
  id: id(2),
  zoneId: GARDEN.id,
  name: "The long bed",
  type: "raised_bed",
  active: true,
  lengthFt: 12,
  widthFt: 3,
} as Bed;

const TOMATO = { ...base, id: id(10), name: "Tomato", family: "Solanaceae" } as Crop;
const CHEROKEE = {
  ...base,
  id: id(20),
  cropId: TOMATO.id,
  name: "Cherokee Purple",
  daysToMaturity: 80,
} as Variety;

const GROWING: Planting = {
  ...base,
  id: id(30),
  bedId: BED.id,
  varietyId: CHEROKEE.id,
  method: "transplant",
  status: "growing",
  plantedOn: new Date("2026-05-01T12:00:00Z"),
} as Planting;

const FINISHED: Planting = {
  ...GROWING,
  id: id(31),
  status: "finished",
  plantedOn: new Date("2025-05-01T12:00:00Z"),
} as Planting;

const OLD_PACKET = {
  ...base,
  id: id(40),
  varietyId: CHEROKEE.id,
  quantity: 1,
  unit: "packet",
  packedForYear: 2022,
} as SeedInventory;

const PICKING = {
  ...base,
  id: id(50),
  plantingId: GROWING.id,
  harvestedOn: new Date("2026-06-10T12:00:00Z"),
  quantity: 4,
  unit: "lb",
} as HarvestLog;

function wrap(node: React.ReactNode) {
  render(
    <ToastProvider>
      <ConfirmProvider>{node}</ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  writes.created = [];
  writes.removed = [];
  stored.current = {
    zones: [GARDEN],
    beds: [BED],
    crops: [TOMATO],
    varieties: [CHEROKEE],
    plantings: [GROWING, FINISHED],
    seedInventory: [OLD_PACKET],
    harvestLogs: [PICKING],
    preservationLogs: [],
    gardenCareLogs: [],
    seasonPlans: [],
    plannedPlantings: [],
  };
});

describe("plantings", () => {
  it("opens on what is up next, with the plantings a tab away", async () => {
    const user = userEvent.setup();
    wrap(<PlantingsScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByRole("tab", { name: "Up next" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Plantings" }));
    expect(screen.getByRole("list", { name: "Plantings" })).toBeInTheDocument();
  });

  it("leads with facts and the current plantings, finished ones a chip away", async () => {
    const user = userEvent.setup();
    wrap(<PlantingsScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: "Plantings" }));

    expect(screen.getByText("1 in the ground · 1 of 1 beds in use")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Plantings" })).getAllByRole("listitem"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /^Finished 1$/ }));

    expect(screen.getByText("Showing 1 of 2")).toBeInTheDocument();
  });

  it("opens the editor from the row, with delete behind a confirmation", async () => {
    const user = userEvent.setup();
    wrap(<PlantingsScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: "Plantings" }));

    await user.click(
      screen.getByRole("button", { name: "Edit Cherokee Purple · Tomato in The long bed" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Elevated tier, because a harvest hangs off it: nothing goes until confirmed.
    expect(writes.removed).toEqual([]);
    expect(within(await screen.findByRole("dialog")).getByText(/4 lb/)).toBeInTheDocument();
  });
});

describe("seed", () => {
  it("says the stale count once and filters to it on request", async () => {
    const user = userEvent.setup();
    wrap(<SeedsScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByText(/1 worth a germination test/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show them" }));

    expect(screen.getByRole("button", { name: /^Worth testing 1$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Test first")).toBeInTheDocument();
  });
});

describe("harvest", () => {
  it("records a picking from the side panel", async () => {
    const user = userEvent.setup();
    wrap(<HarvestScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("tab", { name: "Harvest log" }));
    // Two copies of the add button — toolbar and phone — and either will do.
    await user.click(screen.getAllByRole("button", { name: /Record harvest/ })[0] as HTMLElement);
    await user.type(screen.getByLabelText(/How much/), "2");
    await user.click(screen.getByRole("button", { name: "Record it" }));

    expect(writes.created).toHaveLength(1);
    expect(writes.created[0]).toMatchObject({
      store: "harvestLogs",
      plantingId: GROWING.id,
      quantity: 2,
    });
  });
});

describe("optional amounts", () => {
  it("records a picking nobody weighed", async () => {
    const user = userEvent.setup();
    wrap(<HarvestScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("tab", { name: "Harvest log" }));
    await user.click(screen.getAllByRole("button", { name: /Record harvest/ })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Record it" }));

    expect(writes.created).toHaveLength(1);
    expect(writes.created[0]).toMatchObject({ store: "harvestLogs", plantingId: GROWING.id });
    expect(writes.created[0]?.["quantity"]).toBeUndefined();
  });

  it("adds seed without a count", async () => {
    const user = userEvent.setup();
    wrap(<SeedsScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getAllByRole("button", { name: /Add seed/ })[0] as HTMLElement);
    const dialog = within(await screen.findByRole("dialog"));
    await user.selectOptions(dialog.getByLabelText(/^Plant/), CHEROKEE.id);
    await user.clear(dialog.getByLabelText(/Quantity/));
    await user.click(dialog.getByRole("button", { name: "Add seed" }));

    expect(writes.created[0]).toMatchObject({ store: "seedInventory", varietyId: CHEROKEE.id });
    expect(writes.created[0]?.["quantity"]).toBeUndefined();
  });

  it("goes from a picking straight to a pantry batch that names it", async () => {
    const user = userEvent.setup();
    wrap(<HarvestScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("tab", { name: "Harvest log" }));
    await user.click(screen.getByRole("button", { name: /^Edit 4 lb of Cherokee Purple/ }));
    await user.click(screen.getByRole("button", { name: "Put some by" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText(/Label/)).toHaveValue("Cherokee Purple");
    expect(dialog.getByLabelText(/From which harvest/)).toHaveValue(PICKING.id);
    await user.click(dialog.getByRole("button", { name: "Put it by" }));
    expect(writes.created[0]).toMatchObject({
      store: "preservationLogs",
      harvestLogId: PICKING.id,
      label: "Cherokee Purple",
    });
  });
});

describe("plants — one list, what it grows like worked out", () => {
  beforeEach(() => {
    // The plant search's server half is not running in a unit test: it fails,
    // and the form must carry on with the built-in table.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  async function openNewPlant(user: ReturnType<typeof userEvent.setup>) {
    wrap(<SeedsScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: "Plants" }));
    await user.click(screen.getAllByRole("button", { name: /Add plant/ })[0] as HTMLElement);
    return within(await screen.findByRole("dialog"));
  }

  it("lists plants once, with no separate crops to manage", async () => {
    const user = userEvent.setup();
    wrap(<SeedsScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: "Plants" }));

    const list = within(screen.getByRole("list", { name: "Plants" }));
    expect(list.getByRole("button", { name: "Edit Cherokee Purple" })).toBeInTheDocument();
    // The crop it is filed under is a word on its row, not a list of its own.
    expect(screen.queryByRole("button", { name: /Add crop/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Crops" })).not.toBeInTheDocument();
  });

  it("adds a plant by name alone, filed under the crop it grows like", async () => {
    const user = userEvent.setup();
    const dialog = await openNewPlant(user);
    await user.type(dialog.getByLabelText(/^Name/), "Early Jalapeño");
    expect(dialog.getByLabelText(/Grows like/)).toHaveDisplayValue("Pepper (from the name)");
    await user.click(dialog.getByRole("button", { name: "Add plant" }));

    // No pepper on the list yet: one is made, quietly, then the plant on it.
    expect(writes.created.map((row) => row["store"])).toEqual(["crops", "varieties"]);
    expect(writes.created[0]).toMatchObject({ name: "Pepper", season: "warm" });
    expect(writes.created[0]?.["family"]).toBeUndefined();
    expect(writes.created[1]).toMatchObject({
      name: "Early Jalapeño",
      cropId: "01ARZ3NDEKTSV4RRFFQ69G5GZZ",
    });
  });

  it("files a plant under a crop already recorded, without making another", async () => {
    const user = userEvent.setup();
    const dialog = await openNewPlant(user);
    await user.type(dialog.getByLabelText(/^Name/), "Brandywine tomato");
    expect(dialog.getByLabelText(/Grows like/)).toHaveDisplayValue("Tomato (from the name)");
    await user.click(dialog.getByRole("button", { name: "Add plant" }));

    expect(writes.created.map((row) => row["store"])).toEqual(["varieties"]);
    expect(writes.created[0]).toMatchObject({ name: "Brandywine tomato", cropId: TOMATO.id });
  });

  it("fills the kind's own days and spacing from a picked match", async () => {
    const user = userEvent.setup();
    const dialog = await openNewPlant(user);
    await user.type(dialog.getByLabelText(/^Name/), "zucch");
    const matches = within(dialog.getByRole("list", { name: "Plants matching the name" }));
    // Told apart by what it is, not by its Latin name.
    const zucchini = matches.getByRole("button", { name: /^Zucchini/ });
    expect(zucchini).toHaveTextContent(/Summer squash/);
    expect(zucchini).not.toHaveTextContent(/Cucurbita/);
    await user.click(zucchini);

    expect(dialog.getByLabelText(/^Name/)).toHaveValue("Zucchini");
    expect(dialog.queryByLabelText(/Scientific name/)).not.toBeInTheDocument();
    // A zucchini's figures, not a pumpkin's.
    expect(dialog.getByLabelText(/Days to maturity/)).toHaveValue(50);
    expect(dialog.getByLabelText(/Spacing/)).toHaveValue(24);
    await user.click(dialog.getByRole("button", { name: "Add plant" }));

    expect(writes.created[0]).toMatchObject({
      store: "crops",
      name: "Squash",
      // Still kept, quietly: it is how a lookup online matches the species.
      scientificName: "Cucurbita pepo",
    });
    expect(writes.created[1]).toMatchObject({
      name: "Zucchini",
      daysToMaturity: 50,
      spacingInches: 24,
    });
  });

  it("lets what it grows like be changed, and the family overridden behind a disclosure", async () => {
    const user = userEvent.setup();
    const dialog = await openNewPlant(user);
    await user.type(dialog.getByLabelText(/^Name/), "Moonflower");
    expect(dialog.getByLabelText(/Grows like/)).toHaveDisplayValue("Moonflower (from the name)");
    await user.click(dialog.getByText("Change"));
    await user.type(dialog.getByLabelText(/Plant family/), "convolvulaceae");
    await user.click(dialog.getByRole("button", { name: "Add plant" }));

    expect(writes.created[0]).toMatchObject({
      store: "crops",
      name: "Moonflower",
      family: "Convolvulaceae",
    });
  });
});
