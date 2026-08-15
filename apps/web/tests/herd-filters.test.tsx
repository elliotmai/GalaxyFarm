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

    // The rows, by their name links — a name also appears on the quick-move
    // controls, which are not what is being narrowed here. `getAll` because
    // the table draws a row and a card, one for each viewport.
    expect(screen.getAllByRole("link", { name: "Andromeda" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Cassiopeia" }).length).toBeGreaterThan(0);

    // The panel is folded away until it is wanted, and its controls are
    // unmounted rather than hidden while it is.
    await userEvent.click(screen.getByRole("button", { name: /Narrow the herd/ }));
    await userEvent.selectOptions(screen.getByLabelText("Breed"), "Maine-Anjou");

    expect(screen.getAllByRole("link", { name: "Andromeda" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: "Cassiopeia" })).toEqual([]);
    expect(screen.getByText(/Showing 1 of 2/)).toBeInTheDocument();
  });
});
