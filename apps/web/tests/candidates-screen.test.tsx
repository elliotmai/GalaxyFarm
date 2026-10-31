import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import { fromDollars, type PurchaseCandidate, type Ulid } from "@galaxy-farm/core";

/**
 * Cattle candidates (spec §5.2, §5.9, issue #27).
 *
 * The comparison is on what an animal would cost to get here, not its sticker
 * — so the row leads with the all-in figure and the list is sorted on it. The
 * status ladder and delete moved off the row into its panel; these pin that
 * both are still there.
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
  created: [] as Record<string, unknown>[],
  updated: [] as { id: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      saved.created.push(input);
      return { ok: true, value: input };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      saved.updated.push({ id, patch });
      return { ok: true, value: { id, ...patch } };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/cattle/candidates",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { CattleCandidatesScreen } =
  await import("../app/(admin)/admin/cattle/candidates/_components/candidates-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const candidate = (id: string, fields: Partial<PurchaseCandidate>) =>
  ({
    id: id as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    domain: "cattle",
    status: "watching",
    additionalCosts: [],
    firstSeen: new Date("2026-01-01"),
    photoKeys: [],
    pros: [],
    cons: [],
    planStatus: "open",
    ...fields,
  }) as PurchaseCandidate;

/** Cheaper on the sticker, dearer once she is hauled four hundred miles. */
const FAR = candidate("01ARZ3NDEKTSV4RRFFQ69G5C01", {
  title: "Bred heifer, Weatherford",
  askingPrice: fromDollars(2000),
  additionalCosts: [{ label: "Hauling", amount: fromDollars(900) }],
});
const NEAR = candidate("01ARZ3NDEKTSV4RRFFQ69G5C02", {
  title: "Show prospect, down the road",
  askingPrice: fromDollars(2500),
});

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <CattleCandidatesScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  saved.created = [];
  saved.updated = [];
  stored.current = { purchaseCandidates: [FAR, NEAR] };
});

describe("The comparison", () => {
  it("sorts on the all-in cost, not the asking price", () => {
    view();

    const rows = within(screen.getByRole("list", { name: "Cattle candidates" })).getAllByRole(
      "listitem",
    );
    expect(rows[0]?.textContent).toContain("Show prospect");
    expect(rows[1]?.textContent).toContain("Bred heifer");
  });

  it("moves a candidate along the ladder from its panel", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /Bred heifer/ }));
    const panel = screen.getByRole("dialog", { name: "Bred heifer, Weatherford" });
    await user.selectOptions(within(panel).getByLabelText(/^Status/), "passed");

    expect(saved.updated).toContainEqual({ id: FAR.id, patch: { status: "passed" } });
    expect(within(panel).getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("adds one in a side panel, with the hauling itemised", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getAllByRole("button", { name: "Add a candidate" })[0] as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Add a candidate" });
    await user.type(within(panel).getByLabelText(/^Animal/), "Red heifer");
    await user.type(within(panel).getByLabelText(/^Asking/), "1800");
    await user.type(within(panel).getByLabelText(/^Hauling/), "300");
    await user.click(within(panel).getByRole("button", { name: "Add candidate" }));

    expect(saved.created[0]).toMatchObject({
      title: "Red heifer",
      domain: "cattle",
      additionalCosts: [{ label: "Hauling" }],
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
