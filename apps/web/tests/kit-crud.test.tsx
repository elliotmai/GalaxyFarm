import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import { fromDollars, type Ulid } from "@galaxy-farm/core";

/**
 * Create, see, edit and delete on every Kit record (spec §4.5, §5.6, §5.11).
 *
 * The owner's report was that "anything under the farm acts badly and is
 * missing CRUD". These pin what was missing: a machine could be deleted only
 * from a small status panel on the fleet and not at all from its own page, a
 * price could not be left blank (and a blank became $0 where it could), and
 * a machine's cascade wrote its ledgers one at a time.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

/** Every write, with the store it went to. */
const writes = vi.hoisted(() => ({
  created: [] as { store: string; input: Record<string, unknown> }[],
  updated: [] as { store: string; id: string; patch: Record<string, unknown> }[],
  removed: [] as { store: string; id: string }[],
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      writes.created.push({ store, input });
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5Z99", ...input } };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      writes.updated.push({ store, id, patch });
      return { ok: true, value: { id, ...patch } };
    },
    remove: async (id: string) => {
      writes.removed.push({ store, id });
      return { ok: true, value: {} };
    },
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

const pushed = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/equipment",
  useRouter: () => ({ push: (to: string) => pushed.to.push(to), replace: () => {} }),
}));

const { FleetScreen } = await import("../app/(admin)/admin/equipment/_components/fleet-screen.js");
const { EquipmentScreen } =
  await import("../app/(admin)/admin/equipment/[id]/_components/equipment-screen.js");
const { SuppliesScreen } =
  await import("../app/(admin)/admin/supplies/_components/supplies-screen.js");
const { EquipmentRoadmapScreen } =
  await import("../app/(admin)/admin/equipment/roadmap/_components/equipment-roadmap-screen.js");
const { EquipmentCandidatesScreen } =
  await import("../app/(admin)/admin/equipment/candidates/_components/equipment-candidates-screen.js");
