import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";
import type { ExternalAnimal, SemenInventory } from "@galaxy-farm/module-cattle";

/**
 * Joining a cane to the bull it came from (spec §5.2).
 *
 * `SemenInventory` has carried `sireExternalId` and `sireAnimalId` since it was
 * written and nothing ever set either: the tank took a name typed off the cane
 * and stopped there. So the ancestors brought across from the catalog — the
 * pedigree, the colour, the four generations behind him — were unreachable
 * from the straw, and a breeding drawn from it inherited a string.
 *
 * These are about the join, at both ends: made when the cane is entered, and
 * addable afterwards to every cane already in the tank, because that is all of
 * them.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
const saved = vi.hoisted(() => ({
  created: [] as { store: string; input: Record<string, unknown> }[],
  updated: [] as { store: string; id: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: (store: string, id: string | undefined) => ({
    record: (stored.current[store] ?? []).find((r) => (r as { id: string }).id === id),
    loading: false,
  }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      saved.created.push({ store, input });
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5F98", ...input } };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      saved.updated.push({ store, id, patch });
      return { ok: true, value: { id, ...patch } };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/cattle/supplies",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { CattleSuppliesScreen } =
  await import("../app/(admin)/admin/cattle/supplies/_components/cattle-supplies-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const MONTEGO_ID = "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid;
const ORION_ID = "01ARZ3NDEKTSV4RRFFQ69G5A03" as Ulid;
const CANE_ID = "01ARZ3NDEKTSV4RRFFQ69G5S05" as Ulid;

const base = {
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

/** A bull on somebody else's papers, as the catalog import leaves him. */
const MONTEGO = {
  ...base,
  id: MONTEGO_ID,
  name: "ZNT Montego Bay",
  registrations: [{ association: "Maine-Anjou", regNumber: "MA364424" }],
  sex: "male",
} as ExternalAnimal;

const ORION = {
  ...base,
  id: ORION_ID,
  species: "cattle",
  name: "Orion",
  tagNumber: "6003A",
  sex: "male",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <CattleSuppliesScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const named = (label: string) => new RegExp(`^${label}\\b`);

/**
 * Pick a sire in one of the pickers on the screen.
 *
 * `which` because the tab carries two: the form that adds a cane, and the one
 * that appears on a card to join a cane already in the tank.
 */
async function pickSire(
  user: ReturnType<typeof userEvent.setup>,
  typed: string,
  option: RegExp,
  which: "form" | "card" = "form",
) {
  const boxes = screen.getAllByRole("combobox", { name: named("Sire") });
  const box = (which === "form" ? boxes[0] : boxes[boxes.length - 1]) as HTMLElement;
  await user.click(box);
  await user.type(box, typed);
  const list = await screen.findByRole("listbox", { name: named("Sire") });
  await user.click(within(list).getByRole("option", { name: option }));
}

async function addStraws(typed: string, option: RegExp) {
  const user = userEvent.setup();
  view();

  await pickSire(user, typed, option);
  await user.type(screen.getByLabelText(named("Straws")), "6");
  await user.click(screen.getByRole("button", { name: "Add to the tank" }));

  return saved.created.filter((write) => write.store === "semenInventory");
}

beforeEach(() => {
  saved.created = [];
  saved.updated = [];
  stored.current = { animals: [ORION], externalAnimals: [MONTEGO], semenInventory: [] };
});

describe("Adding a cane to the tank", () => {
  it("joins it to an ancestor on file", async () => {
    const written = await addStraws("Montego", /ZNT Montego Bay/);

    expect(written[0]?.input).toMatchObject({
      sireExternalId: MONTEGO_ID,
      sireName: "ZNT Montego Bay",
      strawsOnHand: 6,
    });
  });

  it("joins it to one of our own bulls, collected here", async () => {
    const written = await addStraws("Orion", /^Orion/);

    // Named the way the herd screens name him, tag and all.
    expect(written[0]?.input).toMatchObject({
      sireAnimalId: ORION_ID,
      sireName: "Orion (6003A)",
    });
  });

  it("still takes a bull who is on nobody's file, as written on the cane", async () => {
    const written = await addStraws("SULL Red Reward", /not on file/);

    expect(written[0]?.input).toMatchObject({ sireName: "SULL Red Reward", strawsOnHand: 6 });
    expect(written[0]?.input).not.toHaveProperty("sireExternalId");
  });

  it("offers the ancestors rather than making somebody remember the spelling", async () => {
    const user = userEvent.setup();
    view();

    const [box] = screen.getAllByRole("combobox", { name: named("Sire") });
    await user.click(box as HTMLElement);
    const list = await screen.findByRole("listbox", { name: named("Sire") });

    const shown = within(list)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "")
      .join(" · ");
    expect(shown).toContain("ZNT Montego Bay");
    expect(shown).toContain("MA364424");
    expect(shown).toContain("Orion");
  });
});

describe("A cane already in the tank", () => {
  const nameOnly = {
    ...base,
    id: CANE_ID,
    sireName: "ZNT Montego Bay",
    strawsOnHand: 3,
  } as SemenInventory;

  it("says what a name-only cane costs, and joins it up", async () => {
    // Every straw entered before there was a picker is in this state, and
    // deleting the tank to retype it is not a migration path anybody takes.
    stored.current = { ...stored.current, semenInventory: [nameOnly] };
    const user = userEvent.setup();
    view();

    expect(screen.getByText(/cannot be pedigreed/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Join to a sire" }));
    await pickSire(user, "Montego", /ZNT Montego Bay/, "card");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(saved.updated).toContainEqual({
      store: "semenInventory",
      id: CANE_ID,
      patch: { sireExternalId: MONTEGO_ID, sireName: "ZNT Montego Bay" },
    });
  });

  it("shows the papers once it is joined", () => {
    stored.current = {
      ...stored.current,
      semenInventory: [{ ...nameOnly, sireExternalId: MONTEGO_ID } as SemenInventory],
    };
    view();

    expect(screen.getByText(/Maine-Anjou MA364424/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join to a sire" })).toBeNull();
  });
});
