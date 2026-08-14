import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * Every animal picker offers one species (spec §2, §7).
 *
 * One Animal model serves cattle, the flock, the pets and the horses, so the
 * store hands every screen the whole menagerie. That is the right shape for the
 * data and the wrong shape for a dropdown: the Cattle section's pickers were
 * offering the dogs and the hens, and picking one wrote a weight, a sale or a
 * pairing against an animal it makes no sense for. Nothing downstream catches
 * it — a dressing percentage on a barn cat is a number like any other.
 *
 * So each picker is asserted on what it *offers*, not on what it saves. The
 * ones with a legitimate escape hatch — a record already written against
 * another species — are asserted to keep it, because a filter that hides the
 * value a form opened with blanks the field and moves the record on save.
 */

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: (store: string, id: string | undefined) => ({
    record: (stored.current[store] ?? []).find((r) => (r as { id: string }).id === id),
    loading: false,
  }),
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
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/cattle",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { SalesScreen } =
  await import("../app/(admin)/admin/cattle/sales/_components/sales-screen.js");
const { WeightsScreen } =
  await import("../app/(admin)/admin/cattle/weights/_components/weights-screen.js");
const { HealthScreen } =
  await import("../app/(admin)/admin/cattle/health/_components/health-screen.js");
const { CattleFeedScreen } =
  await import("../app/(admin)/admin/cattle/feed/_components/cattle-feed-screen.js");
const { PairingPlanner } =
  await import("../app/(admin)/admin/cattle/breeding/_components/pairing-planner.js");
const { BreedingScreen } =
  await import("../app/(admin)/admin/cattle/breeding/_components/breeding-screen.js");
