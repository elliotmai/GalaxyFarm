import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";
import type { CattleProfile, ExternalAnimal } from "@galaxy-farm/module-cattle";

/**
 * The ancestors list (spec §5.2, issue #16).
 *
 * A list screen now, like the herd: bull-or-cow chips that carry their counts,
 * a line that says when the list is narrowed, and rows that open the record.
 * These pin the parts that are easy to lose in a restyle — that a narrowed
 * list says so, and that every ancestor is still one tap from its record.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: (store: string, id: string | undefined) => ({
    record: (stored.current[store] ?? []).find((r) => (r as { id: string }).id === id),
    loading: false,
  }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => ({ ok: true, value: input }),
    update: async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { id, ...patch },
    }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/cattle/ancestors",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { AncestorsScreen } =
  await import("../app/(admin)/admin/cattle/ancestors/_components/ancestors-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const base = {
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const MONTEGO = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid,
  name: "ZNT Montego Bay",
  regNumber: "MA364424",
  association: "Maine-Anjou",
  registrations: [{ association: "Maine-Anjou", regNumber: "MA364424" }],
} as ExternalAnimal;

const TINA = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5E02" as Ulid,
  name: "SULL Tina",
} as ExternalAnimal;

const ANDROMEDA = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  species: "cattle",
  name: "Andromeda",
  sex: "female",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

/** Andromeda is by Montego out of Tina, which places both and puts them in use. */
const PROFILE = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5P01" as Ulid,
  animalId: ANDROMEDA.id,
  registrations: [],
  geneticTests: [],
  sire: { kind: "external", id: MONTEGO.id },
  dam: { kind: "external", id: TINA.id },
} as unknown as CattleProfile;

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <AncestorsScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = {
    animals: [ANDROMEDA],
    externalAnimals: [MONTEGO, TINA],
    cattleProfiles: [PROFILE],
  };
});

describe("The ancestors list", () => {
  it("keeps bulls and cows apart, each a row with its papers", () => {
    view();

    const bulls = screen.getByRole("list", { name: "Bulls" });
    expect(within(bulls).getByText("ZNT Montego Bay")).toBeTruthy();
    expect(within(bulls).getByText(/Maine-Anjou MA364424/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Cows" })).getByText("SULL Tina")).toBeTruthy();
  });

  it("narrows to bulls with one chip, and says so", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /^Bulls/ }));

    expect(screen.getByRole("button", { name: /^Bulls/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByRole("list", { name: "Cows" })).toBeNull();
    expect(screen.getByText("Showing 1 of 2")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("list", { name: "Cows" })).toBeTruthy();
  });

  it("opens the record from its row", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /ZNT Montego Bay/ }));

    expect(screen.getByRole("dialog", { name: "ZNT Montego Bay" })).toBeTruthy();
  });

  it("adds an ancestor in a side panel", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getAllByRole("button", { name: "Add an ancestor" })[0] as HTMLElement);

    const panel = screen.getByRole("dialog", { name: "New ancestor" });
    expect(within(panel).getByRole("button", { name: "Add ancestor" })).toBeTruthy();
  });
});