const { itemHolds } = await import("../app/(admin)/admin/supplies/_components/supplies-format.js");
const { removeMachine, restoreMachine } =
  await import("../app/(admin)/admin/equipment/_components/machine-removal.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const MACHINE = "01ARZ3NDEKTSV4RRFFQ69G5M01" as Ulid;
const ITEM = "01ARZ3NDEKTSV4RRFFQ69G5S01" as Ulid;

const base = (id: string) => ({
  id: id as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

function wrap(children: React.ReactNode) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>,
  );
}

const trailer = {
  ...base(MACHINE),
  name: "Gooseneck trailer",
  category: "trailer",
  status: "in_service",
  photoKeys: [],
};

/** A machine with something in every ledger, so a delete has a cascade to do. */
function machineWithHistory() {
  stored.current = {
    equipment: [trailer],
    meterReadings: [
      {
        ...base("01ARZ3NDEKTSV4RRFFQ69G5R01"),
        equipmentId: MACHINE,
        kind: "miles",
        value: 40000,
        readOn: new Date("2026-06-01T12:00:00"),
      },
    ],
    maintenanceRules: [
      {
        ...base("01ARZ3NDEKTSV4RRFFQ69G5U01"),
        equipmentId: MACHINE,
        task: "Repack wheel bearings",
        everyMiles: 10000,
        active: true,
      },
    ],
    maintenanceLogs: [
      {
        ...base("01ARZ3NDEKTSV4RRFFQ69G5L01"),
        equipmentId: MACHINE,
        task: "New tyres",
        performedOn: new Date("2026-05-01T12:00:00"),
      },
    ],
    fuelLogs: [],
  };
}

beforeEach(() => {
  writes.created = [];
  writes.updated = [];
  writes.removed = [];
  pushed.to = [];
  stored.current = {};
});

describe("A machine", () => {
  it("opens every field, the status and Delete from the fleet row's pencil", async () => {
    const user = userEvent.setup();
    machineWithHistory();
    wrap(<FleetScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("button", { name: "Edit Gooseneck trailer" }));
    const panel = screen.getByRole("dialog", { name: "Edit Gooseneck trailer" });
    await user.clear(within(panel).getByLabelText(/^Name/));
    await user.type(within(panel).getByLabelText(/^Name/), "Big trailer");
    await user.type(within(panel).getByLabelText(/^VIN or serial/), "4X1234");
    await user.click(within(panel).getByRole("button", { name: "Save machine" }));

    expect(writes.updated[0]).toMatchObject({
      store: "equipment",
      id: MACHINE,
      patch: { name: "Big trailer", vin: "4X1234", purchasePrice: undefined },
    });
  });

  it("is deleted from the fleet with its ledgers, behind the typed confirmation", async () => {
    const user = userEvent.setup();
    machineWithHistory();
    wrap(<FleetScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("button", { name: "Edit Gooseneck trailer" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog");
    // The dependents are named, one per line.
    expect(within(confirm).getByText(/Maintenance rule Repack wheel bearings/)).toBeTruthy();
    await user.type(within(confirm).getByLabelText(/Type Gooseneck trailer/), "Gooseneck trailer");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    // The children first, the machine last.
    expect(writes.removed.map((write) => write.store)).toEqual([
      "meterReadings",
      "maintenanceRules",
      "maintenanceLogs",
      "equipment",
    ]);
  });

  it("can be deleted from its own page, which then goes back to the fleet", async () => {
    const user = userEvent.setup();
    machineWithHistory();
    wrap(<EquipmentScreen equipmentId={MACHINE} propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Edit Gooseneck trailer" });
    await user.click(within(panel).getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog");
    await user.type(within(confirm).getByLabelText(/Type Gooseneck trailer/), "Gooseneck trailer");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(writes.removed.at(-1)).toEqual({ store: "equipment", id: MACHINE });
    expect(pushed.to).toEqual(["/admin/equipment"]);
  });

  it("issues its ledger deletes together, then the machine; the undo leads with the machine", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let most = 0;
    const api = (name: string) => ({
      remove: async (id: string) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        order.push(`remove ${name} ${id}`);
      },
      restoreRecord: async (id: string) => {
        order.push(`restore ${name} ${id}`);
      },
    });
    const children = ["a", "b", "c"].map((id) => ({
      api: api("child"),
      id: id as Ulid,
      entity: "Fuel log",
      label: id,
    }));

    await removeMachine({ id: MACHINE, name: "Truck" }, api("machine"), children);
    // All three children were in flight at once, not one after another.
    expect(most).toBe(3);
    expect(order.at(-1)).toBe(`remove machine ${MACHINE}`);

    order.length = 0;
    await restoreMachine({ id: MACHINE }, api("machine"), children);
    expect(order[0]).toBe(`restore machine ${MACHINE}`);
  });
});

describe("Prices left blank", () => {
  it("records a supply purchase with no price, and the list says so rather than $0", async () => {
    const user = userEvent.setup();
    stored.current = {
      supplyItems: [
        {
          ...base(ITEM),
          name: "Pine shavings",
          kind: "consumable",
          category: "bedding",
          unit: "bag",
          openingQty: 10,
        },
      ],
      supplyPurchases: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5P01"),
          supplyItemId: ITEM,
          quantity: 8,
          purchasedOn: new Date("2026-06-01T12:00:00"),
        },
      ],
    };
    wrap(<SuppliesScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("tab", { name: "Purchases" }));
    expect(screen.getByText(/8 · no price/)).toBeTruthy();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Record a purchase" }));
    const panel = screen.getByRole("dialog", { name: "Record a purchase" });
    await user.selectOptions(within(panel).getByLabelText(/^Item/), ITEM);
    await user.type(within(panel).getByLabelText(/^Quantity/), "3");
    await user.click(within(panel).getByRole("button", { name: "Record purchase" }));

    expect(writes.created[0]).toMatchObject({
      store: "supplyPurchases",
      input: { supplyItemId: ITEM, quantity: 3, unitCost: undefined },
    });
  });

  it("records a fill from the farm tank with no price", async () => {
    const user = userEvent.setup();
    machineWithHistory();
    wrap(<EquipmentScreen equipmentId={MACHINE} propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("tab", { name: "Fuel" }));
    await user.click(screen.getByRole("button", { name: "Record fill" }));
    const panel = screen.getByRole("dialog", { name: "Record a fill" });
    await user.type(within(panel).getByLabelText(/^Gallons/), "20");
    await user.click(within(panel).getByRole("button", { name: "Record fill" }));

    expect(writes.created[0]).toMatchObject({
      store: "fuelLogs",
      input: { equipmentId: MACHINE, gallons: 20, cost: undefined },
    });
  });

  it("adds a candidate with no asking price, ranked after the priced ones, not first", async () => {
    const user = userEvent.setup();
    const candidate = (id: string, title: string, askingPrice?: { cents: number }) => ({
      ...base(id),
      domain: "equipment",
      title,
      status: "watching",
      ...(askingPrice === undefined ? {} : { askingPrice }),
      additionalCosts: [],
      firstSeen: new Date("2026-06-01T12:00:00"),
      photoKeys: [],
      pros: [],
      cons: [],
      planStatus: "open",
    });
    stored.current = {
      purchaseCandidates: [
        candidate("01ARZ3NDEKTSV4RRFFQ69G5C01", "Auction lot 14"),
        candidate("01ARZ3NDEKTSV4RRFFQ69G5C02", "2018 F-250", fromDollars(34_500)),
      ],
    };
    wrap(<EquipmentCandidatesScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0] as HTMLElement).getByText("2018 F-250")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("No price")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: /Add candidate/ })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Add a candidate" });
    await user.type(within(panel).getByLabelText(/^What it is/), "Kubota at the sale barn");
    await user.click(within(panel).getByRole("button", { name: "Add candidate" }));

    expect(writes.created[0]).toMatchObject({
      store: "purchaseCandidates",
      input: { title: "Kubota at the sale barn", askingPrice: undefined },
    });
  });
});

