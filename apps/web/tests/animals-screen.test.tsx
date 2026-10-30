import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * The Animals list (V2 Animals).
 *
 * One list across species. Pinned: every species shows up with a chip that
 * counts it, a flock is one row counted from its log, rows go to each
 * species' own screen, and Select hands the picked ids to the Log flow in the
 * `?animals=` contract it reads.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

// The view lives in the address bar, so the router is a little store the
// screen re-reads when `replace` changes it.
const address = vi.hoisted(() => ({
  query: "",
  listeners: new Set<() => void>(),
}));

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (listener: () => void) => {
            address.listeners.add(listener);
            return () => address.listeners.delete(listener);
          },
          () => address.query,
        ),
      ),
    useRouter: () => ({
      replace: (href: string) => {
        address.query = href.split("?")[1] ?? "";
        for (const listener of address.listeners) listener();
      },
      push: () => {},
    }),
  };
});

const { AnimalsScreen } =
  await import("../app/(admin)/admin/animals/_components/animals-screen.js");

function animal(id: string, fields: Partial<Animal>): Animal {
  return {
    id: id as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 2,
    photoKeys: [],
    ...fields,
  } as Animal;
}

const ROSIE = animal("01ARZ3NDEKTSV4RRFFQ69G5A01", { name: "Rosie", tagNumber: "214" });
const BISCUIT = animal("01ARZ3NDEKTSV4RRFFQ69G5A02", { name: "Biscuit", species: "horse" });
const SCOUT = animal("01ARZ3NDEKTSV4RRFFQ69G5A03", { name: "Scout", species: "dog", sex: "male" });
const SOLD = animal("01ARZ3NDEKTSV4RRFFQ69G5A04", { name: "Gone", status: "sold" });
const FLOCK = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5F01" as Ulid,
  propertyId: PROPERTY,
  name: "Layers",
  species: "chicken",
  openingCount: 18,
  active: true,
};

beforeEach(() => {
  address.query = "";
  stored.current = {
    animals: [ROSIE, BISCUIT, SCOUT, SOLD],
    flocks: [FLOCK],
    flockAdjustments: [],
  };
});

describe("the Animals list", () => {
  it("lists every species, with a chip that counts each", async () => {
    const user = userEvent.setup();
    render(<AnimalsScreen propertyId={PROPERTY} />);

    const list = screen.getByRole("list", { name: "Animals on this property" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /All\s*4/ })).toBeTruthy();
    expect(screen.getByText("18 birds")).toBeTruthy();

    // Rows go to each species' own screen.
    expect(screen.getByRole("link", { name: /Rosie/ }).getAttribute("href")).toBe(
      "/admin/cattle/214",
    );
    expect(screen.getByRole("link", { name: /Biscuit/ }).getAttribute("href")).toBe(
      "/admin/horses/biscuit",
    );
    expect(screen.getByRole("link", { name: /Scout/ }).getAttribute("href")).toBe(
      "/admin/pets/scout",
    );
    expect(screen.getByRole("link", { name: /Layers/ }).getAttribute("href")).toBe(
      "/admin/chickens/flock/layers",
    );

    await user.click(screen.getByRole("button", { name: /Pets\s*1/ }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/Showing 1 of 4/)).toBeTruthy();

    // The sold cow is folded away, not lost.
    await user.click(screen.getByRole("button", { name: "Show 1 no longer here" }));
    await user.click(screen.getByRole("button", { name: /All\s*5/ }));
    expect(screen.getByText("Gone")).toBeTruthy();
  });

  it("searches by name or tag", async () => {
    const user = userEvent.setup();
    render(<AnimalsScreen propertyId={PROPERTY} />);

    await user.type(screen.getByLabelText("Find an animal"), "214");
    const list = screen.getByRole("list", { name: "Animals on this property" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Rosie")).toBeTruthy();
  });

  it("selects several and hands them to the Log", async () => {
    const user = userEvent.setup();
    render(<AnimalsScreen propertyId={PROPERTY} />);

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByText("Log for them").getAttribute("aria-disabled")).toBe("true");

    // A flock is not an animal the Log can take, so it is not offered.
    expect(screen.queryByRole("checkbox", { name: "Layers" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Rosie" }));
    await user.click(screen.getByRole("checkbox", { name: "Biscuit" }));
    expect(screen.getByRole("checkbox", { name: "Rosie" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log for them" }).getAttribute("href")).toBe(
      `/admin/log?animals=${ROSIE.id},${BISCUIT.id}&from=%2Fadmin%2Fanimals`,
    );
  });
});

describe("filtering and grouping", () => {
  const PASTURE = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid,
    name: "Pasture 3",
    indoor: false,
    active: true,
  };
  const BARN = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5Z02" as Ulid,
    name: "Barn",
    indoor: true,
    active: true,
  };
  const BULL = animal("01ARZ3NDEKTSV4RRFFQ69G5A05", { name: "Duke", sex: "male" });
  const placed = (id: string, animalId: Ulid, zoneId: Ulid) => ({
    id,
    propertyId: PROPERTY,
    animalId,
    zoneId,
    slot: "outside",
    periodFrom: new Date("2026-01-02"),
  });

  beforeEach(() => {
    stored.current = {
      animals: [ROSIE, BULL, SCOUT],
      zones: [PASTURE, BARN],
      // Rosie is on the pasture and shut in the barn tonight; Duke is nowhere.
      zoneAssignments: [
        placed("01ARZ3NDEKTSV4RRFFQ69G5P01", ROSIE.id, PASTURE.id),
        { ...placed("01ARZ3NDEKTSV4RRFFQ69G5P02", ROSIE.id, BARN.id), slot: "inside" },
      ],
      flocks: [],
      flockAdjustments: [],
    };
  });

  it("names both places on a row, and finds her by either", async () => {
    const user = userEvent.setup();
    render(<AnimalsScreen propertyId={PROPERTY} />);

    expect(screen.getByText(/Pasture 3 · inside Barn/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Filter & group/ }));
    await user.selectOptions(screen.getByLabelText("Where"), BARN.id);
    expect(address.query).toBe(`where=${BARN.id}`);
    const list = screen.getByRole("list", { name: "Animals on this property" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Rosie")).toBeTruthy();
  });

  it("narrows by sex, and groups by where with the unplaced last", async () => {
    const user = userEvent.setup();
    render(<AnimalsScreen propertyId={PROPERTY} />);

    await user.click(screen.getByRole("button", { name: /Filter & group/ }));
    await user.selectOptions(screen.getByLabelText("Sex"), "male");
    await user.selectOptions(screen.getByLabelText("Group by"), "where");

    expect(screen.queryByRole("list", { name: "Pasture 3" })).toBeNull();
    const unplaced = screen.getByRole("list", { name: "Not placed" });
    expect(
      within(unplaced)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining("Duke"), expect.stringContaining("Scout")]);
    expect(screen.getByText(/Grouped by where/)).toBeTruthy();
  });
});
