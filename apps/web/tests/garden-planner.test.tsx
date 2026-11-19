import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import type { Bed, Crop, FrostDates, Variety } from "@galaxy-farm/module-garden";

/** Plan my garden: a wish list in, a season plan out (spec §5.5). */

const writes = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }));
vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      const id = `01ARZ3NDEKTSV4RRFFQ69G5H${String(writes.created.length).padStart(2, "0")}`;
      writes.created.push({ store, ...input });
      return { ok: true, value: { id, ...input } };
    },
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

const { ToastProvider } = await import("@galaxy-farm/ui");
const { GardenPlanner } =
  await import("../app/(admin)/admin/garden/plantings/_components/garden-planner.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date(2027, 0, 10);
const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };

const TOMATO = { ...base, id: "01ARZ3NDEKTSV4RRFFQ69G5C01", name: "Tomato" } as unknown as Crop;
const CHEROKEE = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5V01",
  cropId: TOMATO.id,
  name: "Cherokee Purple",
} as unknown as Variety;
const BEDS = [1, 2].map(
  (n) =>
    ({
      ...base,
      id: `01ARZ3NDEKTSV4RRFFQ69G5B0${n}`,
      name: `Bed ${n}`,
      lengthFt: 8,
      widthFt: 4,
      active: true,
    }) as unknown as Bed,
);
const frostFor = (year: number): FrostDates => ({
  lastSpringFrost: new Date(year, 3, 15),
  firstFallFrost: new Date(year, 9, 15),
  growingDays: 183,
});

beforeEach(() => {
  writes.created = [];
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function view(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <GardenPlanner
        varieties={[CHEROKEE]}
        crops={[TOMATO]}
        beds={BEDS}
        plantings={[]}
        plans={[]}
        planned={[]}
        frostFor={frostFor}
        propertyId={PROPERTY}
        actorId={ACTOR}
        onClose={onClose}
        now={NOW}
      />
    </ToastProvider>,
  );
  return { dialog: within(screen.getByRole("dialog")), onClose };
}

describe("Plan my garden", () => {
  it("goes from a wish list to dated plan entries with beds", async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = view();

    // One of your own plants, one tap.
    await user.click(dialog.getByRole("button", { name: "+ Cherokee Purple" }));
    // And one the garden has not got yet, found by name.
    await user.type(dialog.getByLabelText("Add something to grow"), "jalapeno");
    await user.click(
      within(dialog.getByRole("list", { name: "Plants to add" })).getByRole("button", {
        name: /^Jalapeño pepper/,
      }),
    );
    // The first step is only names: no counts, no methods yet.
    const list = within(dialog.getByRole("list", { name: "To grow" }));
    expect(list.getByRole("listitem", { name: "Jalapeño pepper" })).toBeInTheDocument();
    expect(dialog.queryByLabelText("How many")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Start from")).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Next" }));
    const how = within(dialog.getByRole("list", { name: "How much of each" }));
    expect(how.getByRole("listitem", { name: "Jalapeño pepper" })).toHaveTextContent(
      /added to your ideas when saved/,
    );
    // Started from seed indoors unless said otherwise.
    expect(
      within(how.getByRole("listitem", { name: "Cherokee Purple" })).getByLabelText("Start from"),
    ).toHaveValue("indoor_start");

    await user.click(dialog.getByRole("button", { name: "Next: which years" }));
    await user.click(dialog.getByRole("button", { name: "2028" }));
    await user.click(dialog.getByRole("button", { name: "Next: see the plan" }));

    // Each year, each plant: what, when, which bed.
    const year1 = within(dialog.getByRole("region", { name: "2027" }));
    const tomato = year1.getByRole("listitem", { name: "Cherokee Purple spring 2027" });
    expect(tomato).toHaveTextContent(/Start indoors (Feb 25|25 Feb)/);
    expect(tomato).toHaveTextContent(/Transplant/);
    expect(tomato).toHaveTextContent(/Pick/);
    // Two nightshades together in one bed in 2027, and moved on in 2028.
    const bed2027 = within(tomato).getByLabelText("Bed");
    const year2 = within(dialog.getByRole("region", { name: "2028" }));
    const bed2028 = within(
      year2.getByRole("listitem", { name: "Cherokee Purple spring 2028" }),
    ).getByLabelText("Bed");
    expect(bed2027).not.toHaveValue("");
    expect(bed2028).not.toHaveValue((bed2027 as HTMLSelectElement).value);

    await user.click(dialog.getByRole("button", { name: "Save the plan" }));

    const stores = writes.created.map((row) => row["store"]);
    // The jalapeño is added as a plant (and a pepper to grow like), then a
    // plan per year, then four entries: two plants × two years.
    expect(stores).toEqual([
      "crops",
      "varieties",
      "seasonPlans",
      "seasonPlans",
      "plannedPlantings",
      "plannedPlantings",
      "plannedPlantings",
      "plannedPlantings",
    ]);
    expect(writes.created[1]).toMatchObject({ name: "Jalapeño pepper", daysToMaturity: 70 });
    expect(writes.created[2]).toMatchObject({ name: "2027 garden", year: 2027, active: true });
    const entries = writes.created.filter((row) => row["store"] === "plannedPlantings");
    expect(entries[0]).toMatchObject({ method: "indoor_start", planStatus: "open" });
    expect(entries.every((entry) => entry["bedId"] !== undefined)).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("starts with every idea on the list when opened from Plan these", () => {
    render(
      <ToastProvider>
        <GardenPlanner
          varieties={[CHEROKEE]}
          crops={[TOMATO]}
          beds={BEDS}
          plantings={[]}
          plans={[]}
          planned={[]}
          frostFor={frostFor}
          propertyId={PROPERTY}
          actorId={ACTOR}
          onClose={vi.fn()}
          now={NOW}
          startWith={[CHEROKEE]}
        />
      </ToastProvider>,
    );
    const list = within(screen.getByRole("list", { name: "To grow" }));
    expect(list.getByRole("listitem", { name: "Cherokee Purple" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});
