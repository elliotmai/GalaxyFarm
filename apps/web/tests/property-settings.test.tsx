import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Property, Ulid, Zone } from "@galaxy-farm/core";

/**
 * Moving (spec §5.1, §7 `/admin/settings`).
 *
 * Moving is deliberately *not* a second property, and these tests are mostly
 * about holding that line. The same herd, the same records, the same history —
 * a calf born at the old place is still that calf — so the property row is
 * edited in place and nothing is re-parented.
 *
 * The one thing that does not come with you is the ground. A pen is physical:
 * it should stop being offered the moment you leave, and it must keep the
 * history of everything that stood in it. So it is retired, not deleted, and
 * the test that matters here is that no delete goes anywhere near it.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
}));
const written = vi.hoisted(() => ({
  updated: [] as { store: string; id: string; patch: Record<string, unknown> }[],
  removed: [] as { store: string; id: string }[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: unknown) => ({ ok: true, value: input }),
    update: async (id: string, patch: Record<string, unknown>) => {
      written.updated.push({ store, id, patch });
      return { ok: true, value: patch };
    },
    remove: async (id: string) => {
      written.removed.push({ store, id });
      return { ok: true, value: {} };
    },
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings",
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
  // The badge reads the status; everything else reads the store and the
  // controls, which is the whole reason those are two contexts.
  useSyncEngine: () => ({
    store: undefined,
    syncNow: async () => {},
    retryStuck: async () => {},
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { PropertyScreen } =
  await import("../app/(admin)/admin/settings/_components/property-screen.js");

const property = (overrides: Partial<Property> = {}): Property =>
  ({
    id: PROPERTY,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    name: "Home Place",
    timezone: "America/Chicago",
    address: "1220 County Road 4651, Rhome TX 76078",
    latitude: 33.05,
    longitude: -97.47,
    ...overrides,
  }) as Property;

let zoneCount = 0;
const zone = (name: string, active = true): Zone => {
  zoneCount += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5FZ${zoneCount}` as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    name,
    type: "pasture",
    indoor: false,
    baselineSafetyLevel: 1,
    waterSourceIds: [],
    resting: false,
    active,
  } as Zone;
};

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <PropertyScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = { properties: [property()], zones: [] };
  written.updated = [];
  written.removed = [];
});

describe("the place", () => {
  it("edits the property in place rather than creating another", async () => {
    const user = userEvent.setup();
    view();

    const field = screen.getByLabelText(/^Property name/);
    await user.clear(field);
    await user.type(field, "The Rhome place");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(written.updated).toHaveLength(1));
    expect(written.updated[0]).toMatchObject({ store: "properties", id: PROPERTY });
    expect(written.updated[0]?.patch["name"]).toBe("The Rhome place");
  });

  it("carries the timezone, which is what a move across a state line changes", async () => {
    const user = userEvent.setup();
    view();

    const field = screen.getByLabelText(/^Timezone/);
    await user.clear(field);
    await user.type(field, "America/Denver");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(written.updated).toHaveLength(1));
    expect(written.updated[0]?.patch["timezone"]).toBe("America/Denver");
  });

  it("starts from what is stored and has nothing to save until it changes", () => {
    view();

    expect(screen.getByLabelText(/^Property name/)).toHaveValue("Home Place");
    expect(screen.getByLabelText(/^Timezone/)).toHaveValue("America/Chicago");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("refuses a blank name and writes nothing", async () => {
    const user = userEvent.setup();
    view();

    const field = screen.getByLabelText(/^Property name/);
    await user.clear(field);
    await user.type(field, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The property needs a name");
    expect(written.updated).toHaveLength(0);
  });

  it("says so plainly when the property has not synced yet", () => {
    stored.current = { properties: [], zones: [] };
    view();

    expect(screen.getByText(/not on the device yet/i)).toBeInTheDocument();
  });
});

describe("the ground you left behind", () => {
  it("retires a zone rather than deleting it", async () => {
    // The assertion that matters. A zone carries every assignment, care log
    // and feeding plan written against it; deleting it to tidy up after a move
    // takes "where was she in the spring" with it.
    stored.current = { properties: [property()], zones: [zone("North Trap")] };
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => expect(written.updated).toHaveLength(1));
    expect(written.updated[0]).toMatchObject({ store: "zones" });
    expect(written.updated[0]?.patch).toEqual({ active: false });
    expect(written.removed).toEqual([]);
  });

  it("brings a retired zone back", async () => {
    stored.current = { properties: [property()], zones: [zone("Old Barn Lot", false)] };
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: "Bring back" }));

    await waitFor(() => expect(written.updated).toHaveLength(1));
    expect(written.updated[0]?.patch).toEqual({ active: true });
  });

  it("keeps the two lists apart", async () => {
    stored.current = {
      properties: [property()],
      zones: [zone("North Trap"), zone("Old Barn Lot", false)],
    };
    const user = userEvent.setup();
    view();

    // One of each, and each against the right zone — a list that offered
    // "Retire" on ground already retired would be the way to notice the two
    // filters had been crossed.
    expect(screen.getAllByRole("button", { name: "Retire" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Bring back" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => expect(written.updated).toHaveLength(1));
    const retiredId = stored.current["zones"]?.find(
      (row) => (row as Zone).name === "North Trap",
    ) as Zone;
    expect(written.updated[0]?.id).toBe(retiredId.id);
  });

  it("offers nothing to retire when there is no ground in use", () => {
    stored.current = { properties: [property()], zones: [zone("Old Barn Lot", false)] };
    view();

    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument();
    expect(screen.getByText(/No zones in use/i)).toBeInTheDocument();
  });
});
