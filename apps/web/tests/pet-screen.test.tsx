import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * One pet's page (spec §7 `/admin/pets/[id]`, §5.8).
 *
 * The cow's page with the household's priorities. Pinned here: what a sitter
 * needs — handling, food, medicine — is on the page, unfolded, before the
 * buttons; the buttons open the pets screen's own forms already on this pet
 * (and write through them), Note goes to the ＋ Log and closes back here; and
 * History merges the vet, the rations and the Log's notes newest first.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
  writes: [] as Record<string, unknown>[],
  replaced: [] as string[],
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
  usePathname: () => "/admin/pets/biscuit",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    replace: (to: string) => stored.replaced.push(to),
    push: () => {},
  }),
}));

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
const { PetScreen } = await import("../app/(admin)/admin/pets/[id]/_components/pet-screen.js");

const DOG: Animal = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5D01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  species: "dog",
  name: "Biscuit",
  sex: "male",
  dob: new Date("2021-04-01"),
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 4,
  safetyNotes: "Bites if you reach for his bowl.",
  photoKeys: [],
  notes: "2026-10-01: Limping on the left fore\nRescued from the county shelter.",
} as Animal;

const FEED = "01ARZ3NDEKTSV4RRFFQ69G5F01" as Ulid;
const PLAN = "01ARZ3NDEKTSV4RRFFQ69G5P01" as Ulid;

function view(slug = "biscuit") {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <PetScreen slug={slug} propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const soon = new Date(Date.now() + 20 * 86_400_000);

beforeEach(() => {
  stored.current = {
    animals: [DOG],
    feedTypes: [{ id: FEED, name: "Kibble", category: "pet", active: true }],
    feedingPlans: [
      {
        id: PLAN,
        name: "Biscuit's ration",
        target: "animal",
        targetId: DOG.id,
        alsoFeeds: [],
        portion: "per_head",
        active: true,
        createdAt: new Date("2026-06-01"),
        lines: [
          {
            feedTypeId: FEED,
            amount: { amount: 1, unit: "scoop" },
            frequency: "twice_daily",
            timeOfDay: "morning",
          },
        ],
      },
    ],
    healthRecords: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5H01",
        animalId: DOG.id,
        type: "treatment",
        product: "Apoquel",
        date: new Date("2026-09-20"),
        boosterDueOn: soon,
      },
    ],
  };
  stored.writes = [];
  stored.replaced = [];
});

describe("the pet page", () => {
  it("says who he is, and puts what a sitter needs before anything else", () => {
    view();

    expect(screen.getByRole("heading", { level: 1, name: "Biscuit" })).toBeTruthy();
    expect(screen.getByText(/Dog · Male/)).toBeTruthy();

    const sitter = screen.getByRole("region", { name: "What a sitter needs" });
    expect(within(sitter).getByText("Bites if you reach for his bowl.")).toBeTruthy();
    expect(within(sitter).getByText(/Kibble/)).toBeTruthy();
    expect(within(sitter).getByText(/Apoquel/)).toBeTruthy();

    // Unfolded: it is read standing at the back door, not looked for.
    expect(sitter.closest("[hidden]")).toBeNull();
  });

  it("opens the Log for a note and closes back to this page", () => {
    view();

    const actions = screen.getByRole("navigation", { name: "Record for this pet" });
    expect(within(actions).getByRole("link", { name: /Note/ }).getAttribute("href")).toBe(
      `/admin/log?kind=note&animals=${DOG.id}&from=%2Fadmin%2Fpets%2Fbiscuit`,
    );
    expect(within(actions).getByLabelText("Photo")).toBeTruthy();
  });

  it("records a worming through the pets screen's own form, already on him", async () => {
    const user = userEvent.setup();
    view();

    const actions = screen.getByRole("navigation", { name: "Record for this pet" });
    await user.click(within(actions).getByRole("button", { name: /Worming/ }));

    const panel = screen.getByRole("dialog");
    // One pet, so it is not asked which.
    expect(within(panel).queryByLabelText("Pet")).toBeNull();
    expect((within(panel).getByLabelText("What") as HTMLSelectElement).value).toBe("deworming");
    await user.type(within(panel).getByLabelText(/Product/), "Drontal");
    await user.click(within(panel).getByRole("button", { name: "Record it" }));

    expect(stored.writes[0]).toMatchObject({
      animalId: DOG.id,
      type: "deworming",
      product: "Drontal",
    });
  });

  it("merges the vet, the ration and the Log's notes into one History, newest first", () => {
    view();

    const list = screen.getByRole("list", { name: "History for Biscuit" });
    const titles = within(list)
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".font-semibold")?.textContent);
    expect(titles).toEqual([
      "Limping on the left fore",
      "Apoquel",
      "Ration written: Biscuit's ration",
    ]);

    // The next dose the vet gave is what is coming up.
    const coming = screen.getByRole("list", { name: "Coming up" });
    expect(within(coming).getByText("Apoquel")).toBeTruthy();
  });

  it("keeps the details behind one disclosure", async () => {
    const user = userEvent.setup();
    view();

    const more = screen.getByRole("button", { name: "Rations, vet and details" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Rescued from the county shelter.")).toBeNull();

    await user.click(more);
    expect(screen.getByText("Rescued from the county shelter.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Biscuit's rations" })).toBeTruthy();
  });

  it("moves an old address to the current one, and refuses a cow", () => {
    view(DOG.id);
    expect(stored.replaced).toEqual(["/admin/pets/biscuit"]);

    stored.current = {
      animals: [{ ...DOG, species: "cattle", id: "01ARZ3NDEKTSV4RRFFQ69G5C01" as Ulid }],
    };
    view("biscuit");
    expect(screen.getByText("No pet by that name")).toBeTruthy();
  });
});
