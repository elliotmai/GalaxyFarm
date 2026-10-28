import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PastureCareLog, Ulid, WaterSource, Zone } from "@galaxy-farm/core";

/**
 * `/admin/pastures` (spec §5.1, §7), after the calm redesign.
 *
 * The screen moved from tables and record cards to rows with one quick action
 * each, and its forms moved into side panels. What this pins is that nothing
 * was lost on the way: the one-tap toggles still write, delete is still
 * reachable and still confirmed, and the status that used to be four tiles is
 * said when — and only when — there is something to do.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
// Mid-October: inside the overseeding window, so a pasture never overseeded is due.
const NOW = new Date("2026-10-15T12:00:00Z");

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
const writes = vi.hoisted(() => ({
  updated: [] as { store: string; id: string; patch: Record<string, unknown> }[],
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
      return { ok: true, value: input };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      writes.updated.push({ store, id, patch });
      return { ok: true, value: patch };
    },
    remove: async (id: string) => {
      writes.removed.push({ store, id });
      return { ok: true, value: {} };
    },
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { LandScreen } = await import("../app/(admin)/admin/pastures/_components/land-screen.js");

const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };
const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

const NORTH: Zone = {
  ...base,
  id: id(1),
  name: "North",
  type: "area",
  indoor: false,
  baselineSafetyLevel: 2,
  waterSourceIds: [],
  resting: false,
  active: true,
} as Zone;

const TRAP: Zone = {
  ...NORTH,
  id: id(2),
  name: "North Trap",
  type: "pasture",
  parentZoneId: NORTH.id,
  waterSourceIds: [id(10)],
} as Zone;

const TANK: WaterSource = {
  ...base,
  id: id(10),
  name: "Trap tank",
  type: "static_tank",
  hasHeater: false,
  cover: "off",
  active: true,
} as WaterSource;

function view() {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <LandScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  writes.updated = [];
  writes.created = [];
  writes.removed = [];
  stored.current = {
    zones: [NORTH, TRAP],
    waterSources: [TANK],
    pastureCareLogs: [] as PastureCareLog[],
    zoneAssignments: [],
    animals: [],
  };
});

describe("the header", () => {
  it("says facts beside the title and one line per thing to do", () => {
    view();

    // The area is a heading, not a fifth place to walk to.
    expect(screen.getByText("1 zone · 1 tank out")).toBeInTheDocument();
    expect(screen.getByText(/1 seasonal job due now/)).toBeInTheDocument();
    expect(screen.getByText(/1 cover to put on before the next hard freeze/)).toBeInTheDocument();
  });

  it("says nothing when nothing is owed", () => {
    stored.current["waterSources"] = [{ ...TANK, cover: "on" }];
    stored.current["zones"] = [NORTH, { ...TRAP, type: "pen" }];
    view();

    expect(screen.queryByText(/due now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/to put on/)).not.toBeInTheDocument();
  });
});

describe("zones", () => {
  it("rests a zone in one tap from its row", async () => {
    const user = userEvent.setup();
    view();

    const list = within(screen.getByRole("list", { name: "Zones in North" }));
    await user.click(list.getByRole("button", { name: "Rest North Trap" }));

    expect(writes.updated).toContainEqual({
      store: "zones",
      id: TRAP.id,
      patch: { resting: true },
    });
  });

  it("filters by group with a chip, and says so", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /^North 1$/, pressed: false }));

    expect(screen.getByRole("button", { name: /^North 1$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Showing 1 of 1")).toBeInTheDocument();
  });

  it("keeps delete in the editor, behind the typed confirmation", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: "Edit North Trap" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Typed tier: nothing is removed until the name is typed.
    expect(writes.removed).toEqual([]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("water", () => {
  it("puts a cover on in one tap", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("tab", { name: "Water" }));
    await user.click(screen.getByRole("button", { name: "Put the cover on Trap tank" }));

    expect(writes.updated).toContainEqual({
      store: "waterSources",
      id: TANK.id,
      patch: { cover: "on" },
    });
  });
});

describe("pasture care", () => {
  it("logs the due job from its row, in a panel that stays open for the next", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("tab", { name: "Care log" }));
    await user.click(
      screen.getByRole("button", { name: "Log Overseed winter rye for North Trap" }),
    );
    await user.click(screen.getByRole("button", { name: "Log it" }));

    expect(writes.created).toHaveLength(1);
    expect(writes.created[0]).toMatchObject({
      store: "pastureCareLogs",
      zoneId: TRAP.id,
      action: "overseed",
    });
    expect(screen.getByRole("button", { name: "Log it" })).toBeInTheDocument();
  });
});
