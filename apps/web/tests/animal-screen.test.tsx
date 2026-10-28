import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * One animal's page (spec §7, V2 Animal).
 *
 * The page is an identity block, eight buttons into the Log flow, Coming up,
 * one merged History, and a disclosure holding the deeper views. Pinned here:
 * the buttons carry the Log's query contract for *this* animal, History
 * merges every kind of record newest first, and the views behind the
 * disclosure — the papers above all — are still reachable and still write.
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

vi.mock("@/lib/photos/use-photos", () => ({
  useAttachPhotos: () => ({
    busy: false,
    problem: undefined,
    attach: async () => {},
    clearProblem: () => {},
  }),
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

const ZONE = "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid;

describe("the animal page", () => {
  it("leads with who she is and opens the Log for her from eight buttons", () => {
    view();

    expect(screen.getByRole("heading", { level: 1, name: "Daisy" })).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);

    const actions = screen.getByRole("navigation", { name: "Log for this animal" });
    const links = within(actions).getAllByRole("link");
    // Seven links and the camera — Photo goes straight to the photo pipeline.
    expect(links).toHaveLength(7);
    expect(within(actions).getByLabelText("Photo")).toBeTruthy();
    expect(
      within(actions)
        .getByRole("link", { name: /Treatment/ })
        .getAttribute("href"),
    ).toBe(`/admin/log?kind=treatment&animals=${COW.id}`);
    expect(
      within(actions)
        .getByRole("link", { name: /Calving/ })
        .getAttribute("href"),
    ).toBe(`/admin/log?kind=calving&animals=${COW.id}`);
  });

  it("merges every kind of record into one History, newest first", () => {
    stored.current = {
      animals: [COW],
      zones: [{ id: ZONE, name: "Pasture 3", indoor: false, active: true }],
      zoneAssignments: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5M01",
          animalId: COW.id,
          zoneId: ZONE,
          periodFrom: new Date("2026-03-01"),
          slot: "outside",
        },
      ],
      weightRecords: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5W01",
          animalId: COW.id,
          date: new Date("2026-10-02"),
          weightLb: 1084,
          context: "other",
        },
      ],
      healthRecords: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5H01",
          animalId: COW.id,
          type: "vaccination",
          product: "Scour vaccine",
          date: new Date("2026-09-20"),
        },
      ],
      heatRecords: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5E01",
          animalId: COW.id,
          observedAt: new Date("2026-05-10"),
          intensity: "standing",
        },
      ],
    };
    view();

    const list = screen.getByRole("list", { name: "History for Daisy" });
    const titles = within(list)
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".font-semibold")?.textContent);
    expect(titles).toEqual([
      "Weighed 1,084 lb",
      "Scour vaccine",
      "In heat · standing",
      "Moved to Pasture 3",
    ]);
  });

  it("puts a withdrawal in the header chip and at the top of Coming up", () => {
    stored.current = {
      animals: [COW],
      healthRecords: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5H02",
          animalId: COW.id,
          type: "treatment",
          product: "LA-200",
          date: new Date(),
          withdrawalDays: 28,
        },
      ],
    };
    view();

    const coming = screen.getByRole("list", { name: "Coming up" });
    expect(within(coming).getByText(/Withdrawal ends/)).toBeTruthy();
    expect(screen.getAllByText("Withdrawal").length).toBeGreaterThanOrEqual(1);
  });

  it("still reaches the papers behind the disclosure, and adds a registration", async () => {
    const user = userEvent.setup();
    view();

    const more = screen.getByRole("button", { name: "Pedigree, papers, genetics, money" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
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
