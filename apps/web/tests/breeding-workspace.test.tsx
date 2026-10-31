import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";
import type {
  BreedingRecord,
  CattleProfile,
  ExternalAnimal,
  GeneticTest,
  ParentRef,
  PlannedMating,
  SemenInventory,
} from "@galaxy-farm/module-cattle";

/**
 * The desk breeding workspace (spec §5.2).
 *
 * Three panes — cows to breed, a sire, the pairing — and one write: a planned
 * mating through the roadmap's own mutation. These pin who makes the list,
 * that the tank leads, that the pairing reads the planner's functions, and
 * that planning creates (or re-points) exactly one open plan.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
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
  usePathname: () => "/admin/breeding",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { BreedingWorkspace } =
  await import("../app/(admin)/admin/breeding/_components/breeding-workspace.js");
const { analysePairing, cowsToBreed, onFileMatch, polledOutlook, readHorn, seasonOf } =
  await import("../app/(admin)/admin/breeding/_components/workspace-logic.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const base = { propertyId: PROPERTY, createdAt: ago(400), updatedAt: ago(400) };

function cow(id: string, name: string): Animal {
  return {
    ...base,
    id: id as Ulid,
    species: "cattle",
    name,
    sex: "female",
    dob: ago(6 * 365),
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
  } as Animal;
}

const MARIGOLD = cow("01ARZ3NDEKTSV4RRFFQ69G5A01", "Marigold");
const ROSIE = cow("01ARZ3NDEKTSV4RRFFQ69G5A02", "Rosie");
const DUCHESS = cow("01ARZ3NDEKTSV4RRFFQ69G5A03", "Duchess");
const PEARL = cow("01ARZ3NDEKTSV4RRFFQ69G5A04", "Pearl");

const free: GeneticTest[] = [
  { defect: "TH", status: "free" },
  { defect: "PHA", status: "free" },
  { defect: "DS", status: "free" },
];
const phaCarrier: GeneticTest[] = [
  { defect: "TH", status: "free" },
  { defect: "PHA", status: "carrier" },
  { defect: "DS", status: "free" },
];

const profile = (animal: Animal, over: Partial<CattleProfile> = {}): CattleProfile =>
  ({
    ...base,
    id: `${animal.id.slice(0, -2)}P${animal.id.slice(-1)}` as Ulid,
    animalId: animal.id,
    breedComposition: [],
    geneticTests: free,
    registrations: [],
    hornStatus: "polled",
    ...over,
  }) as CattleProfile;

const MONTEGO = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid,
  name: "ZNT Montego Bay 14B",
  sex: "male",
  association: "Maine-Anjou",
  regNumber: "MA400001",
  geneticTests: free,
  hornStatus: "Polled",
} as ExternalAnimal;

const HAWK = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5E02" as Ulid,
  name: "Black Hawk 112P",
  sex: "male",
  association: "Chianina",
  regNumber: "CA240047",
  geneticTests: phaCarrier,
  hornStatus: "Horned",
} as ExternalAnimal;

const straw = (id: string, sire: ExternalAnimal, count: number): SemenInventory =>
  ({
    ...base,
    id: id as Ulid,
    sireExternalId: sire.id,
    sireName: sire.name,
    strawsOnHand: count,
  }) as SemenInventory;

const MONTEGO_STRAW = straw("01ARZ3NDEKTSV4RRFFQ69G5S01", MONTEGO, 6);
const HAWK_STRAW = straw("01ARZ3NDEKTSV4RRFFQ69G5S02", HAWK, 1);

const bred = (id: string, dam: Animal, daysAgo: number, over: Partial<BreedingRecord> = {}) =>
  ({
    ...base,
    id: id as Ulid,
    damId: dam.id,
    method: "AI",
    date: ago(daysAgo),
    ...over,
  }) as BreedingRecord;

const BREEDINGS = [
  // Due in about a month: calves before the season, so she is on the list.
  bred("01ARZ3NDEKTSV4RRFFQ69G5R01", ROSIE, 253),
  // Bred three weeks ago: carrying well past the season, so she is not.
  bred("01ARZ3NDEKTSV4RRFFQ69G5R02", DUCHESS, 20),
  // Checked open: back on the list.
  bred("01ARZ3NDEKTSV4RRFFQ69G5R03", PEARL, 60, {
    pregCheck: { date: ago(20), result: "open", method: "ultrasound" },
  } as Partial<BreedingRecord>),
];

const ROSIE_PLAN = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5M01" as Ulid,
  damId: ROSIE.id,
  method: "AI",
  semenInventoryId: HAWK_STRAW.id,
  sireExternalId: HAWK.id,
  planStatus: "open",
} as PlannedMating;

function view() {
  return render(
    <ToastProvider>
      <BreedingWorkspace propertyId={PROPERTY} actorId={ACTOR} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  saved.created = [];
  saved.updated = [];
  stored.current = {
    animals: [MARIGOLD, ROSIE, DUCHESS, PEARL],
    cattleProfiles: [profile(MARIGOLD), profile(ROSIE), profile(DUCHESS), profile(PEARL)],
    externalAnimals: [MONTEGO, HAWK],
    breedingRecords: BREEDINGS,
    plannedMatings: [ROSIE_PLAN],
    semenInventory: [HAWK_STRAW, MONTEGO_STRAW],
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("The breeding workspace", () => {
  it("lists the open cows and the ones calving before the season, with a plan chip", () => {
    view();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      `Breeding · ${seasonOf(new Date())}`,
    );
    expect(screen.getByText(/1 of 3 cows planned · 7 straws in the tank/)).toBeTruthy();

    const cows = within(screen.getByRole("region", { name: "Cows to breed" }));
    const rows = cows.getAllByRole("button").map((button) => button.textContent);
    // Rosie first (a date on her), then the open cows by name; Duchess is
    // carrying past the season and is not asked about.
    expect(rows[0]).toMatch(/^Rosie.*Calves.*Planned$/);
    expect(rows[1]).toMatch(/^Marigold.*Open.*To plan$/);
    expect(rows[2]).toMatch(/^Pearl.*came back open.*To plan$/);
    expect(rows.join(" ")).not.toMatch(/Duchess/);
  });

  it("puts the tank first and plans a mating through the roadmap's write", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /^Marigold/ }));
    const sires = within(screen.getByRole("region", { name: "Pick a sire" }));
    // Most stocked straw first.
    const tank = sires.getAllByRole("button", { pressed: false }).map((b) => b.textContent);
    expect(tank.findIndex((text) => text?.startsWith("ZNT Montego"))).toBeLessThan(
      tank.findIndex((text) => text?.startsWith("Black Hawk")),
    );

    await user.click(sires.getByRole("button", { name: /^ZNT Montego Bay 14B/ }));

    const pairing = within(screen.getByRole("region", { name: "This pairing" }));
    expect(pairing.getByText("None found")).toBeTruthy();
    expect(pairing.getByText("At least 3 in 4 polled")).toBeTruthy();
    expect(pairing.getByText("None in 4 generations")).toBeTruthy();

    await user.click(pairing.getByRole("button", { name: "Plan this mating" }));

    expect(saved.created).toEqual([
      {
        store: "plannedMatings",
        input: expect.objectContaining({
          damId: MARIGOLD.id,
          method: "AI",
          semenInventoryId: MONTEGO_STRAW.id,
          sireExternalId: MONTEGO.id,
          targetSeason: seasonOf(new Date()),
          planStatus: "open",
        }),
      },
    ]);
  });

  it("refuses a carrier pairing out loud", async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole("button", { name: /^Marigold/ }));
    await user.click(screen.getByRole("button", { name: /^Black Hawk/ }));

    const pairing = within(screen.getByRole("region", { name: "This pairing" }));
    expect(pairing.getByText("PHA carriers, none affected")).toBeTruthy();
    expect(pairing.getByRole("alert").textContent).toMatch(/carries PHA/);
    expect(pairing.getByText("At least half polled")).toBeTruthy();
  });

  it("shows a planned cow's bull, and re-points her plan rather than doubling it", async () => {
    const user = userEvent.setup();
    view();

    // Rosie is first, so she is open already; her planned straw is picked.
    const pairing = within(screen.getByRole("region", { name: "This pairing" }));
    expect(pairing.getByRole("button", { name: "Planned ✓" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: /^ZNT Montego Bay 14B/ }));
    await user.click(pairing.getByRole("button", { name: "Change her plan" }));

    expect(saved.created).toEqual([]);
    expect(saved.updated).toEqual([
      {
        store: "plannedMatings",
        id: ROSIE_PLAN.id,
        patch: expect.objectContaining({
          semenInventoryId: MONTEGO_STRAW.id,
          sireExternalId: MONTEGO.id,
        }),
      },
    ]);
  });

  it("searches the catalog and only picks a bull already on file", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        total: 2,
        found: [
          // Montego, spelled the way the crawl spells him.
          { name: "ZNT MONTEGO BAY 14B", association: "MAINE-ANJOU", regNumber: "MA 400001" },
          { name: "Somebody Else", association: "Chianina", regNumber: "CA999" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();

    const sires = within(screen.getByRole("region", { name: "Pick a sire" }));
    await user.click(sires.getByRole("button", { name: "Catalog search" }));
    await user.type(sires.getByRole("textbox", { name: "Name or registration" }), "montego");
    await user.click(sires.getByRole("button", { name: "Search" }));

    expect(String(fetchMock.mock.calls[0]?.[0 as never])).toMatch(
      /^\/api\/registry\/search\?text=montego&sex=male/,
    );
    const results = within(sires.getByRole("list", { name: "Catalog results" }));
    expect(results.getByRole("button", { name: /^ZNT Montego Bay 14B/ })).toBeTruthy();
    expect(results.getByRole("link", { name: "Bring across" }).getAttribute("href")).toBe(
      "/admin/cattle/catalog?text=CA999",
    );
  });
});

describe("Workspace arithmetic", () => {
  it("names the season by the calf it produces", () => {
    expect(seasonOf(new Date(2026, 9, 28))).toBe("2027 season");
    expect(seasonOf(new Date(2026, 1, 1))).toBe("2026 season");
  });

  it("reads horn status loosely, dehorned as horned", () => {
    expect(readHorn("Dehorned")).toBe("horned");
    expect(readHorn("POLLED")).toBe("polled");
    expect(readHorn("Scurred")).toBe("scurred");
    expect(readHorn(undefined)).toBeUndefined();
    expect(polledOutlook("horned", "horned")).toBe("Horned — both parents horned");
    expect(polledOutlook("polled", "horned")).toBe("At least half polled");
    expect(polledOutlook("scurred", "scurred")).toBe("3 in 4 polled");
    expect(polledOutlook("polled", undefined)).toMatch(/Not known/);
  });

  it("drops a cow whose service is long overdue with no calving back onto the list", () => {
    const rows = cowsToBreed({
      animals: [DUCHESS],
      profiles: [],
      breedings: [bred("01ARZ3NDEKTSV4RRFFQ69G5R09", DUCHESS, 400)],
      calvings: [],
      plans: [],
      now: NOW,
    });
    expect(rows.map((row) => row.state.kind)).toEqual(["open"]);
  });

  it("matches a catalog result to the ancestor on file across spellings", () => {
    expect(
      onFileMatch({ association: "Maine-Anjou", regNumber: "MA-400001" }, [HAWK, MONTEGO])?.id,
    ).toBe(MONTEGO.id);
    expect(onFileMatch({ association: "Chianina", regNumber: "CA1" }, [HAWK])).toBeUndefined();
  });

  it("calls a half-sib pairing close and names the shared sire", () => {
    const sire: ParentRef = { kind: "external", id: MONTEGO.id };
    const dam: ParentRef = { kind: "animal", id: MARIGOLD.id };
    const grandsire: ParentRef = { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5E09" as Ulid };
    const source = {
      parentsOf: (ref: ParentRef) =>
        ref.id === sire.id || ref.id === dam.id ? { sire: grandsire } : undefined,
      describe: (ref: ParentRef) =>
        ref.id === grandsire.id ? { name: "Old Sire", regNumber: "MA1" } : { name: "x" },
    };

    const result = analysePairing({
      sireRef: sire,
      damRef: dam,
      sireTests: free,
      damTests: free,
      sireCoat: undefined,
      damCoat: undefined,
      sireHorn: "polled",
      damHorn: "polled",
      source,
    });

    const fact = (label: string) => result.facts.find((entry) => entry.label === label)?.value;
    expect(fact("Relatedness")).toBe("12.5% — half-sibs or closer");
    expect(fact("Shared ancestors")).toBe("Old Sire MA1");
    expect(fact("Coat colour")).toBe("Nothing to go on yet");
    expect(result.refusal).toBe("These two are close.");
  });
});
