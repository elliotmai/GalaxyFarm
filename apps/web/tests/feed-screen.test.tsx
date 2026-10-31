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
const PLAN_2 = "01ARZ3NDEKTSV4RRFFQ69G5P02" as Ulid;
const PEPPER = "01ARZ3NDEKTSV4RRFFQ69G5A02" as Ulid;

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

/** A second horse, for rations that feed more than one. */
function pepper() {
  return {
    ...base(PEPPER),
    name: "Pepper",
    species: "horse",
    sex: "female",
    status: "active",
    ownership: "owned",
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

  it("adjusts a shared bowl here without dropping the second animal off it", async () => {
    const user = userEvent.setup();
    farm();
    const plans = stored.current["feedingPlans"] as Record<string, unknown>[];
    stored.current = {
      ...stored.current,
      animals: [...(stored.current["animals"] ?? []), pepper()],
      feedingPlans: [{ ...plans[0], alsoFeeds: [PEPPER], portion: "shared" }],
    };
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="plan" />);

    // One ration, both of them as its detail.
    const card = screen.getByRole("region", { name: "Biscuit's hay" });
    expect(within(card).getByText("Biscuit, Pepper")).toBeTruthy();

    await user.click(within(card).getByRole("button", { name: "Adjust Biscuit's hay" }));
    const panel = screen.getByRole("dialog", { name: "Edit Biscuit's hay" });
    expect((within(panel).getByLabelText("Pepper") as HTMLInputElement).checked).toBe(true);

    await user.click(within(panel).getByRole("button", { name: "Save changes" }));
    // The editor used to write `alsoFeeds: []` on every save.
    expect(saved.updated[0]).toMatchObject({
      id: PLAN,
      patch: { targetId: BISCUIT, alsoFeeds: [PEPPER], portion: "shared" },
    });
  });

  it("writes one plan for several animals", async () => {
    const user = userEvent.setup();
    farm();
    stored.current = {
      ...stored.current,
      animals: [...(stored.current["animals"] ?? []), pepper()],
    };
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="plan" />);

    await user.click(screen.getAllByRole("button", { name: /Add plan/ })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Add a plan" });
    await user.type(within(panel).getByLabelText(/^Plan name/), "Morning hay");
    await user.selectOptions(within(panel).getByLabelText(/^Feeds/), "animal");
    await user.selectOptions(within(panel).getByLabelText(/^Animal/), BISCUIT);
    await user.click(within(panel).getByLabelText("Pepper"));
    await user.selectOptions(within(panel).getByLabelText(/^Feed(?!s)/), HAY);
    await user.type(within(panel).getByLabelText(/^Amount/), "0.5");
    await user.click(within(panel).getByRole("button", { name: "Add plan" }));

    expect(saved.created[0]).toMatchObject({
      name: "Morning hay",
      target: "animal",
      targetId: BISCUIT,
      alsoFeeds: [PEPPER],
    });
  });

  it("lists a ration written twice once, with everybody it feeds as the detail", async () => {
    const user = userEvent.setup();
    farm();
    const plans = stored.current["feedingPlans"] as Record<string, unknown>[];
    stored.current = {
      ...stored.current,
      animals: [...(stored.current["animals"] ?? []), pepper()],
      feedingPlans: [...plans, { ...plans[0], id: PLAN_2, name: "Pepper's hay", targetId: PEPPER }],
    };
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="plan" />);

    // Named differently, fed the same: one card, titled by what is in it.
    const cards = screen.getAllByRole("region");
    expect(cards).toHaveLength(1);
    const card = screen.getByRole("region", { name: "Grass hay" });
    expect(within(card).getByText("Biscuit · Pepper")).toBeTruthy();
    expect(within(card).getAllByText("0.5 round bale")).toHaveLength(1);

    // Still two records, each adjusted on its own.
    await user.click(within(card).getByRole("button", { name: "Adjust Pepper's hay (Pepper)" }));
    expect(screen.getByRole("dialog", { name: "Edit Pepper's hay" })).toBeTruthy();
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

  it("offers Add a feed when the shed already has feed in it", async () => {
    const user = userEvent.setup();
    farm();
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="shed" />);

    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    const panel = screen.getByRole("dialog", { name: "Add a feed" });
    await user.type(within(panel).getByLabelText(/^Name/), "Sweet feed");
    // The lead time is not required: blank is a week.
    await user.clear(within(panel).getByLabelText(/^Reorder lead/));
    await user.click(within(panel).getByRole("button", { name: "Add feed" }));

    expect(saved.created[0]).toMatchObject({ name: "Sweet feed", reorderLeadDays: 7 });
  });

  it("records a purchase with no price as unpriced, not as $0", async () => {
    const user = userEvent.setup();
    farm();
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="shed" />);

    await user.click(screen.getByRole("button", { name: "Restock Grass hay" }));
    const panel = screen.getByRole("dialog", { name: "Record a purchase" });
    expect((within(panel).getByLabelText(/^Cost each/) as HTMLInputElement).required).toBe(false);
    await user.type(within(panel).getByLabelText(/^Quantity/), "3");
    await user.click(within(panel).getByRole("button", { name: "Record purchase" }));

    expect(saved.created[0]).toMatchObject({ feedTypeId: HAY, quantity: 3 });
    expect(saved.created[0]?.["unitCost"]).toBeUndefined();
  });

  it("says an unpriced purchase has no price, and counts it in the shed", async () => {
    const user = userEvent.setup();
    farm();
    const purchases = stored.current["feedPurchases"] as Record<string, unknown>[];
    stored.current = {
      ...stored.current,
      feedPurchases: [{ ...purchases[0], unitCost: undefined }],
    };
    wrap(<FeedScreen propertyId={PROPERTY} actorId={ACTOR} initialView="shed" />);

    const shed = screen.getByRole("list", { name: "In the shed" });
    expect(within(shed).getByText(/2 round bale/)).toBeTruthy();

    await user.click(screen.getByText("History"));
    const list = screen.getByRole("list", { name: "Feed purchases" });
    expect(within(list).getByText("no price")).toBeTruthy();
    expect(within(list).queryByText(/\$0/)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Cost per head" }));
    expect(screen.getByText(/No cost yet/)).toBeTruthy();
    expect(screen.getAllByText("Missing a cost").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
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
