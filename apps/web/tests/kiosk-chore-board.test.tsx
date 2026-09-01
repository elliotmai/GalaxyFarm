import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Task, Ulid, Zone } from "@galaxy-farm/core";

/**
 * The compact kiosk chore board (spec §4.4, §5.1, §5.10).
 *
 * Today's Chores and Housesitter Mode render the same day through the same
 * component, and the thing worth pinning down is the shape it renders in: a
 * day laid out as columns of one-line rows, not a column of cards. A card per
 * chore reads well with four chores and scrolls the evening round off the
 * screen with fourteen — which on a barn screen is the evening round not
 * happening.
 *
 * The tick is asserted the way a gloved hand meets it: the row moves on the
 * tap, before the server action has answered. That is the whole reason the
 * board keeps its own overrides, and a regression to "wait for the round
 * trip" would leave every assertion below passing except this one.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const NOW = new Date(2026, 10, 12, 9, 0);

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
/** Resolved by hand, so the gap between the tap and the answer is inspectable. */
const action = vi.hoisted(() => ({
  calls: [] as unknown[],
  resolve: undefined as ((result: { ok: boolean; error?: string }) => void) | undefined,
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/app/_components/sync-provider", () => ({
  useSyncEngine: () => ({ store: {}, syncNow: async () => {}, retryStuck: async () => {} }),
}));

vi.mock("@/app/(kiosk)/kiosk/_actions", () => ({
  setKioskChoreDone: (input: unknown) => {
    action.calls.push(input);
    return new Promise((resolve) => {
      action.resolve = resolve as (result: { ok: boolean; error?: string }) => void;
    });
  },
}));

const { ToastProvider } = await import("@galaxy-farm/ui");
const { ChoresBoardScreen } = await import("../app/(kiosk)/kiosk/chores/chores-board-screen.js");

const base = {
  propertyId: PROPERTY,
  createdAt: new Date(2026, 0, 1),
  updatedAt: new Date(2026, 0, 1),
};

const NORTH = { ...base, id: "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid, name: "North pasture" } as Zone;
const ANDROMEDA = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  species: "cattle",
  name: "Andromeda",
} as Animal;

/** Due at eight, so it is already late at nine. */
const ICE = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5T01" as Ulid,
  title: "Break ice on the north tank",
  dueAt: new Date(2026, 10, 12, 8, 0),
  zoneId: NORTH.id,
} as Task;

/** Evening, and long enough to need the expander. */
const RINSE = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5T02" as Ulid,
  title: "Rinse and blow out",
  detail: "Warm water only, then the blower on cool until she is dry to the skin.",
  dueAt: new Date(2026, 10, 12, 18, 0),
  animalId: ANDROMEDA.id,
} as Task;

const SCRATCH = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5T03" as Ulid,
  title: "Scratch grain to the hens",
  dueAt: new Date(2026, 10, 12, 8, 30),
  completedAt: new Date(2026, 10, 12, 8, 40),
} as Task;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);

  action.calls = [];
  action.resolve = undefined;
  stored.current = { tasks: [ICE, RINSE, SCRATCH], zones: [NORTH], animals: [ANDROMEDA] };
});

function view() {
  return render(
    <ToastProvider>
      <ChoresBoardScreen propertyId={PROPERTY} />
    </ToastProvider>,
  );
}

/** The section column with this heading, as a query scope. */
function section(label: string) {
  const heading = screen.getByRole("heading", { name: label });
  return within(heading.closest("section") as HTMLElement);
}

describe("Today's Chores on a kiosk", () => {
  it("lays the day out as parts of the day, not one long list", () => {
    view();

    expect(screen.getByRole("heading", { name: "Morning" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evening" })).toBeInTheDocument();

    // Each part says what is left in it, so a glance across the columns is
    // the whole day without reading a single row.
    expect(section("Morning").getByText("1 to do")).toBeInTheDocument();
    expect(section("Evening").getByText("1 to do")).toBeInTheDocument();
  });

  it("gives each chore one row rather than a card and a full-width button", () => {
    view();

    // The row is the button. A separate "Done" beneath a card is what this
    // board replaced, and its absence is the compaction.
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();

    const row = screen.getByRole("button", { name: /Break ice on the north tank/ });
    expect(row).toHaveAttribute("aria-pressed", "false");
    // Where it happens rides the row itself.
    expect(row).toHaveTextContent("North pasture");
    // And so does being late — due at eight, read at nine.
    expect(row).toHaveTextContent("late");
  });

  it("names the animal a chore is about, not just the pen it stands in", () => {
    view();

    expect(screen.getByRole("button", { name: /Rinse and blow out/ })).toHaveTextContent(
      "Andromeda",
    );
  });

  it("counts the day in one line instead of spending a row on a meter", () => {
    view();

    expect(screen.getByText(/1 of 3 done/)).toBeInTheDocument();
    expect(screen.getByText(/1 late/)).toBeInTheDocument();
  });

  it("sinks a finished chore to the bottom of its own part of the day", () => {
    view();

    const morning = section("Morning")
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");

    expect(morning[0]).toMatch(/Break ice/);
    expect(morning[1]).toMatch(/Scratch grain/);
  });

  it("moves the row on the tap rather than after the round trip", async () => {
    view();

    const row = screen.getByRole("button", { name: /Break ice on the north tank/ });
    await userEvent.click(row);

    // Ticked here, with the server action still unanswered.
    expect(action.resolve).toBeDefined();
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(action.calls).toEqual([{ taskId: ICE.id, day: "2026-11-12", done: true }]);
  });

  it("puts the tick back when the farm refuses the write", async () => {
    view();

    const row = screen.getByRole("button", { name: /Break ice on the north tank/ });
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");

    action.resolve?.({ ok: false, error: "This screen has been unpaired." });

    expect(await screen.findByText("This screen has been unpaired.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Break ice on the north tank/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("opens a long instruction without counting that as doing it", async () => {
    view();

    await userEvent.click(screen.getByRole("button", { name: "Show the whole detail" }));

    expect(screen.getByText(/Warm water only/)).toBeInTheDocument();
    // Reading is not ticking: nothing was written, and the row is still open.
    expect(action.calls).toEqual([]);
    expect(screen.getByRole("button", { name: /Rinse and blow out/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
