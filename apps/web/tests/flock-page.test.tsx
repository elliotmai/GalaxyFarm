import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, ChoreTemplate, Ulid, ZoneAssignment } from "@galaxy-farm/core";
import type { EggLog, Flock, FlockAdjustment } from "@galaxy-farm/module-poultry";

/**
 * One flock's page (spec §7 `/admin/chickens/flock/[id]`).
 *
 * The cow page's anatomy for a flock: who they are, big buttons, Coming up,
 * a week of eggs, one merged History, photos, and the details behind one
 * disclosure. Pinned here: the eggs button carries the Log's contract for
 * *this* flock and closes back to its page, the other buttons write through
 * the flock screens' own write paths, History merges the headcount log, the
 * egg logs and dated notes newest first, and the address is the flock's name.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const COOP = "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid;
const RUN = "01ARZ3NDEKTSV4RRFFQ69G5Z02" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
  writes: [] as { store: string; kind: string; id?: string; value: Record<string, unknown> }[],
  pathname: "/admin/chickens/flock/the-big-coop",
  search: new URLSearchParams(),
  replaced: [] as string[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      stored.writes.push({ store, kind: "create", value: input });
      return { ok: true, value: { id: "01ARZ3NDEKTSV4RRFFQ69G5NEW", ...input } };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      stored.writes.push({ store, kind: "update", id, value: patch });
      return { ok: true, value: patch };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => stored.pathname,
  useSearchParams: () => stored.search,
  useRouter: () => ({
    replace: (to: string) => stored.replaced.push(to),
    push: () => {},
  }),
}));

vi.mock("@/app/_components/photo-panel", () => ({
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
const { FlockRecordScreen } =
  await import("../app/(admin)/admin/chickens/flock/[id]/_components/flock-record.js");
const { eggTrend } =
  await import("../app/(admin)/admin/chickens/flock/[id]/_components/flock-history.js");
const { LogFlow } = await import("../app/(admin)/admin/log/_components/log-flow.js");
const { logHref } = await import("../app/(admin)/admin/log/_components/log-kinds.js");
const { flockHref, resolveFlockSlug, birdHref } = await import("../lib/flock-slug.js");
const { destinationFor, sectionFor } = await import("../app/(admin)/_components/nav-groups.js");

const FLOCK: Flock = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5F01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2025-03-01T12:00:00"),
  updatedAt: new Date("2025-03-01T12:00:00"),
  name: "The big coop",
  species: "chicken",
  zoneId: COOP,
  breedMix: "ISA Browns and Easter Eggers",
  openingCount: 18,
  active: true,
  notes: "2026-10-01: Started moulting\nThe one with the red door.",
} as Flock;

const ZONES = [
  { id: COOP, name: "Hen house", type: "coop", indoor: true, active: true },
  { id: RUN, name: "Orchard run", type: "coop", indoor: false, active: true },
];

const LOSS: FlockAdjustment = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-10-10"),
  updatedAt: new Date("2026-10-10"),
  flockId: FLOCK.id,
  reason: "predator",
  quantity: 4,
  occurredOn: new Date("2026-10-10T12:00:00"),
  notes: "Fox under the fence",
} as FlockAdjustment;

const BASKET: EggLog = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid,
  propertyId: PROPERTY,
  createdAt: new Date("2026-10-20"),
  updatedAt: new Date("2026-10-20"),
  flockId: FLOCK.id,
  collectedOn: new Date("2026-10-20T12:00:00"),
  total: 11,
  breakdown: [],
} as EggLog;

function view(slug = "the-big-coop") {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <FlockRecordScreen slug={slug} propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = { flocks: [FLOCK], zones: ZONES };
  stored.writes = [];
  stored.replaced = [];
  stored.pathname = "/admin/chickens/flock/the-big-coop";
  stored.search = new URLSearchParams();
});

describe("the flock page", () => {
  it("leads with the flock and opens the Log's eggs form on it", () => {
    stored.current = { ...stored.current, flockAdjustments: [LOSS] };
    view();

    expect(screen.getByRole("heading", { level: 1, name: "The big coop" })).toBeTruthy();
    // 18 to start, 4 taken: the count is derived, never typed.
    expect(screen.getByText(/14 birds today/)).toBeTruthy();
    expect(screen.getByText(/Hen house/)).toBeTruthy();

    const actions = screen.getByRole("navigation", { name: "Log for this flock" });
    expect(
      within(actions)
        .getByRole("link", { name: /Collect eggs/ })
        .getAttribute("href"),
    ).toBe(
      `/admin/log?kind=eggs&flock=${FLOCK.id}&from=%2Fadmin%2Fchickens%2Fflock%2Fthe-big-coop`,
    );
    expect(within(actions).getByRole("button", { name: /Headcount/ })).toBeTruthy();
    expect(within(actions).getByRole("button", { name: /Move/ })).toBeTruthy();
    expect(within(actions).getByRole("button", { name: /Note/ })).toBeTruthy();
    expect(within(actions).getByLabelText("Photo")).toBeTruthy();
    // Health records belong to animals; a flock has no treatment to write.
    expect(within(actions).queryByText(/Treatment/)).toBeNull();
  });

  it("merges the headcount log, egg logs and dated notes into one History", () => {
    stored.current = { ...stored.current, flockAdjustments: [LOSS], eggLogs: [BASKET] };
    view();

    const list = screen.getByRole("list", { name: "History for The big coop" });
    const titles = within(list)
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".font-semibold")?.textContent);
    expect(titles).toEqual(["11 eggs collected", "−4 Taken", "Note", "Started with 18 birds"]);
    expect(within(list).getByText("Fox under the fence")).toBeTruthy();
    expect(within(list).getByText("Started moulting")).toBeTruthy();
  });

  it("lists the coop's chores under Coming up, and nothing when there are none", () => {
    view();
    expect(screen.queryByRole("list", { name: "Coming up" })).toBeNull();

    const chore: ChoreTemplate = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5C01" as Ulid,
      propertyId: PROPERTY,
      createdAt: new Date(),
      updatedAt: new Date(),
      title: "Scrub the waterer",
      recurrence: "daily",
      recurrenceDays: [],
      zoneId: COOP,
      active: true,
    } as ChoreTemplate;
    stored.current = { ...stored.current, choreTemplates: [chore] };
    view();
    const coming = screen.getByRole("list", { name: "Coming up" });
    expect(within(coming).getByText("Scrub the waterer")).toBeTruthy();
  });

  it("records a headcount change against this flock from the side panel", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /Headcount/ }));
    const panel = screen.getByRole("dialog");
    await user.selectOptions(within(panel).getByLabelText(/What happened/), "hatched");
    await user.clear(within(panel).getByLabelText(/How many/));
    await user.type(within(panel).getByLabelText(/How many/), "6");
    await user.click(within(panel).getByRole("button", { name: "Record it" }));

    const write = stored.writes.find((entry) => entry.store === "flockAdjustments");
    expect(write?.value).toMatchObject({ flockId: FLOCK.id, reason: "hatched", quantity: 6 });
  });

  it("adds a note as a dated line on top of the flock's notes", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /^Note$/ }));
    const panel = screen.getByRole("dialog");
    await user.type(within(panel).getByLabelText(/Note/), "New feeder in");
    await user.click(within(panel).getByRole("button", { name: "Save note" }));

    const write = stored.writes.find((entry) => entry.store === "flocks");
    expect(write?.id).toBe(FLOCK.id);
    expect(write?.value["notes"]).toMatch(/^\d{4}-\d{2}-\d{2}: New feeder in\n2026-10-01:/);
  });

  it("moves the flock to another coop and keeps a line saying so", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /Move/ }));
    const panel = screen.getByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Move them" }));

    const write = stored.writes.find((entry) => entry.store === "flocks");
    expect(write?.value["zoneId"]).toBe(RUN);
    expect(write?.value["notes"]).toMatch(/Moved from Hen house to Orchard run/);
  });

  it("keeps the flock's fields behind one disclosure, with the editor there", async () => {
    const user = userEvent.setup();
    view();

    expect(screen.queryByText("The one with the red door.")).toBeNull();
    const more = screen.getByRole("button", { name: "Details" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    // The undated notes only — the dated line is already in History.
    expect(screen.getByText("The one with the red door.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit flock" }));
    expect(screen.getByRole("dialog", { name: /Editing The big coop/ })).toBeTruthy();
  });

  it("shows the birds kept by name in the coop, each with a note into the Log", () => {
    const hen = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5B01" as Ulid,
      propertyId: PROPERTY,
      species: "chicken",
      name: "Henrietta",
      sex: "female",
      status: "active",
    } as Animal;
    const placement = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5P01" as Ulid,
      animalId: hen.id,
      zoneId: COOP,
      periodFrom: new Date("2026-01-01"),
    } as ZoneAssignment;
    stored.current = { ...stored.current, animals: [hen], zoneAssignments: [placement] };
    view();

    const birds = screen.getByRole("list", { name: "Birds by name" });
    expect(within(birds).getByText("Henrietta")).toBeTruthy();
    expect(
      within(birds).getByRole("link", { name: "Note on Henrietta" }).getAttribute("href"),
    ).toBe(
      `/admin/log?kind=note&animals=${hen.id}&from=%2Fadmin%2Fchickens%2Fflock%2Fthe-big-coop`,
    );
    expect(birdHref(hen, [FLOCK], [placement])).toBe("/admin/chickens/flock/the-big-coop");
    expect(birdHref(hen, [FLOCK], [])).toBe("/admin/chickens/flock");
  });

  it("answers an old link by id and moves it to the name", () => {
    view(FLOCK.id.toLowerCase());
    expect(screen.getByRole("heading", { level: 1, name: "The big coop" })).toBeTruthy();
    expect(stored.replaced).toEqual(["/admin/chickens/flock/the-big-coop"]);
  });

  it("says so when nothing answers to the address", () => {
    view("the-small-coop");
    expect(screen.getByText("No flock by that name")).toBeTruthy();
  });
});

describe("the flock's address", () => {
  it("is the name, and the id for the second of two flocks that share it", () => {
    const twin = { ...FLOCK, id: "01ARZ3NDEKTSV4RRFFQ69G5F02" as Ulid, name: "The Big Coop!" };
    const flocks = [FLOCK, twin];
    expect(flockHref(FLOCK, flocks)).toBe("/admin/chickens/flock/the-big-coop");
    expect(flockHref(twin, flocks)).toBe(`/admin/chickens/flock/${twin.id.toLowerCase()}`);
    expect(resolveFlockSlug("the-big-coop", flocks)?.flock.id).toBe(FLOCK.id);
    expect(resolveFlockSlug(twin.id.toLowerCase(), flocks)).toEqual({ flock: twin, stale: false });
  });

  it("is a record page: inside Animals › Flock, with no strips drawn", () => {
    const path = "/admin/chickens/flock/the-big-coop";
    expect(destinationFor(path)?.label).toBe("Animals");
    expect(sectionFor(path)?.href).toBe("/admin/chickens/flock");
  });

  it("carries the flock through the Log's contract", () => {
    expect(logHref({ kind: "eggs", flock: FLOCK.id, from: "/admin/chickens/flock/x" })).toBe(
      `/admin/log?kind=eggs&flock=${FLOCK.id}&from=%2Fadmin%2Fchickens%2Fflock%2Fx`,
    );
    expect(logHref({ kind: "eggs" })).toBe("/admin/log?kind=eggs");
  });
});

describe("a week of eggs", () => {
  it("counts this flock's baskets by day, tonight included, and the rate per bird", () => {
    const now = new Date("2026-10-20T07:00:00");
    const other = { ...BASKET, id: "01ARZ3NDEKTSV4RRFFQ69G5E02" as Ulid, flockId: undefined };
    const old = {
      ...BASKET,
      id: "01ARZ3NDEKTSV4RRFFQ69G5E03" as Ulid,
      collectedOn: new Date("2026-10-01T12:00:00"),
    };
    const trend = eggTrend({
      flock: FLOCK,
      adjustments: [],
      eggLogs: [BASKET, other, old],
      now,
    });

    expect(trend.days).toHaveLength(7);
    // Stored at midday, and still counted at seven in the morning.
    expect(trend.today).toBe(11);
    expect(trend.total).toBe(11);
    expect(trend.rate).toBeCloseTo(11 / 18 / 7);
  });
});

describe("the Log's eggs form, opened from a flock", () => {
  it("starts on the flock it was opened for", () => {
    const second = { ...FLOCK, id: "01ARZ3NDEKTSV4RRFFQ69G5F03" as Ulid, name: "Bantams" };
    stored.current = { flocks: [FLOCK, second] };
    stored.search = new URLSearchParams(`kind=eggs&flock=${second.id}`);
    render(
      <ToastProvider>
        <LogFlow propertyId={PROPERTY} actorId={ACTOR} />
      </ToastProvider>,
    );

    expect((screen.getByLabelText("Flock") as HTMLSelectElement).value).toBe(second.id);
  });
});
