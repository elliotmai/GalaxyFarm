import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * One horse's page and the herd list (spec §7 `/admin/horses/[id]`,
 * `/admin/horses`, §5.9).
 *
 * Pinned here: the herd row opens her own page; the page leads with who she
 * is and where she stands; Move and Note go to the ＋ Log and close back
 * here; History reads her moves and the Log's notes newest first; and her
 * details sit behind one disclosure and still write.
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
  usePathname: () => "/admin/horses/juniper",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
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
const { HorseScreen } =
  await import("../app/(admin)/admin/horses/[id]/_components/horse-screen.js");
const { animalEntries } =
  await import("../app/(admin)/admin/animals/_components/animal-entries.js");

const MARE: Animal = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5R01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  species: "horse",
  name: "Juniper",
  sex: "female",
  dob: new Date("2014-05-01"),
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 2,
  photoKeys: [],
  notes: "2026-10-12: Farrier came, all four shod\nBought from the Hendersons.",
} as Animal;

/** A horse whose name is one of the section's own views. */
const HERD: Animal = {
  ...MARE,
  id: "01ARZ3NDEKTSV4RRFFQ69G5R02" as Ulid,
  name: "Pens",
  notes: undefined,
} as Animal;

const ZONE = "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid;

function wrap(node: React.ReactNode) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{node}</ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = {
    animals: [MARE, HERD],
    zones: [{ id: ZONE, name: "North Trap", indoor: false, active: true }],
    zoneAssignments: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5M01",
        animalId: MARE.id,
        zoneId: ZONE,
        periodFrom: new Date("2026-03-01"),
        slot: "outside",
      },
    ],
  };
  stored.writes = [];
});

describe("the horses list", () => {
  it("links each horse to her own page, stepping around the section's views", () => {
    // The Horses page is the Animals list with one species in it; its rows
    // come from the same entries, so the links are checked there.
    const hrefs = animalEntries({
      animals: [MARE, HERD],
      flocks: [],
      adjustments: [],
      zones: [],
      assignments: [],
      health: [],
      breedings: [],
      calvings: [],
      now: new Date("2026-10-30"),
    })
      .map((entry) => entry.href)
      .sort();
    // "Pens" would be a view of the section, so she gets a word on the end.
    expect(hrefs).toEqual(["/admin/horses/juniper", "/admin/horses/pens-animal"]);
  });
});

describe("the horse page", () => {
  it("says who she is and where she stands", () => {
    wrap(<HorseScreen slug="juniper" propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByRole("heading", { level: 1, name: "Juniper" })).toBeTruthy();
    expect(screen.getByText(/Horse · Mare · .* · North Trap/)).toBeTruthy();
  });

  it("opens the Log for a move and a note, closing back to this page", () => {
    wrap(<HorseScreen slug="juniper" propertyId={PROPERTY} actorId={ACTOR} />);

    const actions = screen.getByRole("navigation", { name: "Record for this horse" });
    const from = "from=%2Fadmin%2Fhorses%2Fjuniper";
    expect(within(actions).getByRole("link", { name: /Move/ }).getAttribute("href")).toBe(
      `/admin/log?kind=move&animals=${MARE.id}&${from}`,
    );
    expect(within(actions).getByRole("link", { name: /Note/ }).getAttribute("href")).toBe(
      `/admin/log?kind=note&animals=${MARE.id}&${from}`,
    );
    expect(within(actions).getByLabelText("Photo")).toBeTruthy();
  });

  it("reads her moves and notes into one History, newest first", () => {
    wrap(<HorseScreen slug="juniper" propertyId={PROPERTY} actorId={ACTOR} />);

    const list = screen.getByRole("list", { name: "History for Juniper" });
    const titles = within(list)
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".font-semibold")?.textContent);
    expect(titles).toEqual(["Farrier came, all four shod", "Moved to North Trap"]);
  });

  it("resolves a horse named for a section view by her stepped-around slug", () => {
    wrap(<HorseScreen slug="pens-animal" propertyId={PROPERTY} actorId={ACTOR} />);
    expect(screen.getByRole("heading", { level: 1, name: "Pens" })).toBeTruthy();
  });

  it("keeps the details behind one disclosure, and edits her there", async () => {
    const user = userEvent.setup();
    wrap(<HorseScreen slug="juniper" propertyId={PROPERTY} actorId={ACTOR} />);

    const more = screen.getByRole("button", { name: "Handling, care notes, details" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    expect(screen.getByText("Bought from the Hendersons.")).toBeTruthy();

    const details = screen.getByRole("heading", { name: "Details" }).closest("section");
    await user.click(within(details as HTMLElement).getByRole("button", { name: "Edit" }));
    const panel = screen.getByRole("dialog");
    await user.selectOptions(within(panel).getByLabelText("Sex"), "steer");
    await user.click(within(panel).getByRole("button", { name: "Save changes" }));

    expect(stored.writes[0]).toMatchObject({ species: "horse", sex: "steer", name: "Juniper" });
  });
});
