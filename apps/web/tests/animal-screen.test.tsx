import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * One animal's page (spec §7).
 *
 * The page was rebuilt around an identity block and a short tab strip, and the
 * two things worth pinning are the ones a redesign loses quietly: that the
 * strip stays short enough to read on a phone, and that the views folded
 * behind More — the papers above all — are still reachable and still write.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      stored.writes.push(input);
      return { ok: true, value: input };
    },
    update: async (_id: string, patch: Record<string, unknown>) => {
      stored.writes.push(patch);
      return { ok: true, value: patch };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/cattle/42",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

// The photo controls reach for the attachment pipeline, which is not what is
// under test here.
vi.mock("@/app/_components/photo-panel", () => ({
  PhotoQuickCapture: () => <button type="button">Photo</button>,
  PhotoPanel: () => <p>Photos</p>,
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { AnimalScreen } =
  await import("../app/(admin)/admin/cattle/[id]/_components/animal-screen.js");

const COW: Animal = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  species: "cattle",
  name: "Daisy",
  tagNumber: "42",
  sex: "female",
  dob: new Date("2019-04-01"),
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 4,
  photoKeys: [],
} as Animal;

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <AnimalScreen slug="42" propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = { animals: [COW] };
  stored.writes = [];
});

describe("the animal page", () => {
  it("leads with who she is and keeps the strip to five tabs", () => {
    view();

    expect(screen.getByRole("heading", { level: 1, name: "Daisy" })).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getAllByRole("tab").length).toBeLessThanOrEqual(5);
    // Her primary action is on the page itself, not behind a tab.
    expect(screen.getByRole("link", { name: "Record a calving" })).toBeTruthy();
  });

  it("still reaches the papers behind More, and adds a registration", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "Papers" }));
    expect(screen.getByRole("button", { name: "Papers" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await user.click(screen.getByRole("button", { name: /Add registration/ }));
    const panel = screen.getByRole("dialog");
    await user.type(within(panel).getByLabelText(/Registration number/), "4219133");
    await user.click(within(panel).getByRole("button", { name: "Add registration" }));

    const written = stored.writes[0]?.["registrations"] as { regNumber: string }[] | undefined;
    expect(written?.[0]?.regNumber).toBe("4219133");
  });
});
