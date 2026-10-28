import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import { feedingChoreId, startOfDay, type Ulid } from "@galaxy-farm/core";

/**
 * Farm › Feed: Today, Plan and Shed (spec §5.3).
 *
 * These pin that each segment does its one job through the write path that
 * already existed — the tick is the kiosk's `toggleChore` row, Adjust opens
 * the cattle screen's plan editor on any species, and Restock is the purchase
 * form already on that feed — and that the old logs are still reachable.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

const saved = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: [] as { id: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      saved.created.push(input);
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5Z99", ...input } };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      saved.updated.push({ id, patch });
      return { ok: true, value: { id, ...patch } };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/feed",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { FeedScreen } = await import("../app/(admin)/admin/feed/_components/feed-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const HAY = "01ARZ3NDEKTSV4RRFFQ69G5F01" as Ulid;
const BISCUIT = "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid;
const PLAN = "01ARZ3NDEKTSV4RRFFQ69G5P01" as Ulid;

const base = (id: string) => ({
  id: id as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

/** A horse on half a round bale a day, with two bales in the shed: four days. */
function farm(extra: Record<string, readonly unknown[]> = {}) {
  stored.current = {
    feedTypes: [
      {
        ...base(HAY),
        name: "Grass hay",
        category: "hay",
        unit: "round_bale",
        reorderLeadDays: 7,
        active: true,
      },
    ],
    feedPurchases: [
      {
        ...base("01ARZ3NDEKTSV4RRFFQ69G5B01"),
        feedTypeId: HAY,
        quantity: 2,
        unitCost: { cents: 6500 },
        purchasedOn: new Date(),
      },
    ],
    animals: [
      {
        ...base(BISCUIT),
        name: "Biscuit",
        species: "horse",
        sex: "female",
        status: "active",
        ownership: "owned",
      },
    ],
    feedingPlans: [
      {
        ...base(PLAN),
        name: "Biscuit's hay",
        target: "animal",
        targetId: BISCUIT,
        alsoFeeds: [],
        portion: "per_head",
        active: true,
        lines: [
          {
            feedTypeId: HAY,
            amount: { amount: 0.5, unit: "round_bale" },
            frequency: "once_daily",
            timeOfDay: "morning",
          },
        ],
      },
    ],
    ...extra,
  };
}

function wrap(children: React.ReactNode) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  saved.created = [];
  saved.updated = [];
  stored.current = {};
});

describe("Farm › Feed › Today", () => {
  it("ticks a feeding through the kiosk's write: a completed row keyed to the trip", async () => {
    const user = userEvent.setup();
    farm();
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByRole("tab", { name: "Today" }).getAttribute("aria-selected")).toBe("true");
    const tick = screen.getByRole("button", { name: /Fed: Morning feed · Biscuit's hay/ });
    expect(tick.getAttribute("aria-pressed")).toBe("false");
    await user.click(tick);

    expect(saved.created[0]).toMatchObject({
      sourceKey: feedingChoreId(
        { target: "animal", targetId: BISCUIT, timeOfDay: "morning" },
        startOfDay(new Date()),
      ),
      completedBy: ACTOR,
    });
    expect(saved.created[0]?.["completedAt"]).toBeInstanceOf(Date);
  });

  it("says who ticked a done feeding, and un-ticks it", async () => {
    const user = userEvent.setup();
    const key = feedingChoreId(
      { target: "animal", targetId: BISCUIT, timeOfDay: "morning" },
      startOfDay(new Date()),
    );
    const at = new Date();
    farm({
      tasks: [
        {
          ...base("01ARZ3NDEKTSV4RRFFQ69G5T01"),
          sourceKey: key,
          title: "Morning feed · Biscuit's hay",
          dueAt: at,
          completedAt: at,
          completedBy: ACTOR,
          animalId: BISCUIT,
        },
      ],
    });
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const list = screen.getByRole("list", { name: "Today's feedings" });
    expect(within(list).getByText(/Done by you/)).toBeTruthy();
    const tick = within(list).getByRole("button", { name: /Fed: / });
    expect(tick.getAttribute("aria-pressed")).toBe("true");

    await user.click(tick);
    expect(saved.updated[0]).toEqual({
      id: "01ARZ3NDEKTSV4RRFFQ69G5T01",
      patch: { completedAt: undefined, completedBy: undefined },
    });
  });
});

describe("Farm › Feed › Plan", () => {
  it("shows every species' rations and adjusts one in the existing plan editor", async () => {
    const user = userEvent.setup();
    farm();
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getByRole("tab", { name: "Plan" }));
    const card = screen.getByRole("region", { name: "Biscuit's hay" });
    expect(within(card).getByText("Biscuit")).toBeTruthy();
    expect(within(card).getByText("Grass hay")).toBeTruthy();
    expect(within(card).getByText("0.5 round bale")).toBeTruthy();

    await user.click(within(card).getByRole("button", { name: "Adjust Biscuit's hay" }));
    const panel = screen.getByRole("dialog", { name: "Edit Biscuit's hay" });
    // A horse, offered as a target here although the cattle screen offers only cattle.
    expect((within(panel).getByLabelText(/^Animal/) as HTMLSelectElement).value).toBe(BISCUIT);

    await user.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(saved.updated[0]).toMatchObject({ id: PLAN, patch: { targetId: BISCUIT } });
  });

  it("sends a shared bowl to the pets screen rather than flattening it", () => {
    farm();
    const plans = stored.current["feedingPlans"] as Record<string, unknown>[];
    stored.current = {
      ...stored.current,
      feedingPlans: [{ ...plans[0], alsoFeeds: ["01ARZ3NDEKTSV4RRFFQ69G5A02"] }],
    };
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="plan" />);

    const link = screen.getByRole("link", { name: "Adjust Biscuit's hay on Pets" });
    expect(link.getAttribute("href")).toBe("/admin/pets");
  });
});

describe("Farm › Feed › Shed", () => {
  it("says when a low feed runs out and restocks it with the purchase form prefilled", async () => {
    const user = userEvent.setup();
    farm();
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="shed" />);

    const shed = screen.getByRole("list", { name: "In the shed" });
    expect(within(shed).getByText(/2 round bale · runs out/)).toBeTruthy();

    await user.click(within(shed).getByRole("button", { name: "Restock Grass hay" }));
    const panel = screen.getByRole("dialog", { name: "Record a purchase" });
    expect((within(panel).getByLabelText(/^Feed/) as HTMLSelectElement).value).toBe(HAY);
  });

  it("keeps the purchase and count logs behind History", async () => {
    const user = userEvent.setup();
    farm();
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="shed" />);

    await user.click(screen.getByText("History"));
    const history = screen.getByRole("tablist", { name: "Feed history" });
    expect(within(history).getByRole("tab", { name: "Purchases" })).toBeTruthy();
    expect(within(history).getByRole("tab", { name: "Used and counted" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Feed purchases" })).toBeTruthy();
  });
});
