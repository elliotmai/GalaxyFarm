import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("A cow that came back open", () => {
  /** Bred 14 February, scanned open on 25 March. */
  const OPEN = {
    ...BREEDING,
    pregCheck: { date: new Date("2026-03-25"), result: "open", method: "ultrasound" },
  } as BreedingRecord;

  /** Bred again on 6 April — a different bull, by a different method. */
  const AGAIN = {
    ...base,
    id: "01ARZ3NDEKTSV4RRFFQ69G5B02" as Ulid,
    damId: ANDROMEDA.id,
    method: "natural",
    sireName: "Nichols Legacy G151",
    date: new Date("2026-04-06"),
  } as BreedingRecord;

  beforeEach(() => {
    vi.setSystemTime(new Date("2026-04-20T08:00:00Z"));
  });

  it("counts her as one to re-breed until she is", () => {
    stored.current = { animals: [ANDROMEDA], breedingRecords: [OPEN], calvingRecords: [] };
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    // Label, count and hint sit in one tile.
    const tile = screen.getByText("To re-breed").parentElement?.parentElement as HTMLElement;
    expect(flat(tile)).toBe("To re-breed1Came back open");
  });

  it("keeps both services under one attempt, in order", () => {
    stored.current = {
      animals: [ANDROMEDA],
      breedingRecords: [OPEN, AGAIN],
      calvingRecords: [],
    };
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const log = screen.getByRole("table", { name: /Breeding records/ });
    const rows = within(log).getAllByRole("row").slice(1);

    // Earliest first inside the attempt, and each row says which try it was.
    expect(flat(rows[0] as HTMLElement)).toContain("1st of 2");
    expect(flat(rows[1] as HTMLElement)).toContain("2nd of 2");
  });

  it("retires the service the re-breeding answered", () => {
    stored.current = {
      animals: [ANDROMEDA],
      breedingRecords: [OPEN, AGAIN],
      calvingRecords: [],
    };
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    const log = screen.getByRole("table", { name: /Breeding records/ });
    const first = within(log).getByText("1st of 2").closest("tr") as HTMLElement;

    expect(within(first).getByText("Re-bred")).toBeTruthy();
    // And it points at what answered it rather than at a pregnancy it never made.
    expect(flat(first)).toContain(`Bred again ${shown(AGAIN.date)}`);
  });

  it("prefills the cow but never the bull that just failed", async () => {
    // Real timers: nothing here depends on the date, and user-event's own
    // waiting never resolves against a frozen clock.
    vi.useRealTimers();
    const user = userEvent.setup();
    stored.current = { animals: [ANDROMEDA], breedingRecords: [OPEN], calvingRecords: [] };
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getAllByRole("button", { name: "Re-breed" })[0] as HTMLElement);

    // The cow is filled in and the sire is deliberately empty: she may go back
    // to the same bull and she may not, and one tap on a prefilled bull would
    // record a service that never happened.
    const dams = screen.getAllByRole("combobox", { name: /^Dam\b/ });
    expect((dams[dams.length - 1] as HTMLInputElement).value).toContain("Andromeda");

    const sires = screen.getAllByRole("combobox", { name: /^Sire\b/ });
    expect((sires[sires.length - 1] as HTMLInputElement).value).toBe("");

    // What failed is named, so nobody has to go and look it up. (The bull's
    // name is also down in the log, hence the callout rather than the page.)
    const callout = screen.getByText(/came back open/);
    expect(flat(callout)).toContain("ZNT Montego Bay");
    expect(flat(callout)).toContain(shown(OPEN.date));
  });

  it("offers the same bull as one tap, for when it is the same", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    stored.current = { animals: [ANDROMEDA], breedingRecords: [OPEN], calvingRecords: [] };
    view(<BreedingScreen propertyId={PROPERTY} actorId={ACTOR} />);

    await user.click(screen.getAllByRole("button", { name: "Re-breed" })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Same bull and method" }));

    const sires = screen.getAllByRole("combobox", { name: /^Sire\b/ });
    expect((sires[sires.length - 1] as HTMLInputElement).value).toBe("ZNT Montego Bay");
  });
});
