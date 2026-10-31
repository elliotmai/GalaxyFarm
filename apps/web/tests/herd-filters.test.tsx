import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";
import type { CattleProfile } from "@galaxy-farm/module-cattle";

/**
 * Narrowing the herd by breed (spec §5.2, §7 `/admin/cattle`).
 *
 * Breed is the one filter that has to look somewhere other than the animal:
 * it lives on the cattle profile, so the row and the filter both have to find
 * the profile belonging to an animal. That lookup used to be declared below
 * the filter that calls it — a `const` read before its own initialiser, which
 * is a `ReferenceError` rather than an `undefined`. Nothing caught it because
 * nothing reads it until a breed is actually chosen: the herd loads, the panel
 * opens, and the screen dies on the first selection.
 *
 * So this drives the control rather than asserting on the helper. The bug was
 * in the order the file was written in, and only rendering it finds that.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

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
  usePathname: () => "/admin/cattle",
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
  useSyncEngine: () => ({
    store: undefined,
    syncNow: async () => {},
    retryStuck: async () => {},
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { HerdScreen } = await import("../app/(admin)/admin/cattle/_components/herd-screen.js");

let made = 0;
function animal(name: string): Animal {
  made += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5A${String(made).padStart(2, "0")}` as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    species: "cattle",
    name,
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
  } as Animal;
}

function profile(animalId: Ulid, breed: string): CattleProfile {
  made += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5C${String(made).padStart(2, "0")}` as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    animalId,
    // The stated breed rather than a percentage makeup: what somebody typed is
    // what `breedsOf` prefers, and it keeps this fixture about the filter.
    breed: [breed],
    breedComposition: [],
    geneticTests: [],
    registrations: [],
  } satisfies CattleProfile;
}

const ANDROMEDA = animal("Andromeda");
const CASSIOPEIA = animal("Cassiopeia");

beforeEach(() => {
  stored.current = {
    animals: [ANDROMEDA, CASSIOPEIA],
    zones: [],
    calvingRecords: [],
    breedingRecords: [],
    zoneAssignments: [],
    healthRecords: [],
    cattleProfiles: [profile(ANDROMEDA.id, "Maine-Anjou"), profile(CASSIOPEIA.id, "Shorthorn")],
  };
});

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <HerdScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe("the breed filter", () => {
  it("narrows the herd to one breed rather than throwing", async () => {
    view();

    // The rows, by their links. The whole row is the link, so its name is the
    // tag, the name and the muted line together — matched on the name alone.
    expect(screen.getByRole("link", { name: /Andromeda/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Cassiopeia/ })).toBeInTheDocument();

    // The filters are behind one button until they are wanted, and their
    // controls are unmounted rather than hidden while they are.
    expect(screen.queryByLabelText("Breed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    await userEvent.selectOptions(screen.getByLabelText("Breed"), "Maine-Anjou");

    expect(screen.getByRole("link", { name: /Andromeda/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Cassiopeia/ })).toBeNull();
    expect(screen.getByText(/Showing 1 of 2/)).toBeInTheDocument();
  });

  it("keeps saying what is on once the filters are closed", async () => {
    view();

    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    await userEvent.selectOptions(screen.getByLabelText("Breed"), "Maine-Anjou");
    await userEvent.click(screen.getByRole("button", { name: "Show 1" }));

    // Folded away, but never silent: a narrowed list that does not say so
    // reads as a smaller herd.
    expect(screen.queryByLabelText("Breed")).toBeNull();
    expect(screen.getByText(/Breed: Maine-Anjou/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("link", { name: /Cassiopeia/ })).toBeInTheDocument();
  });
});

describe("the herd list", () => {
  it("counts the head and opens the editor in a dialog", async () => {
    view();

    expect(screen.getByRole("heading", { level: 1, name: /^Cattle/ })).toBeInTheDocument();
    expect(screen.getByText("2 head")).toBeInTheDocument();

    // Two add buttons are drawn — the header one for a laptop, the floating
    // one for a phone — and CSS decides which shows. Either opens the same.
    await userEvent.click(screen.getAllByRole("button", { name: /Add animal/ })[0]!);
    expect(screen.getByRole("dialog", { name: "Add an animal" })).toBeInTheDocument();
  });

  it("toggles a class from the chip row and back", async () => {
    view();

    const heifers = screen.getByRole("button", { name: /^Heifers/ });
    await userEvent.click(heifers);
    expect(heifers).toHaveAttribute("aria-pressed", "true");

    // Pressing the one already on goes back to the whole herd.
    await userEvent.click(heifers);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });
});
