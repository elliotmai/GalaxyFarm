import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  endOfDay,
  feedingChoreId,
  type ChoreTemplate,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

/**
 * The Today screen's feeding and chores (spec §7).
 *
 * The lists are the barn kiosk's day sheet, split into feeding and chores, and
 * each ticked line says who and when — the thing somebody away from the place
 * opens the phone to find out. A kiosk tick is attributed to the screen and a
 * phone tick to the person, so both resolve through the same names map.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const PARTNER = "01ARZ3NDEKTSV4RRFFQ69G5FU2" as Ulid;
const KIOSK = "01ARZ3NDEKTSV4RRFFQ69G5FK1" as Ulid;
const STRANGER = "01ARZ3NDEKTSV4RRFFQ69G5FU9" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async () => ({ ok: true, value: {} }),
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
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
  useSyncEngine: () => ({
    store: undefined,
    syncNow: async () => {},
    retryStuck: async () => {},
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { Dashboard } = await import("../app/(admin)/admin/_components/dashboard.js");

const NOW = new Date();
const at = (hour: number, minute: number) => {
  const date = new Date(NOW);
  date.setHours(hour, minute, 0, 0);
  return date;
};
const clock = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const base = (n: number) => ({
  id: `01ARZ3NDEKTSV4RRFFQ69G5${String(n).padStart(3, "0")}` as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const ZONE = {
  ...base(900),
  name: "North Trap",
  type: "pasture",
  indoor: false,
  baselineSafetyLevel: 1,
  waterSourceIds: [],
  resting: false,
  active: true,
} as Zone;

function plan(n: number, name: string): FeedingPlan {
  return {
    ...base(n),
    name,
    target: "animal",
    targetId: base(n + 50).id,
    alsoFeeds: [],
    lines: [
      {
        feedTypeId: base(899).id,
        amount: { amount: 2, unit: "scoop" },
        frequency: "once_daily",
        timeOfDay: "morning",
      },
    ],
    portion: "per_head",
    active: true,
  } as FeedingPlan;
}

function task(n: number, fields: Partial<Task> & Pick<Task, "title">): Task {
  return { ...base(n), dueAt: endOfDay(NOW), ...fields } as Task;
}

const SENIOR = plan(10, "Senior ration");
const SHOW = plan(11, "Show calf ration");

function view(names?: Promise<Record<string, string>>) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <Dashboard propertyId={PROPERTY} actorId={ACTOR} names={names} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

function section(name: string) {
  return screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("section")!;
}

beforeEach(() => {
  stored.current = {
    zones: [ZONE],
    animals: [],
    zoneAssignments: [],
    waterSources: [],
    feedingPlans: [SENIOR, SHOW],
    choreTemplates: [
      {
        ...base(20),
        title: "Collect eggs",
        recurrence: "daily",
        recurrenceDays: [],
        active: true,
      } as ChoreTemplate,
    ],
    tasks: [
      // The senior ration, ticked at the barn kiosk — the row keeps the
      // occurrence's key, which is how it is still a feeding.
      task(30, {
        title: "Senior ration",
        sourceKey: feedingChoreId(
          { target: "animal", targetId: SENIOR.targetId, timeOfDay: "morning" },
          NOW,
        ),
        dueAt: at(11, 0),
        completedAt: at(6, 40),
        completedBy: KIOSK,
      }),
      task(31, { title: "Check Rosie", completedAt: at(7, 5), completedBy: ACTOR }),
      task(32, { title: "Tank covers on", completedAt: at(8, 15), completedBy: PARTNER }),
      task(33, { title: "Oil the gate", completedAt: at(9, 30), completedBy: STRANGER }),
    ],
  };
});

describe("the Today lists", () => {
  it("counts the whole day sheet, the same number the kiosk shows", () => {
    view();

    // Two feedings, one template chore and three written-down chores; four ticked.
    expect(screen.getByText("4 of 6 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  });

  it("splits feeding from chores, the ticked feeding row included", () => {
    view();

    const feeding = within(section("Feeding"));
    expect(feeding.getByText("Senior ration")).toBeInTheDocument();
    expect(feeding.getByText(/Show calf ration/)).toBeInTheDocument();
    expect(feeding.queryByText("Collect eggs")).toBeNull();

    const chores = within(section("Chores"));
    expect(chores.getByText("Collect eggs")).toBeInTheDocument();
    expect(chores.getByText("Check Rosie")).toBeInTheDocument();
    expect(chores.queryByText("Senior ration")).toBeNull();
  });

  it("says who ticked each row and when", async () => {
    view(Promise.resolve({ [PARTNER]: "Sam", [KIOSK]: "Barn kiosk" }));

    expect(await screen.findByText(`Done by Barn kiosk · ${clock(at(6, 40))}`)).toBeInTheDocument();
    expect(screen.getByText(`Done by Sam · ${clock(at(8, 15))}`)).toBeInTheDocument();
    expect(screen.getByText(`Done by You · ${clock(at(7, 5))}`)).toBeInTheDocument();
    // Somebody the names map does not know: the time still stands.
    expect(screen.getByText(`Done · ${clock(at(9, 30))}`)).toBeInTheDocument();
  });

  it("still says when without the names", () => {
    view();

    expect(screen.getByText(`Done · ${clock(at(8, 15))}`)).toBeInTheDocument();
    expect(screen.getByText(`Done by You · ${clock(at(7, 5))}`)).toBeInTheDocument();
  });
});
