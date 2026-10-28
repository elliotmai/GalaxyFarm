import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

/**
 * The Kit screens (spec §5.6, §5.11).
 *
 * Every create and edit on these screens moved from a form on the page into a
 * side panel behind one button, and the tiles and callouts became one line of
 * facts and one line per thing worth interrupting for. These pin that the
 * forms are still there and still write, and that the lines still say what
 * the callouts said — the trigger that fired, the count under the reorder
 * point — rather than only that something is wrong.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

const saved = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      saved.created.push(input);
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5Z99", ...input } };
    },
    update: async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { id, ...patch },
    }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/equipment",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { FleetScreen } = await import("../app/(admin)/admin/equipment/_components/fleet-screen.js");
const { EquipmentScreen } =
  await import("../app/(admin)/admin/equipment/[id]/_components/equipment-screen.js");
const { SuppliesScreen } =
  await import("../app/(admin)/admin/supplies/_components/supplies-screen.js");
const { FeedScreen } = await import("../app/(admin)/admin/feed/_components/feed-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const MACHINE = "01ARZ3NDEKTSV4RRFFQ69G5M01" as Ulid;

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

beforeEach(() => {
  saved.created = [];
  stored.current = {};
});

describe("The fleet", () => {
  it("adds a machine in a side panel, and the panel closes when it is saved", async () => {
    const user = userEvent.setup();
    wrap(<FleetScreen propertyId={PROPERTY} actorId={ACTOR} />);

    // The header's button and the phone's floating one; either opens the panel.
    await user.click(screen.getAllByRole("button", { name: /Add machine/ })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Add a machine" });
    await user.type(within(panel).getByLabelText(/^Name/), "Gooseneck trailer");
    await user.click(within(panel).getByRole("button", { name: "Add machine" }));

    expect(saved.created[0]).toMatchObject({ name: "Gooseneck trailer", status: "in_service" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("One machine", () => {
  beforeEach(() => {
    stored.current = {
      equipment: [
        {
          ...base(MACHINE),
          name: "Gooseneck trailer",
          category: "implement",
          status: "in_service",
          photoKeys: [],
        },
      ],
      meterReadings: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5R01"),
          equipmentId: MACHINE,
          kind: "miles",
          value: 40000,
          readOn: new Date("2026-06-01T12:00:00"),
        },
      ],
      // Blown past: 40,000 miles against a 10,000-mile interval never done.
      maintenanceRules: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5U01"),
          equipmentId: MACHINE,
          task: "Repack wheel bearings",
          everyMiles: 10000,
          active: true,
        },
      ],
    };
  });

  it("names the trigger that fired, and records the job from that line", async () => {
    const user = userEvent.setup();
    wrap(<EquipmentScreen equipmentId={MACHINE} propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByText("Overdue: Repack wheel bearings (on miles)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Record it" }));
    const panel = screen.getByRole("dialog", { name: "Record work done" });
    // The rule's words, and the meter carried across so the interval counts
    // from what the gauge said rather than from memory.
    expect((within(panel).getByLabelText(/^Job/) as HTMLInputElement).value).toBe(
      "Repack wheel bearings",
    );
    expect((within(panel).getByLabelText(/^Miles at the time/) as HTMLInputElement).value).toBe(
      "40000",
    );
  });

  it("reads the meter in a side panel rather than a form above the readings", async () => {
    const user = userEvent.setup();
    wrap(<EquipmentScreen equipmentId={MACHINE} propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByText("40,000 miles")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Read meter" }));
    const panel = screen.getByRole("dialog", { name: "Read the meter" });
    await user.type(within(panel).getByLabelText(/^Reading/), "41000");
    await user.click(within(panel).getByRole("button", { name: "Record reading" }));

    expect(saved.created[0]).toMatchObject({ equipmentId: MACHINE, value: 41000 });
  });
});

describe("The supplies shelf", () => {
  it("says what is under its reorder point, with the count, in one line", () => {
    const item = "01ARZ3NDEKTSV4RRFFQ69G5S01" as Ulid;
    stored.current = {
      supplyItems: [
        {
          ...base(item),
          name: "Pine shavings",
          kind: "consumable",
          category: "general",
          unit: "bag",
          openingQty: 10,
          reorderThreshold: 4,
        },
      ],
      // Ten less seven is three, under four. Nothing stores the three.
      supplyUsage: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5S02"),
          supplyItemId: item,
          quantity: 7,
          usedOn: new Date("2026-06-01T12:00:00"),
        },
      ],
    };
    wrap(<SuppliesScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByText("To reorder: Pine shavings (3 bag)")).toBeTruthy();
  });

  it("starts a use from the item's row on the shelf", async () => {
    const user = userEvent.setup();
    const item = "01ARZ3NDEKTSV4RRFFQ69G5S01" as Ulid;
    stored.current = {
      supplyItems: [
        {
          ...base(item),
          name: "Pine shavings",
          kind: "consumable",
          category: "general",
          unit: "bag",
          openingQty: 10,
        },
      ],
    };
    wrap(<SuppliesScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("button", { name: "Record Pine shavings used" }));
    const panel = screen.getByRole("dialog", { name: "Record what was used" });
    expect((within(panel).getByLabelText(/^Item/) as HTMLSelectElement).value).toBe(item);
  });
});

describe("The feed shed", () => {
  it("records a purchase in a side panel", async () => {
    const user = userEvent.setup();
    const hay = "01ARZ3NDEKTSV4RRFFQ69G5F01" as Ulid;
    stored.current = {
      feedTypes: [
        {
          ...base(hay),
          name: "Grass hay",
          category: "hay",
          unit: "round_bale",
          reorderLeadDays: 7,
          active: true,
        },
      ],
    };
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getAllByRole("button", { name: /Record purchase/ })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Record a purchase" });
    await user.selectOptions(within(panel).getByLabelText(/^Feed/), hay);
    await user.type(within(panel).getByLabelText(/^Quantity/), "12");
    await user.type(within(panel).getByLabelText(/^Cost each/), "65");
    await user.click(within(panel).getByRole("button", { name: "Record purchase" }));

    expect(saved.created[0]).toMatchObject({ feedTypeId: hay, quantity: 12 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
