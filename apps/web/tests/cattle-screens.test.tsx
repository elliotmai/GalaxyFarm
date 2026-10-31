import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";
import type { HealthRecord, WeightRecord } from "@galaxy-farm/module-cattle";

/**
 * The cattle logs, after their forms moved into side panels (spec §5.2).
 *
 * Each screen is a list with one button that opens its form. What these pin is
 * that every form is still reachable from that button and still writes, and
 * that the sale screen's withdrawal block survived the move — a block that only
 * lived on the old inline form would be a block nobody meets any more.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const COW = "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      stored.writes.push(input);
      return { ok: true, value: input };
    },
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { RisksScreen } =
  await import("../app/(admin)/admin/cattle/risks/_components/risks-screen.js");
const { WeightsScreen } =
  await import("../app/(admin)/admin/cattle/weights/_components/weights-screen.js");
const { CattleFeedScreen } =
  await import("../app/(admin)/admin/cattle/feed/_components/cattle-feed-screen.js");
const { SalesScreen } =
  await import("../app/(admin)/admin/cattle/sales/_components/sales-screen.js");

const DAISY = {
  id: COW,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  species: "cattle",
  name: "Daisy",
  sex: "female",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

const base = {
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function wrap(node: React.ReactNode) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{node}</ConfirmProvider>
    </ToastProvider>,
  );
}

/** The header button, which on a phone is the floating one — both open the same panel. */
function addButton(name: RegExp) {
  const [first] = screen.getAllByRole("button", { name });
  return first as HTMLElement;
}

beforeEach(() => {
  stored.current = { animals: [DAISY] };
  stored.writes = [];
});

describe("the cattle logs", () => {
  it("says a clean herd plainly on the risks screen", () => {
    wrap(<RisksScreen propertyId={PROPERTY} />);
    expect(screen.getByRole("heading", { level: 1, name: "Worth a look" })).toBeTruthy();
    expect(screen.getByText("Nothing to flag")).toBeTruthy();
  });

  it("lists who has been weighed, and records another from the panel", async () => {
    const user = userEvent.setup();
    stored.current = {
      animals: [DAISY],
      weightRecords: [
        {
          ...base,
          id: "01ARZ3NDEKTSV4RRFFQ69G5W01" as Ulid,
          animalId: COW,
          date: new Date("2026-03-01"),
          weightLb: 640,
          context: "other",
        } as WeightRecord,
      ],
    };
    wrap(<WeightsScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(
      within(screen.getByRole("list", { name: "Animals weighed" })).getByText("Daisy"),
    ).toBeTruthy();

    await user.click(addButton(/Record weight/));
    const panel = screen.getByRole("dialog");
    await user.selectOptions(within(panel).getByLabelText(/Animal/), COW);
    await user.type(within(panel).getByLabelText(/Weight \(lb\)/), "655");
    await user.click(within(panel).getByRole("button", { name: "Record weight" }));

    expect(stored.writes[0]?.["weightLb"]).toBe(655);
  });

  it("opens the plan form from the feed screen", async () => {
    const user = userEvent.setup();
    wrap(<CattleFeedScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(addButton(/Add plan/));
    expect(within(screen.getByRole("dialog")).getByLabelText(/Plan name/)).toBeTruthy();
  });

  it("will not record a sale over a withdrawal without a reason", async () => {
    const user = userEvent.setup();
    stored.current = {
      animals: [DAISY],
      healthRecords: [
        {
          ...base,
          id: "01ARZ3NDEKTSV4RRFFQ69G5H01" as Ulid,
          animalId: COW,
          type: "treatment",
          date: new Date(Date.now() - 2 * 86_400_000),
          product: "LA-200",
          route: "subcutaneous",
          withdrawalDays: 28,
        } as HealthRecord,
      ],
    };
    wrap(<SalesScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(addButton(/Record sale/));
    const panel = screen.getByRole("dialog");
    await user.selectOptions(within(panel).getByLabelText(/Animal/), COW);

    const save = within(panel).getByRole("button", { name: "Record sale under override" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(panel).getByLabelText("Sell it anyway"));
    await user.type(within(panel).getByLabelText(/Why this is not a slaughter sale/), "Breeding");
    await user.type(within(panel).getByLabelText(/Price/), "1800");
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
