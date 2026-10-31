import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OutboxEntry, QueuedPhoto, Ulid } from "@galaxy-farm/core";

/**
 * The sync pill opens what is behind it (spec §4.2): the state in a sentence,
 * when the device last reached the farm, and each thing still on it.
 */

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  synced: 0,
}));

vi.mock("@/app/_components/sync-provider", () => ({
  useSync: () => state.current,
}));

const { SyncStatus } = await import("../app/(admin)/_components/sync-status.js");
const { ago, entityLabel, waitingItems } = await import("../lib/sync-summary.js");

const NOW = new Date(2026, 9, 29, 9, 0);

function entry(extra: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid,
    operation: "create",
    patch: {
      entity: "weightRecords",
      recordId: "01ARZ3NDEKTSV4RRFFQ69G5R01" as Ulid,
      changes: [{ field: "weightLb", value: 1180, at: NOW, deviceId: "d1" }],
    },
    queuedAt: new Date(NOW.getTime() - 3 * 60_000),
    deviceId: "d1",
    attempts: 0,
    ...extra,
  };
}

function signedIn(outbox: OutboxEntry[], extra: Record<string, unknown> = {}) {
  state.current = {
    offline: false,
    problem: undefined,
    syncing: false,
    pending: outbox.length,
    stuck: outbox.filter((item) => item.attempts >= 8).length,
    lastSyncedAt: new Date(NOW.getTime() - 2 * 60_000),
    store: {
      outbox: { pending: async () => outbox },
      photoQueue: { pending: async () => [] as QueuedPhoto[] },
    },
    syncNow: async () => {
      state.synced += 1;
    },
    retryStuck: async () => {},
    ...extra,
  };
}

describe("the sync pill", () => {
  it("opens the details, and lists what is still on the device", async () => {
    const user = userEvent.setup();
    signedIn([entry()]);
    render(<SyncStatus />);

    await user.click(screen.getByRole("button", { name: /Sync: 1 to send/ }));
    expect(screen.getByRole("dialog", { name: "Sync" })).toBeTruthy();
    expect(screen.getByText(/waiting to go/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Weight record")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(state.synced).toBe(1);
  });

  it("is a quiet dot on a phone when all is well, and still opens", async () => {
    const user = userEvent.setup();
    signedIn([]);
    render(<SyncStatus quiet />);

    await user.click(screen.getByRole("button", { name: /Sync: Up to date/ }));
    expect(screen.getByText(/reached the farm/)).toBeTruthy();
    expect(screen.queryByText("On this device, not yet sent")).toBeNull();
  });

  it("puts what the server refused first, with its reason", async () => {
    const user = userEvent.setup();
    signedIn([
      entry(),
      entry({
        id: "01ARZ3NDEKTSV4RRFFQ69G5E02" as Ulid,
        operation: "update",
        attempts: 8,
        lastError: "Weight must be positive",
        patch: {
          entity: "animals",
          recordId: "01ARZ3NDEKTSV4RRFFQ69G5R02" as Ulid,
          changes: [{ field: "name", value: "Andromeda", at: NOW, deviceId: "d1" }],
        },
      }),
    ]);
    render(<SyncStatus />);

    await user.click(screen.getByRole("button", { name: /1 not sent/ }));
    await waitFor(() => expect(screen.getByText("Animal · Andromeda")).toBeTruthy());
    expect(screen.getByText(/Weight must be positive/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try the set-aside ones again/ })).toBeTruthy();
  });
});

describe("the words", () => {
  it("names a store the way a person would", () => {
    expect(entityLabel("weightRecords")).toBe("Weight record");
    expect(entityLabel("zoneAssignments")).toBe("Move");
    expect(entityLabel("plantings")).toBe("Planting");
    expect(entityLabel("supplyCategories")).toBe("Supply category");
  });

  it("says how long ago", () => {
    expect(ago(new Date(NOW.getTime() - 20_000), NOW)).toBe("just now");
    expect(ago(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 min ago");
    expect(ago(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3 hr ago");
  });

  it("orders set-aside first, then oldest first", () => {
    const items = waitingItems(
      [
        entry({ id: "01ARZ3NDEKTSV4RRFFQ69G5E03" as Ulid }),
        entry({ id: "01ARZ3NDEKTSV4RRFFQ69G5E04" as Ulid, attempts: 9 }),
      ],
      [],
    );
    expect(items.map((item) => item.stuck)).toEqual([true, false]);
  });
});
