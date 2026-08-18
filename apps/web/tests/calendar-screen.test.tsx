import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, CalendarEvent, ChoreTemplate, Ulid } from "@galaxy-farm/core";
import type { BreedingRecord } from "@galaxy-farm/module-cattle";

/**
 * `/admin/calendar` (spec §6, §7).
 *
 * Two of issue #31's criteria are only true if the *screen* is true, not just
 * the pure functions underneath it: a projected row has to reach the page at
 * all, and §6's module filter has to work on it. Both are driven here rather
 * than asserted on a helper, because the composition — eighteen live queries
 * feeding six projection functions — is where they would actually break.
 *
 * The date is fixed, because a calendar that renders "this month" renders a
 * different month depending on the day the suite runs.
 *
 * Assertions are scoped to the day panel rather than to the page, because a
 * daily chore genuinely does appear in all thirty-five cells of the grid and
 * a bare `getByText` would find every one of them.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date(2026, 10, 12, 9, 0);

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

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
const { CalendarScreen } =
  await import("../app/(admin)/admin/calendar/_components/calendar-screen.js");

const base = {
  propertyId: PROPERTY,
  createdAt: new Date(2026, 0, 1),
  updatedAt: new Date(2026, 0, 1),
};

const ANDROMEDA = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  species: "cattle",
  name: "Andromeda",
  sex: "female",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

/** Bred 14 February 2026 — due 24 November, watch open from the 10th. */
const BREEDING: BreedingRecord = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5B01" as Ulid,
  damId: ANDROMEDA.id,
  method: "AI",
  sireExternalId: "01ARZ3NDEKTSV4RRFFQ69G5B02" as Ulid,
  date: new Date(2026, 1, 14),
};

const FARRIER: CalendarEvent = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid,
  title: "Farrier coming",
  at: new Date(2026, 10, 12, 15, 0),
  allDay: false,
};

const ICE: ChoreTemplate = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5T01" as Ulid,
  title: "Break ice on the north tank",
  recurrence: "daily",
  recurrenceDays: [],
  active: true,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);

  stored.current = {
    animals: [ANDROMEDA],
    breedingRecords: [BREEDING],
    calendarEvents: [FARRIER],
    choreTemplates: [ICE],
  };
});

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <CalendarScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

/**
 * The panel's own label, spelled the way the screen spells it.
 *
 * Built rather than typed, because both are `toLocaleDateString` and a literal
 * "12 November 2026" would pass in one locale and fail the suite in the next.
 */
const DAY_PANEL = new Date(2026, 10, 12).toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const THIS_MONTH = new Date(2026, 10, 1).toLocaleDateString(undefined, {
  month: "long",
  year: "numeric",
});
const NEXT_MONTH = new Date(2026, 11, 1).toLocaleDateString(undefined, {
  month: "long",
  year: "numeric",
});

describe("the unified calendar screen", () => {
  /** The panel under the grid, after picking the 12th. */
  async function pickTheTwelfth() {
    await userEvent.click(screen.getByRole("button", { name: /^12 / }));
    return within(screen.getByRole("region", { name: DAY_PANEL }));
  }

  it("shows the projected half beside the manual one", async () => {
    view();

    // Nobody typed either of the first two. The window comes from the breeding
    // record plus 283 days — and it covers the 12th although it opened on the
    // 10th, which is the whole reason `endAt` is on the row. The chore comes
    // from a template that fires every day.
    const day = await pickTheTwelfth();

    expect(day.getByText("Andromeda — calving window")).toBeInTheDocument();
    expect(day.getByText("Break ice on the north tank")).toBeInTheDocument();
    expect(day.getByText("Farrier coming")).toBeInTheDocument();
  });

  it("filters by module, on the screen and not only in the function", async () => {
    view();
    await pickTheTwelfth();
    await userEvent.click(screen.getByRole("button", { name: "Cattle" }));

    const cattleOnly = within(screen.getByRole("region", { name: DAY_PANEL }));
    expect(cattleOnly.getByText("Andromeda — calving window")).toBeInTheDocument();
    expect(cattleOnly.queryByText("Break ice on the north tank")).not.toBeInTheDocument();
    expect(cattleOnly.queryByText("Farrier coming")).not.toBeInTheDocument();

    // And back, because a filter you cannot switch off is worse than none.
    await userEvent.click(screen.getByRole("button", { name: "Everything" }));
    expect(
      within(screen.getByRole("region", { name: DAY_PANEL })).getByText("Farrier coming"),
    ).toBeInTheDocument();
  });

  it("offers no edit on a derived row", async () => {
    view();
    const day = await pickTheTwelfth();

    // §4.5: the projected half is a read model. One edit button, for the one
    // row on the day that is a record.
    expect(day.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(day.getAllByText("Derived")).toHaveLength(2);
  });

  it("moves to another month and comes back", async () => {
    view();
    expect(screen.getByText(THIS_MONTH)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(NEXT_MONTH)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText(THIS_MONTH)).toBeInTheDocument();
  });

  it("reads the same rows as an agenda", async () => {
    view();
    await userEvent.click(screen.getByRole("button", { name: "Agenda" }));

    expect(screen.getByText("Farrier coming")).toBeInTheDocument();
    // Already under way when the agenda opens, so it is filed under the first
    // day on the list rather than under a 10 November that is not on screen.
    expect(screen.getByText("Andromeda — calving window")).toBeInTheDocument();
  });
});
