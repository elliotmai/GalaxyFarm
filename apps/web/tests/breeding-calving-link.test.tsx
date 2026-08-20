import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Animal, Ulid } from "@galaxy-farm/core";
import type { BreedingRecord, CalvingRecord } from "@galaxy-farm/module-cattle";

/**
 * A breeding and the calving that answers it (spec §5.2).
 *
 * `calvingRecords.breedingRecordId` has always been written by the calving
 * flow and never read back, so the two logs did not know about each other. The
 * visible cost was the watch: a cow with a calf at side kept her card, her row
 * and her nightly alert until the window closed a fortnight later — the exact
 * thing the watch's own rule about confirmed-open cows exists to prevent.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: (store: string, id: string | undefined) => ({
    record: (stored.current[store] ?? []).find((r) => (r as { id: string }).id === id),
    loading: false,
  }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async () => ({ ok: true, value: {} }),
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/cattle/breeding",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { BreedingScreen } =
  await import("../app/(admin)/admin/cattle/breeding/_components/breeding-screen.js");
const { CalvingScreen } =
  await import("../app/(admin)/admin/cattle/calving/_components/calving-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const BREEDING_ID = "01ARZ3NDEKTSV4RRFFQ69G5B01" as Ulid;

const base = {
  propertyId: PROPERTY,
  createdAt: new Date("2026-02-14"),
  updatedAt: new Date("2026-02-14"),
};

const ANDROMEDA = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5A01" as Ulid,
  species: "cattle",
  name: "Andromeda",
  tagNumber: "6001A",
  sex: "female",
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

const CALF = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5A02" as Ulid,
  species: "cattle",
  tagNumber: "601P",
  sex: "female",
  dob: new Date("2026-11-22"),
  dobIsEstimate: false,
  status: "active",
  ownership: "own",
  safetyLevel: 1,
  photoKeys: [],
} as Animal;

/** Bred by AI on 14 February 2026 — due 24 November at the flat 283 days. */
const BREEDING = {
  ...base,
  id: BREEDING_ID,
  damId: ANDROMEDA.id,
  method: "AI",
  sireName: "ZNT Montego Bay",
  date: new Date("2026-02-14"),
} as BreedingRecord;

/** She calved on the 22nd, two days early. */
const CALVING = {
  ...base,
  id: "01ARZ3NDEKTSV4RRFFQ69G5C01" as Ulid,
  damId: ANDROMEDA.id,
  breedingRecordId: BREEDING_ID,
  date: new Date("2026-11-22"),
  calvingEase: 1,
  birthType: "natural",
  vigour: "vigorous",
  calfSex: "female",
  assisted: false,
  calfAnimalId: CALF.id,
} as CalvingRecord;

/** Inside her window, and the day after she calved. */
const IN_WINDOW = new Date("2026-11-23T08:00:00Z");

/** The same words the screens print, so the assertion is not locale-bound. */
const shown = (value: Date) =>
  value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** A cell's text, with the whitespace between JSX nodes collapsed. */
const flat = (element: HTMLElement) => (element.textContent ?? "").replace(/\s+/g, " ").trim();

function view(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(IN_WINDOW);
  stored.current = {
    animals: [ANDROMEDA, CALF],
    breedingRecords: [BREEDING],
    calvingRecords: [CALVING],
  };
});

describe("The breeding log", () => {
  it("shows the calf the service produced", () => {
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const log = screen.getByRole("table", { name: /Breeding records/ });
    const row = within(log).getByText("601P").closest("tr") as HTMLElement;

    expect(within(row).getByText("Calved")).toBeTruthy();
    expect(flat(row)).toContain(shown(CALVING.date));
  });

  it("stops watching a cow who has calved", () => {
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    // She is inside the fortnight and there is a calf at side. The section is
    // headed "In the calving window" and must not be there at all.
    expect(screen.queryByText("In the calving window")).toBeNull();
  });

  it("still watches her while she is carrying", () => {
    stored.current = { ...stored.current, calvingRecords: [] };
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    expect(screen.getByText("In the calving window")).toBeTruthy();
  });
});

describe("The calving log", () => {
  it("names the service the calving answers, and how long she carried", () => {
    view(<CalvingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const log = screen.getByRole("table", { name: /Calving records/ });
    const row = within(log).getByText("281 d").closest("tr") as HTMLElement;

    // The service it answers: the method and the day she was bred.
    expect(flat(row)).toContain(`AI ${shown(BREEDING.date)}`);
  });

  it("says so when a calving has no service on file", () => {
    stored.current = {
      ...stored.current,
      calvingRecords: [{ ...CALVING, breedingRecordId: undefined }],
    };
    view(<CalvingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const log = screen.getByRole("table", { name: /Calving records/ });
    expect(within(log).getByText("Not linked")).toBeTruthy();
  });
});
