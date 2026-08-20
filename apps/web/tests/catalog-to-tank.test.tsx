import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

/**
 * The catalog visit ends where it was aimed: at a straw (spec §5.2, §7).
 *
 * The screen's own words are that it is "used at a desk, once, when a straw is
 * being considered" — and it stopped one step short of the straw. The bull and
 * his four generations came across into Ancestors, and the tank was a separate
 * errand on another screen where his name got typed in again by hand. Two
 * records about one bull, joined by a string, and the pedigree just imported
 * unused by the calf that comes of it.
 */

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
const saved = vi.hoisted(() => ({
  created: [] as { store: string; input: Record<string, unknown> }[],
}));

const NEW_ID = "01ARZ3NDEKTSV4RRFFQ69G5E77";

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: (store: string) => ({
    create: async (input: Record<string, unknown>) => {
      saved.created.push({ store, input });
      return { ok: true, value: { id: NEW_ID, ...input } };
    },
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/cattle/catalog",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const { CatalogScreen } =
  await import("../app/(admin)/admin/cattle/catalog/_components/catalog-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const BULL = {
  name: "ZNT Montego Bay",
  association: "Maine-Anjou",
  regNumber: "MA364424",
  sex: "male",
  colour: "red",
};

/** The crawl, as the two routes answer. */
function serve(animal: Record<string, unknown>) {
  return vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("/api/registry/search")
        ? { found: [animal], total: 1 }
        : { animal, pedigree: [] },
  })) as unknown as typeof fetch;
}

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <CatalogScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

/** Search, open the bull, and bring him across. */
async function bringAcross(animal: Record<string, unknown> = BULL) {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", serve(animal));
  view();

  await user.type(screen.getByLabelText(/^Name, number or tattoo/), "Montego");
  await user.click(screen.getByRole("button", { name: "Search" }));

  // Out of the results table: the name appears again in the preview below it.
  const results = await screen.findByRole("table", { name: /Catalog search results/ });
  await user.click(within(results).getByRole("button", { name: animal.name as string }));
  await user.click(await screen.findByRole("button", { name: /Bring 1 across/ }));

  return user;
}

beforeEach(() => {
  saved.created = [];
  stored.current = { externalAnimals: [] };
});

describe("Bringing a bull across", () => {
  it("offers him to the tank while the reason for fetching him is fresh", async () => {
    const user = await bringAcross();

    const offer = await screen.findByText(/Straws of him in the tank\?/);
    expect(offer).toBeTruthy();

    await user.clear(screen.getByLabelText(/^Straws/));
    await user.type(screen.getByLabelText(/^Straws/), "8");
    await user.click(screen.getByRole("button", { name: "Add to the tank" }));

    // The reference, not the name: this is what a breeding drawn from the cane
    // inherits, and what pedigrees the calf at calving.
    expect(saved.created.filter((write) => write.store === "semenInventory")).toEqual([
      {
        store: "semenInventory",
        input: { sireExternalId: NEW_ID, sireName: "ZNT Montego Bay", strawsOnHand: 8 },
      },
    ]);
  });

  it("does not offer a cow to the semen tank", async () => {
    await bringAcross({ ...BULL, name: "CMAC Samantha", sex: "female" });

    expect(screen.queryByText(/in the tank\?/)).toBeNull();
  });

  it("takes no for an answer", async () => {
    const user = await bringAcross();

    await user.click(await screen.findByRole("button", { name: "Not now" }));

    expect(screen.queryByText(/in the tank\?/)).toBeNull();
    expect(saved.created.filter((write) => write.store === "semenInventory")).toEqual([]);
  });
});
