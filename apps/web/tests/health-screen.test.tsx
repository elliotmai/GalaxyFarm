import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";

/**
 * The health log (spec §5.2, issue #17).
 *
 * The form moved off the page into a panel. What must survive the move is the
 * two-tap path from her profile — the link arrives with `?animal=` and the
 * panel is already open with her chosen — and the withdrawal list, which is
 * the one thing on this screen with a legal edge to it.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const COW = "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
  params: "",
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      stored.writes.push(input);
      return { ok: true, value: input };
    },
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(stored.params),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { HealthScreen } =
  await import("../app/(admin)/admin/cattle/health/_components/health-screen.js");

const DAISY = {
  id: COW,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  species: "cattle",
  name: "Daisy",
  sex: "female",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

function treated(daysAgo: number, withdrawalDays: number): HealthRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5H01" as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    animalId: COW,
    type: "treatment",
    date: new Date(Date.now() - daysAgo * 86_400_000),
    product: "LA-200",
    route: "subcutaneous",
    withdrawalDays,
  } as HealthRecord;
}

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <HealthScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = { animals: [DAISY] };
  stored.params = "";
  stored.writes = [];
});

describe("the health screen", () => {
  it("lists an animal under withdrawal by name", () => {
    stored.current = { animals: [DAISY], healthRecords: [treated(2, 28)] };
    view();

    const list = screen.getByRole("list", { name: "Under withdrawal" });
    expect(within(list).getByText("Daisy")).toBeTruthy();
  });

  it("says a quiet day in one line", () => {
    stored.current = { animals: [DAISY], healthRecords: [treated(60, 28)] };
    view();

    expect(screen.queryByRole("list", { name: "Under withdrawal" })).toBeNull();
    expect(screen.getByText(/Nobody under withdrawal/)).toBeTruthy();
  });

  it("opens with her chosen when her page sent her, and records in one tap", async () => {
    const user = userEvent.setup();
    stored.params = `animal=${COW}`;
    view();

    const panel = screen.getByRole("dialog");
    expect((within(panel).getByLabelText(/Animal/) as HTMLSelectElement).value).toBe(COW);

    await user.click(within(panel).getByRole("button", { name: "Record treatment" }));
    expect(stored.writes[0]?.["animalId"]).toBe(COW);
  });
});
