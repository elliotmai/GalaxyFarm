import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * Getting to a species (decision 45): the title on every animal page opens the
 * five species and Every animal, with their counts, and the choice is kept so
 * the Animals tab reopens it.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

const stored = vi.hoisted(() => ({ current: {} as Record<string, readonly unknown[]> }));
vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
}));

const { SpeciesSwitcher } = await import("../app/(admin)/_components/species-switcher.js");
const { lastAnimalHome, rememberAnimalHome } = await import("../lib/last-species.js");

const animal = (id: string, species: string, status = "active"): Animal =>
  ({ id: id as Ulid, propertyId: PROPERTY, species, status, sex: "female" }) as unknown as Animal;

beforeEach(() => {
  window.localStorage.clear();
  stored.current = {
    animals: [
      animal("01ARZ3NDEKTSV4RRFFQ69G5A01", "cattle"),
      animal("01ARZ3NDEKTSV4RRFFQ69G5A02", "cattle"),
      animal("01ARZ3NDEKTSV4RRFFQ69G5A03", "cattle", "sold"),
      animal("01ARZ3NDEKTSV4RRFFQ69G5A04", "dog"),
    ],
    flocks: [{ id: "01ARZ3NDEKTSV4RRFFQ69G5F01", active: true }],
  };
});

describe("the species switcher", () => {
  it("is the page's title, and opens every species with what is here", async () => {
    const user = userEvent.setup();
    render(<SpeciesSwitcher propertyId={PROPERTY} current="/admin/cattle" detail="2 head" />);

    const title = screen.getByRole("heading", { level: 1, name: /^Cattle/ });
    await user.click(within(title).getByRole("button"));

    const menu = screen.getByRole("menu", { name: "Species" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Cattle2",
      "Horses0",
      "Chickens1",
      "Dogs1",
      "Cats0",
      "Every animal4",
    ]);
    expect(items[0]?.getAttribute("aria-current")).toBe("page");
    expect(items[3]?.getAttribute("href")).toBe("/admin/pets/dogs");
  });

  it("remembers the species it stands on, for the Animals tab", () => {
    render(<SpeciesSwitcher propertyId={PROPERTY} current="/admin/horses" />);
    expect(lastAnimalHome()).toBe("/admin/horses");
  });
});

describe("where the Animals tab opens", () => {
  it("opens on every animal until a species has been chosen, and ignores junk", () => {
    expect(lastAnimalHome()).toBe("/admin/animals");
    window.localStorage.setItem("gf-animals-home", "https://example.com");
    expect(lastAnimalHome()).toBe("/admin/animals");
    rememberAnimalHome("/admin/pets/cats");
    expect(lastAnimalHome()).toBe("/admin/pets/cats");
  });
});