describe("The equipment roadmap", () => {
  it("adds a line in a side panel, and opens one to edit with Delete", async () => {
    const user = userEvent.setup();
    stored.current = {
      roadmapItems: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5W01"),
          domain: "equipment",
          type: "wishlist",
          title: "Three-quarter-ton truck",
          priority: "need",
          status: "open",
        },
      ],
    };
    wrap(<EquipmentRoadmapScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getAllByRole("button", { name: /Add to roadmap/ })[0] as HTMLElement);
    let panel = screen.getByRole("dialog", { name: "Add to the roadmap" });
    await user.type(within(panel).getByLabelText(/^What/), "Hay tedder");
    await user.click(within(panel).getByRole("button", { name: "Add to roadmap" }));
    expect(writes.created[0]).toMatchObject({
      store: "roadmapItems",
      input: { title: "Hay tedder", domain: "equipment", budgetEstimate: undefined },
    });

    await user.click(screen.getByRole("button", { name: "Edit Three-quarter-ton truck" }));
    panel = screen.getByRole("dialog", { name: "Edit Three-quarter-ton truck" });
    await user.click(within(panel).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(writes.removed).toEqual([{ store: "roadmapItems", id: "01ARZ3NDEKTSV4RRFFQ69G5W01" }]);
  });
});

describe("itemHolds", () => {
  it("lists every record naming an item, in one pass", () => {
    const purchases = Array.from({ length: 3 }, (_, at) => ({
      ...base(`01ARZ3NDEKTSV4RRFFQ69G5P0${at}`),
      supplyItemId: ITEM,
      quantity: 1,
      purchasedOn: new Date("2026-06-01"),
    }));
    const usage = [
      {
        ...base("01ARZ3NDEKTSV4RRFFQ69G5U09"),
        supplyItemId: ITEM,
        quantity: 1,
        usedOn: new Date("2026-06-02"),
      },
    ];

    expect(itemHolds(purchases, usage, []).get(ITEM)).toEqual([
      "a purchase",
      "a purchase",
      "a purchase",
      "a usage entry",
    ]);
  });
});
