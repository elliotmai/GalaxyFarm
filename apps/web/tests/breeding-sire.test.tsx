import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";
import type { SemenInventory } from "@galaxy-farm/module-cattle";

/**
 * Saying who the bull was (spec §5.2).
 *
 * An AI breeding could not be recorded at all. The form put the sire in a note
 * and set none of the record's sire fields, so the schema's "an AI breeding
 * needs a straw or a named sire" refused every one — and the answer it wanted
 * was one this farm often does not have. Semen is bought and thawed the same
 * morning, and cows go to somebody else's chute; there is no straw in our tank
 * for either.
 *
 * So the field takes four answers and the tests are about all four: a straw
 * out of the tank, a bull standing here, an ancestor on file, and a name typed
 * in. The last one is the one the bug was about.
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
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5F99", ...input } };
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
  usePathname: () => "/admin/cattle/breeding",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { BreedingScreen } =
  await import("../app/(admin)/admin/cattle/breeding/_components/breeding-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const STRAW_ID = "01ARZ3NDEKTSV4RRFFQ69G5S01" as Ulid;
const EMPTY_STRAW_ID = "01ARZ3NDEKTSV4RRFFQ69G5S02" as Ulid;

const ANDROMEDA = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  species: "cattle",
  name: "Andromeda",
  tagNumber: "6001A",
  sex: "female",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

const straw = (fields: Partial<SemenInventory> & Pick<SemenInventory, "id" | "sireName">) =>
  ({
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    strawsOnHand: 4,
    ...fields,
  }) as SemenInventory;

const MONTEGO_EXTERNAL = "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid;

/** A cane joined to the ancestor the catalog import brought across. */
const MONTEGO = straw({
  id: STRAW_ID,
  sireName: "ZNT Montego Bay",
  sireExternalId: MONTEGO_EXTERNAL,
  strawsOnHand: 4,
  tank: "1",
  canister: "3",
});
const USED_UP = straw({ id: EMPTY_STRAW_ID, sireName: "SULL Solution", strawsOnHand: 0 });

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const named = (label: string) => new RegExp(`^${label}\\b`);

/**
 * Pick a row out of a type-to-filter picker by typing at it.
 *
 * The last one under that label, deliberately: the pairing planner sits above
 * the form with a Dam and a Sire of its own, and the form is the one being
 * tested.
 */
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, typed: string) {
  const boxes = screen.getAllByRole("combobox", { name: named(label) });
  const box = boxes[boxes.length - 1] as HTMLElement;
  await user.click(box);
  await user.type(box, typed);
  return screen.findByRole("listbox", { name: named(label) });
}

async function recordBreeding(typed: string, option: RegExp) {
  const user = userEvent.setup();
  view();

  const dams = await pick(user, "Dam", "Andromeda");
  await user.click(within(dams).getByRole("option", { name: /Andromeda/ }));

  const sires = await pick(user, "Sire", typed);
  await user.click(within(sires).getByRole("option", { name: option }));

  await user.click(screen.getByRole("button", { name: "Record breeding" }));
  return saved.created.filter((write) => write.store === "breedingRecords");
}

beforeEach(() => {
  saved.created = [];
  saved.updated = [];
  stored.current = { animals: [ANDROMEDA], semenInventory: [MONTEGO, USED_UP] };
});

describe("Recording an AI breeding", () => {
  it("saves one whose sire was only typed in", async () => {
    // The reported bug: no straw of him in the tank, no record of him on file,
    // the cow bred at somebody else's place — and the form refused to save.
    const written = await recordBreeding("ZNT Bandwagon", /not on file/);

    expect(written).toHaveLength(1);
    expect(written[0]?.input).toMatchObject({ method: "AI", sireName: "ZNT Bandwagon" });
    expect(screen.queryByText(/needs the sire/)).toBeNull();
  });

  it("offers the tank, with what is in it", async () => {
    const user = userEvent.setup();
    view();

    const list = await pick(user, "Sire", "Montego");
    expect(within(list).getByRole("option", { name: /ZNT Montego Bay/ }).textContent).toContain(
      "4 straws",
    );
    expect(within(list).getByRole("option", { name: /ZNT Montego Bay/ }).textContent).toContain(
      "Tank 1",
    );
  });

  it("links the straw and takes it off the count", async () => {
    const written = await recordBreeding("Montego", /ZNT Montego Bay/);

    expect(written[0]?.input).toMatchObject({
      semenInventoryId: STRAW_ID,
      sireName: "ZNT Montego Bay",
    });
    expect(saved.updated).toContainEqual({
      store: "semenInventory",
      id: STRAW_ID,
      patch: { strawsOnHand: 3 },
    });
  });

  it("still records a breeding against a cane already emptied, leaving the count alone", async () => {
    // A service entered a fortnight late is still that cow's service. The
    // count cannot go negative (§4.5), and that is not a reason to lose it.
    const written = await recordBreeding("Solution", /SULL Solution/);

    expect(written[0]?.input).toMatchObject({ semenInventoryId: EMPTY_STRAW_ID });
    expect(saved.updated.filter((write) => write.store === "semenInventory")).toEqual([]);
  });

  it("carries the straw's own sire onto the record, unasked", async () => {
    // The point of joining a cane to an ancestor in the tank: whoever filled
    // it in did the work of saying who the bull was, and nobody is asked again
    // in the chute. `sireOf` reads this at calving to pedigree the calf.
    const written = await recordBreeding("Montego", /ZNT Montego Bay/);

    expect(written[0]?.input).toMatchObject({ sireExternalId: MONTEGO_EXTERNAL });
  });

  it("keeps the whole sire question on one field", async () => {
    // Method, sire and date, and nothing to fill in twice: the straw's own
    // sire travels onto the record so the calving flow can pedigree the calf.
    const written = await recordBreeding("Montego", /ZNT Montego Bay/);

    expect(written[0]?.input).not.toHaveProperty("notes");
  });
});

describe("The breeding log", () => {
  it("shows who the sire was, however he was recorded", () => {
    stored.current = {
      ...stored.current,
      breedingRecords: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5B01" as Ulid,
          propertyId: PROPERTY,
          createdAt: new Date("2026-02-14"),
          updatedAt: new Date("2026-02-14"),
          damId: ANDROMEDA.id,
          method: "AI",
          sireName: "ZNT Bandwagon",
          date: new Date("2026-02-14"),
        },
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5B02" as Ulid,
          propertyId: PROPERTY,
          createdAt: new Date("2026-03-01"),
          updatedAt: new Date("2026-03-01"),
          damId: ANDROMEDA.id,
          method: "AI",
          semenInventoryId: STRAW_ID,
          date: new Date("2026-03-01"),
        },
      ],
    };
    view();

    const log = screen.getByRole("table", { name: /Breeding records/ });
    // The sire used to live in a note, invisible from here.
    expect(within(log).getByText("ZNT Bandwagon")).toBeTruthy();
    expect(within(log).getByText("ZNT Montego Bay")).toBeTruthy();
    expect(within(log).getByText("straw")).toBeTruthy();
  });
});
