import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("@/app/_components/sync-provider", () => ({
  useSync: () => ({
    offline: false,
    problem: undefined,
    syncing: false,
    pending: 0,
    stuck: 0,
    retryStuck: async () => {},
  }),
}));

const { AdminNav } = await import("../app/(admin)/_components/admin-nav.js");
const { SectionStrip } = await import("../app/(admin)/_components/section-strip.js");

/**
 * The restructure, as rendered (spec §7, §8 v0.9).
 *
 * `nav-reachability.test.ts` proves the data still reaches every route. This
 * proves the two components actually put it on screen — that the rail is short,
 * that the views which used to be sidebar rows appear as tabs on the screen
 * they belong to, and that exactly one thing is marked current.
 */

function at(route: string) {
  pathname.current = route;
}

describe("AdminNav", () => {
  it("shows five destinations, not fifty-five links", () => {
    at("/admin");
    render(<AdminNav farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    for (const label of ["Today", "Animals", "Land", "Kit", "Business"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }

    // The views that used to sit in the sidebar are not in it any more.
    expect(within(nav).queryByRole("link", { name: "Breeding" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Calving" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Eggs" })).not.toBeInTheDocument();
  });

  it("keeps the utility rail reachable but quiet", () => {
    at("/admin");
    render(<AdminNav farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    for (const label of ["Contacts", "Reports", "Housesitter", "Settings"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks exactly one destination as current", () => {
    at("/admin/cattle/breeding");
    render(<AdminNav farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/Animals/);
  });
});

describe("SectionStrip", () => {
  it("puts the thirteen cattle views on the cattle screen", () => {
    at("/admin/cattle/breeding");
    render(<SectionStrip />);

    const views = screen.getByRole("navigation", { name: "Cattle views" });
    for (const label of ["Herd", "Breeding", "Calving", "Health", "Weights", "Sales"]) {
      expect(within(views).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("offers the other species alongside cattle", () => {
    at("/admin/cattle");
    render(<SectionStrip />);

    const sections = screen.getByRole("navigation", { name: "Animals sections" });
    for (const label of ["Cattle", "Flock", "Horses", "Pets"]) {
      expect(within(sections).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the view being looked at, not merely its prefix", () => {
    at("/admin/cattle/breeding");
    render(<SectionStrip />);

    const views = screen.getByRole("navigation", { name: "Cattle views" });
    const current = within(views)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Breeding");
  });

  it("shows nothing where there is no choice to make", () => {
    // A destination with one section and no sub-views has no strip to draw;
    // a single tab is chrome pretending to be navigation.
    at("/admin/contacts");
    const { container } = render(<SectionStrip />);
    expect(container).toBeEmptyDOMElement();
  });
});
