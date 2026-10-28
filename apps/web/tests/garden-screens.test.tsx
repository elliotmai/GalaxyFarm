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
  it("leads with facts and the current plantings, finished ones a chip away", async () => {
    const user = userEvent.setup();
    wrap(<PlantingsScreen propertyId={PROPERTY} actorId={ACTOR} />);

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
