import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid, Zone } from "@galaxy-farm/core";

/**
 * What the Today tiles count (spec §2, §7).
 *
 * One Animal model serves cattle, the flock, the pets and the horses, so a
 * count taken off the unfiltered list is a count of the whole menagerie. On a
 * tile labelled "Cattle" that is wrong in the quietest possible way: it reads
 * as a plausible number, nothing downstream disagrees with it, and it is the
 * figure somebody repeats out loud.
 *
 * The pen board below it is deliberately *not* filtered and is asserted that
 * way here — a pen holds whatever is standing in it, and its effective safety
 * level has to account for the horse as much as the cow.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

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
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { Dashboard } = await import("../app/(admin)/admin/_components/dashboard.js");

let count = 0;
function animal(fields: Partial<Animal> & Pick<Animal, "species" | "name">): Animal {
  count += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5${String(count).padStart(3, "0")}` as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...fields,
  } as Animal;
}

/** One zone, so the dashboard renders its tiles rather than the empty state. */
const ZONE = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FZ1" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  name: "North Trap",
  type: "pasture",
  indoor: false,
  baselineSafetyLevel: 1,
  waterSourceIds: [],
  resting: false,
  active: true,
} as Zone;

/** The figure on the tile with this label. */
function tile(label: string): string {
  const heading = screen.getByText(label);
  const value = heading.parentElement?.nextElementSibling;
  return value?.textContent ?? "";
}

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <Dashboard propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = { zones: [ZONE], animals: [], zoneAssignments: [], waterSources: [] };
});

describe("the Cattle tile", () => {
  it("counts the cattle, not the whole menagerie", () => {
    stored.current = {
      ...stored.current,
      animals: [
        animal({ species: "cattle", name: "Andromeda" }),
        animal({ species: "cattle", name: "Cassiopeia" }),
        animal({ species: "chicken", name: "Henrietta" }),
        animal({ species: "dog", name: "Biscuit" }),
        animal({ species: "horse", name: "Comet" }),
        animal({ species: "cat", name: "Mouser" }),
      ],
    };

    view();

    expect(tile("Cattle")).toBe("2");
  });

  it("still leaves out cattle that are no longer here", () => {
    // The species filter is added to the status one, not swapped for it: a
    // sold cow is not standing in a pen this morning.
    stored.current = {
      ...stored.current,
      animals: [
        animal({ species: "cattle", name: "Andromeda" }),
        animal({ species: "cattle", name: "Vega", status: "sold" }),
        animal({ species: "cattle", name: "Rigel", status: "deceased" }),
      ],
    };

    view();

    expect(tile("Cattle")).toBe("1");
  });

  it("reads zero on a place with no cattle but plenty of animals", () => {
    stored.current = {
      ...stored.current,
      animals: [
        animal({ species: "chicken", name: "Henrietta" }),
        animal({ species: "dog", name: "Biscuit" }),
      ],
    };

    view();

    expect(tile("Cattle")).toBe("0");
  });
});

describe("the pen board", () => {
  it("shows a pen as occupied whatever species is standing in it", () => {
    // Deliberately not species-filtered. A pen holds what it holds, and the
    // effective safety level has to account for the horse as much as the cow.
    const comet = animal({ species: "horse", name: "Comet", safetyLevel: 4 });
    stored.current = {
      ...stored.current,
      animals: [comet],
      zoneAssignments: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid,
          propertyId: PROPERTY,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
          animalId: comet.id,
          zoneId: ZONE.id,
          periodFrom: new Date("2026-01-01"),
          indoor: false,
        },
      ],
    };

    view();

    expect(screen.getByText("1 in use")).toBeInTheDocument();
    expect(tile("Cattle")).toBe("0");
  });
});