const { CalvingScreen } =
  await import("../app/(admin)/admin/cattle/calving/_components/calving-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

let nextId = 0;
function animal(fields: Partial<Animal> & Pick<Animal, "species" | "name">): Animal {
  nextId += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5${String(nextId).padStart(3, "0")}` as Ulid,
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

/** A herd, a bull, a flock, a dog and a horse — the mix every screen is handed. */
const ANDROMEDA = animal({ species: "cattle", name: "Andromeda", tagNumber: "6001A" });
const CASSIOPEIA = animal({ species: "cattle", name: "Cassiopeia", tagNumber: "6002A" });
const ORION = animal({ species: "cattle", name: "Orion", sex: "male", tagNumber: "6003A" });
const HENRIETTA = animal({ species: "chicken", name: "Henrietta" });
const ROOSTER = animal({ species: "chicken", name: "Rooster", sex: "male" });
const BISCUIT = animal({ species: "dog", name: "Biscuit" });
const COMET = animal({ species: "horse", name: "Comet" });
const TROUBLE = animal({ species: "horse", name: "Trouble", sex: "male" });

const HERD = [ANDROMEDA, CASSIOPEIA, ORION];
const EVERYBODY = [...HERD, HENRIETTA, ROOSTER, BISCUIT, COMET, TROUBLE];

/** What the pickers must never show on a cattle screen. */
const OTHER_SPECIES = [HENRIETTA, ROOSTER, BISCUIT, COMET, TROUBLE].map((a) => a.name as string);

function view(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>,
  );
}

/**
 * Every picker on screen under this label, flattened.
 *
 * Every one rather than the first: a screen can carry the same picker twice —
 * Breeding shows a Dam in the record form and another in the planner beside it
 * — and the rule is about all of them, not whichever happens to render first.
 * A required field's label carries a marker, hence the anchored pattern.
 */
const named = (label: string) => new RegExp(`^${label}\\b`);

/** The labels a native `<select>` is currently offering, placeholder aside. */
function optionsOf(label: string): string[] {
  const selects = screen.getAllByLabelText(named(label)) as HTMLSelectElement[];
  return selects.flatMap((select) =>
    [...select.options].filter((option) => !option.disabled).map((option) => option.text),
  );
}

/** The same, for the type-to-filter picker, which renders a listbox on focus. */
async function comboOptions(label: string): Promise<string[]> {
  const user = userEvent.setup();
  const found: string[] = [];

  for (const box of screen.getAllByRole("combobox", { name: named(label) })) {
    await user.click(box);
    const list = await screen.findByRole("listbox", { name: named(label) });
    found.push(
      ...within(list)
        .getAllByRole("option")
        .map((option) => option.textContent ?? ""),
    );
    // Closed again before the next one opens, or two listboxes answer to the
    // same name and the query below picks arbitrarily.
    await user.keyboard("{Escape}");
  }

  return found;
}

/** Nothing but cattle, and every cow that should be there. */
function expectHerdOnly(labels: readonly string[], expected: readonly Animal[]) {
  const shown = labels.join(" · ");
  for (const name of OTHER_SPECIES) expect(shown).not.toContain(name);
  for (const beast of expected) expect(shown).toContain(beast.name);
}

beforeEach(() => {
  stored.current = { animals: EVERYBODY };
});

describe("Cattle · Sales", () => {
  it("offers only cattle when recording a sale", async () => {
    const user = userEvent.setup();
    view(<SalesScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: /Sales/ }));

    expectHerdOnly(optionsOf("Animal"), HERD);
  });

  it("offers only cattle when recording an acquisition", async () => {
    const user = userEvent.setup();
    view(<SalesScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: /Acquisitions/ }));

    expectHerdOnly(optionsOf("Animal"), HERD);
  });

  it("offers only cattle when booking the processor", async () => {
    const user = userEvent.setup();
    view(<SalesScreen propertyId={PROPERTY} actorId={ACTOR} />);
    await user.click(screen.getByRole("tab", { name: /Processing/ }));

    expectHerdOnly(optionsOf("Animal"), HERD);
  });
});

describe("Cattle · Weights", () => {
  it("offers only cattle", () => {
    view(<WeightsScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expectHerdOnly(optionsOf("Animal"), HERD);
  });

  it("still leaves out cattle that are no longer active", () => {
    // The species filter is added to the status one, not swapped for it.
    const sold = animal({ species: "cattle", name: "Vega", status: "sold" });
    stored.current = { animals: [...EVERYBODY, sold] };
    view(<WeightsScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(optionsOf("Animal")).not.toContain("Vega");
  });
});

describe("Cattle · Health", () => {
  it("offers only cattle", () => {
    view(<HealthScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expectHerdOnly(optionsOf("Animal"), HERD);
  });
});

describe("Cattle · Feed plans", () => {
  it("offers only cattle once the plan feeds one animal", async () => {
    const user = userEvent.setup();
    view(<CattleFeedScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.selectOptions(screen.getByLabelText("Feeds"), "animal");

    expectHerdOnly(optionsOf("Animal"), HERD);
  });
});

describe("Cattle · Breeding", () => {
  // Both Dam pickers on this screen at once — the breeding record's and the
  // planner's beside it.
  it("offers only cows as dams, in every picker on the screen", async () => {
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const dams = (await comboOptions("Dam")).join(" · ");
    expect(dams).toContain("Andromeda");
    expect(dams).toContain("Cassiopeia");
    // A mare is a female animal, and this picker used to say so.
    for (const name of [...OTHER_SPECIES, "Orion"]) expect(dams).not.toContain(name);
  });

  it("offers only bulls as sires, in every picker on the screen", async () => {
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const sires = (await comboOptions("Sire")).join(" · ");
    expect(sires).toContain("Orion");
    for (const name of [...OTHER_SPECIES, "Andromeda"]) expect(sires).not.toContain(name);
  });
});

describe("Cattle · Pairing planner", () => {
  it("offers only cows as the dam", async () => {
    view(<PairingPlanner animals={EVERYBODY} propertyId={PROPERTY} />);

    const dams = (await comboOptions("Dam")).join(" · ");
    expect(dams).toContain("Andromeda");
    for (const name of OTHER_SPECIES) expect(dams).not.toContain(name);
  });

  it("offers only bulls as the sire", async () => {
    view(<PairingPlanner animals={EVERYBODY} propertyId={PROPERTY} />);

    const sires = (await comboOptions("Sire")).join(" · ");
    expect(sires).toContain("Orion");
    for (const name of OTHER_SPECIES) expect(sires).not.toContain(name);
  });
});

describe("Cattle · Calving", () => {
  it("offers only cows as the dam", () => {
    view(<CalvingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const dams = optionsOf("Dam");
    expect(dams).toContain("Andromeda (6001A)");
    for (const name of OTHER_SPECIES) expect(dams.join(" · ")).not.toContain(name);
  });
});
