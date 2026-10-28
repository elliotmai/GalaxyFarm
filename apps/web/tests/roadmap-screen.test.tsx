import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";
import type { PlannedMating } from "@galaxy-farm/module-cattle";

/**
 * The genetic roadmap (spec §5.2, §5.9, issue #20).
 *
 * Marking a plan realised creates the breeding record — the plan becomes the
 * fact in one tap. That tap stays on the row; setting a plan aside and
 * deleting it moved into its panel, and these pin all three.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: (store: string, id: string | undefined) => ({
    record: (stored.current[store] ?? []).find((r) => (r as { id: string }).id === id),
    loading: false,
  }),
}));

const saved = vi.hoisted(() => ({
  created: [] as { store: string; input: Record<string, unknown> }[],
  updated: [] as { store: string; id: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      saved.created.push({ store, input });
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5B99", ...input } };
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
  usePathname: () => "/admin/cattle/roadmap",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { CattleRoadmapScreen } =
  await import("../app/(admin)/admin/cattle/roadmap/_components/cattle-roadmap-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const base = {
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

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

const PLAN = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5M01" as Ulid,
  damId: ANDROMEDA.id,
  method: "AI",
  targetSeason: "Spring 2027",
  planStatus: "open",
} as PlannedMating;

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <CattleRoadmapScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  saved.created = [];
  saved.updated = [];
  stored.current = { animals: [ANDROMEDA], plannedMatings: [PLAN] };
});

describe("A planned mating", () => {
  it("becomes a breeding record in one tap on its row", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: "Record as bred" }));

    expect(saved.created).toContainEqual(
      expect.objectContaining({
        store: "breedingRecords",
        input: expect.objectContaining({ damId: ANDROMEDA.id, method: "AI" }),
      }),
    );
    expect(saved.updated).toContainEqual(
      expect.objectContaining({
        store: "plannedMatings",
        id: PLAN.id,
        patch: expect.objectContaining({ planStatus: "realised" }),
      }),
    );
  });

  it("is set aside from its panel, and kept", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: "More for Andromeda" }));
    const panel = screen.getByRole("dialog", { name: "Andromeda" });
    expect(within(panel).getByText("Spring 2027")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Set aside" }));

    expect(saved.updated).toContainEqual(
      expect.objectContaining({
        id: PLAN.id,
        patch: expect.objectContaining({ planStatus: "abandoned" }),
      }),
    );
  });

  it("is planned in a side panel", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getAllByRole("button", { name: "Plan a mating" })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Plan a mating" });
    await user.type(within(panel).getByLabelText(/what kind/), "a good Chi-cross heifer");
    await user.click(within(panel).getByRole("button", { name: "Plan this mating" }));

    expect(saved.created).toContainEqual(
      expect.objectContaining({
        store: "plannedMatings",
        input: expect.objectContaining({
          damCriteria: "a good Chi-cross heifer",
          planStatus: "open",
        }),
      }),
    );
  });
});
