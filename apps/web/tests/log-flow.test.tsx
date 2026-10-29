import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";

/**
 * ＋ Log (the v2 Log flow).
 *
 * Two things matter here. The query contract other screens link with —
 * `?kind=` skips step 1, `?animals=` preselects step 2 and skips it when a
 * kind came too — and that a run of animals writes one record each, through
 * the same store the owning screen writes to.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const ROSIE = "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid;
const PEARL = "01ARZ3NDEKTSV4RRFFQ69G5A02" as Ulid;
const BLUE = "01ARZ3NDEKTSV4RRFFQ69G5A03" as Ulid;
const REX = "01ARZ3NDEKTSV4RRFFQ69G5A04" as Ulid;
const PEN = "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
  params: "",
  writes: [] as { store: string; op: string; value: Record<string, unknown> }[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      stored.writes.push({ store, op: "create", value: input });
      return { ok: true, value: input };
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      stored.writes.push({ store, op: "update", value: { id, ...patch } });
      return { ok: true, value: { id, ...patch } };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("@/lib/photos/use-photos", () => ({
  useAttachPhotos: () => ({
    busy: false,
    problem: undefined,
    attach: async () => {},
    clearProblem: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(stored.params),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { LogFlow } = await import("../app/(admin)/admin/log/_components/log-flow.js");
const { logHref, returnTo, startFrom } =
  await import("../app/(admin)/admin/log/_components/log-kinds.js");

function animal(id: Ulid, name: string, extra: Partial<Animal> = {}): Animal {
  return {
    id,
    propertyId: PROPERTY,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    species: "cattle",
    name,
    sex: "female",
    dob: new Date("2020-03-01"),
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...extra,
  } as Animal;
}

const HERD = [
  animal(ROSIE, "Rosie"),
  animal(PEARL, "Pearl"),
  animal(BLUE, "Blue", { sex: "steer" }),
  animal(REX, "Rex", { species: "dog", sex: "male" }),
];

const CALVING_PEN = {
  id: PEN,
  propertyId: PROPERTY,
  name: "Calving pen",
  indoor: false,
  active: true,
  resting: false,
} as unknown as Zone;

function placed(animalId: Ulid, n: number): ZoneAssignment {
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5Q0${n}` as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    animalId,
    zoneId: PEN,
    slot: "outside",
    periodFrom: new Date("2026-01-01"),
  } as ZoneAssignment;
}

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <LogFlow propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = {
    animals: HERD,
    zones: [CALVING_PEN],
    zoneAssignments: [placed(ROSIE, 1), placed(PEARL, 2)],
  };
  stored.params = "";
  stored.writes = [];
});

describe("where the log flow opens", () => {
  it("starts at step 1 with nothing asked", () => {
    expect(startFrom({ kind: null, animals: null }, HERD)).toEqual({
      kind: undefined,
      animalIds: [],
      step: 1,
    });
  });

  it("skips step 1 for a kind, and step 2 too when animals came with it", () => {
    expect(startFrom({ kind: "treatment", animals: null }, HERD).step).toBe(2);
    expect(startFrom({ kind: "treatment", animals: `${ROSIE},${PEARL}` }, HERD)).toEqual({
      kind: "treatment",
      animalIds: [ROSIE, PEARL],
      step: 3,
    });
  });

  it("drops animals that cannot take the kind, and asks who when none are left", () => {
    expect(startFrom({ kind: "heat", animals: `${BLUE},${ROSIE}` }, HERD).animalIds).toEqual([
      ROSIE,
    ]);
    expect(startFrom({ kind: "heat", animals: BLUE }, HERD)).toMatchObject({
      animalIds: [],
      step: 2,
    });
  });

  it("keeps one cow for a calving, and needs no animals for eggs", () => {
    expect(startFrom({ kind: "calving", animals: `${ROSIE},${PEARL}` }, HERD).animalIds).toEqual([
      ROSIE,
    ]);
    expect(startFrom({ kind: "eggs", animals: null }, HERD).step).toBe(3);
  });

  it("preselects animals without a kind, and ignores a kind it does not know", () => {
    expect(startFrom({ kind: "dance", animals: ROSIE }, HERD)).toEqual({
      kind: undefined,
      animalIds: [ROSIE],
      step: 1,
    });
  });
});

describe("where the log flow closes to", () => {
  it("goes back to the admin page it came from", () => {
    expect(returnTo("/admin/cattle/andromeda")).toBe("/admin/cattle/andromeda");
    expect(returnTo("/admin/feed?tab=shed")).toBe("/admin/feed?tab=shed");
    expect(returnTo(null)).toBe("/admin");
  });

  it("never leaves the admin, and never loops back into the Log", () => {
    for (const from of [
      "https://example.com",
      "//example.com",
      "/admin//example.com",
      "/\\example.com",
      "/administer",
      "/kiosk",
      "/admin/log",
      "/admin/log?kind=weight",
    ]) {
      expect(returnTo(from)).toBe("/admin");
    }
  });

  it("carries the page into the Log's address", () => {
    expect(logHref({ kind: "weight", animals: [ROSIE], from: "/admin/cattle/andromeda" })).toBe(
      `/admin/log?kind=weight&animals=${ROSIE}&from=%2Fadmin%2Fcattle%2Fandromeda`,
    );
    expect(logHref({ from: "/admin" })).toBe("/admin/log");
    expect(logHref({ from: "/admin/log" })).toBe("/admin/log");
  });
});

describe("the log flow", () => {
  it("closes back to the page it was opened from, before and after saving", async () => {
    const user = userEvent.setup();
    stored.params = `kind=weight&animals=${ROSIE}&from=%2Fadmin%2Fcattle%2Fandromeda`;
    view();

    expect(screen.getByRole("link", { name: "Close" }).getAttribute("href")).toBe(
      "/admin/cattle/andromeda",
    );
    await user.type(screen.getByLabelText(/Weight of Rosie/), "1180");
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    expect(screen.getByRole("link", { name: "Done" }).getAttribute("href")).toBe(
      "/admin/cattle/andromeda",
    );
  });

  it("goes what → who → details → saved, one treatment per animal", async () => {
    const user = userEvent.setup();
    view();

    expect(screen.getByRole("heading", { name: "Log what?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Treatment/ }));

    // Cattle only — not the dog — and the pen is a quick group.
    const list = screen.getByRole("list", { name: "Animals" });
    expect(within(list).queryByText("Rex")).toBeNull();
    expect(within(list).getByText("Blue")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Whole Calving pen/ }));
    await user.click(screen.getByRole("button", { name: "Next · 2 animals" }));

    expect(screen.getByText("For Rosie, Pearl")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save for 2 animals" }));

    const treatments = stored.writes.filter((write) => write.store === "healthRecords");
    expect(treatments.map((write) => write.value["animalId"]).sort()).toEqual(
      [ROSIE, PEARL].sort(),
    );
    expect(screen.getByRole("heading", { name: "Saved for 2 animals" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Done" }).getAttribute("href")).toBe("/admin");
  });

  it("opens on the details when linked with a kind and animals", async () => {
    const user = userEvent.setup();
    stored.params = `kind=weight&animals=${ROSIE},${PEARL}`;
    view();

    expect(screen.getByText("Step 3 of 3")).toBeTruthy();
    await user.type(screen.getByLabelText("Weight of Rosie (lb)"), "1180");
    await user.type(screen.getByLabelText("Weight of Pearl (lb)"), "1225");
    await user.click(screen.getByRole("button", { name: "Save for 2 animals" }));

    const weights = stored.writes.filter((write) => write.store === "weightRecords");
    expect(weights.map((write) => [write.value["animalId"], write.value["weightLb"]])).toEqual([
      [ROSIE, 1180],
      [PEARL, 1225],
    ]);
  });

  it("goes back to who from the details, keeping the choice", async () => {
    const user = userEvent.setup();
    stored.params = `kind=note&animals=${ROSIE}`;
    view();

    await user.click(screen.getByRole("button", { name: "Back" }));
    const rosie = within(screen.getByRole("list", { name: "Animals" })).getByRole("button", {
      name: /Rosie/,
    });
    expect(rosie.getAttribute("aria-pressed")).toBe("true");
  });

  it("allows only one cow for a calving", async () => {
    const user = userEvent.setup();
    stored.params = "kind=calving";
    view();

    const list = screen.getByRole("list", { name: "Animals" });
    await user.click(within(list).getByRole("button", { name: /Rosie/ }));
    await user.click(within(list).getByRole("button", { name: /Pearl/ }));

    expect(within(list).getByRole("button", { name: /Pearl/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(within(list).getByRole("button", { name: /Rosie/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    // Steers are not offered for a calving at all.
    expect(within(list).queryByText("Blue")).toBeNull();
    expect(screen.getByRole("button", { name: "Next · 1 animal" })).toBeTruthy();
  });

  it("moves a run of animals through moveToZone, one assignment each", async () => {
    const user = userEvent.setup();
    const NORTH = "01ARZ3NDEKTSV4RRFFQ69G5Z02" as Ulid;
    stored.current = {
      ...stored.current,
      zones: [CALVING_PEN, { ...CALVING_PEN, id: NORTH, name: "North trap" } as unknown as Zone],
    };
    stored.params = `kind=move&animals=${ROSIE},${PEARL}`;
    view();

    await user.selectOptions(screen.getByLabelText(/^To/), NORTH);
    await user.click(screen.getByRole("button", { name: "Move 2 animals" }));

    const writes = stored.writes.filter((write) => write.store === "zoneAssignments");
    // Each closes her calving-pen row and opens a North trap one.
    expect(writes.filter((write) => write.op === "update")).toHaveLength(2);
    expect(
      writes.filter((write) => write.op === "create").map((write) => write.value["zoneId"]),
    ).toEqual([NORTH, NORTH]);
  });

  it("logs eggs with no animals step", async () => {
    const user = userEvent.setup();
    stored.params = "kind=eggs";
    view();

    await user.click(screen.getByRole("button", { name: "Add 12" }));
    await user.click(screen.getByRole("button", { name: "Save 12 eggs" }));

    expect(stored.writes.find((write) => write.store === "eggLogs")?.value["total"]).toBe(12);
    expect(screen.getByRole("heading", { name: "12 eggs saved" })).toBeTruthy();
  });
});
