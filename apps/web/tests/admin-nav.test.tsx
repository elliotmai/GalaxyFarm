import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

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
  // The badge reads the status; everything else reads the store and the
  // controls, which is the whole reason those are two contexts.
  useSyncEngine: () => ({
    store: undefined,
    syncNow: async () => {},
    retryStuck: async () => {},
  }),
}));

const { AdminNav, BottomTabs } = await import("../app/(admin)/_components/admin-nav.js");
const { default: MorePage } = await import("../app/(admin)/admin/more/page.js");
const { SectionStrip } = await import("../app/(admin)/_components/section-strip.js");

/**
 * The restructure, as rendered (spec §7, §8 v0.9).
 *
 * `nav-reachability.test.ts` proves the data still reaches every route. This
 * proves the two components actually put it on screen — that the rail is short,
 * that the views which used to be sidebar rows appear as tabs on the screen
 * they belong to, and that exactly one thing is marked current.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

function at(route: string) {
  pathname.current = route;
}

describe("AdminNav", () => {
  it("shows four places and Log, not fifty-five links", () => {
    at("/admin");
    render(<AdminNav propertyId={PROPERTY} farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    for (const label of ["Today", "Animals", "Farm", "More", "Log"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }

    // The views that used to sit in the sidebar are not in it any more.
    expect(within(nav).queryByRole("link", { name: "Breeding" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Calving" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Contacts" })).not.toBeInTheDocument();
  });

  it("puts what used to be the utility rail on the More page", () => {
    render(<MorePage />);

    for (const label of ["Contacts", "Reports", "Housesitter", "Settings", "Invoices"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("marks exactly one destination as current", () => {
    at("/admin/cattle/breeding");
    render(<AdminNav propertyId={PROPERTY} farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/Animals/);
  });

  it("lights More for a page reached from it", () => {
    at("/admin/settings/trash");
    render(<BottomTabs />);

    const tabs = screen.getByRole("navigation", { name: "Main" });
    const current = within(tabs)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/More/);
  });

  it("puts Log in the middle of the phone's tab bar", () => {
    at("/admin");
    render(<BottomTabs />);

    const names = within(screen.getByRole("navigation", { name: "Main" }))
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label") ?? link.textContent);
    expect(names).toEqual(["Today", "Animals", "Log something", "Farm", "More"]);
  });
});

describe("SectionStrip", () => {
  it("puts the thirteen cattle views on the cattle screen, as four groups", () => {
    at("/admin/cattle/breeding");
    render(<SectionStrip />);

    const groups = screen.getByRole("navigation", { name: "Cattle views" });
    for (const label of ["Herd", "Breeding", "Health", "Sales"]) {
      expect(within(groups).getByRole("link", { name: label })).toBeInTheDocument();
    }

    // The chosen group's own views, and only those.
    const views = screen.getByRole("navigation", { name: "Breeding views" });
    for (const label of ["Breeding", "Calving", "Tank and fridge", "Ancestors", "Catalog"]) {
      expect(within(views).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(within(views).queryByRole("link", { name: "Weights" })).not.toBeInTheDocument();
  });

  it("offers the other species alongside cattle", () => {
    at("/admin/cattle");
    render(<SectionStrip />);

    const sections = screen.getByRole("navigation", { name: "Animals sections" });
    for (const label of ["Cattle", "Flock", "Horses", "Pets"]) {
      expect(within(sections).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("keeps the section lit while a view of it is open", () => {
    // Both strips answer at once: which animal, and which view of it. Standing
    // on Breeding used to light Breeding and nothing above it, so the upper
    // strip read as though no species were selected — `isWithin` refuses a
    // route the nav already knows, which is precisely what a declared sub-view
    // is.
    at("/admin/cattle/breeding");
    render(<SectionStrip />);

    const sections = screen.getByRole("navigation", { name: "Animals sections" });
    const lit = within(sections)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAccessibleName("Cattle");
  });

  it("keeps the section lit on an animal's own page, where no view applies", () => {
    at("/admin/cattle/01ARZ3NDEKTSV4RRFFQ69G5FAV");
    render(<SectionStrip />);

    const sections = screen.getByRole("navigation", { name: "Animals sections" });
    expect(
      within(sections)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")[0],
    ).toHaveAccessibleName("Cattle");

    // …and no view is claimed, because a detail page is not one of the views.
    const views = screen.getByRole("navigation", { name: "Cattle views" });
    expect(
      within(views)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page"),
    ).toHaveLength(0);
  });

  it("lights a single-level section with no views under it", () => {
    at("/admin/supplies");
    render(<SectionStrip />);

    const sections = screen.getByRole("navigation", { name: "Farm sections" });
    const lit = within(sections)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAccessibleName("Supplies");
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

  it("draws no strip on the Animals landing, which has its own chips", () => {
    at("/admin/animals");
    const { container } = render(<SectionStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing where there is no choice to make", () => {
    // A destination with one section and no sub-views has no strip to draw;
    // a single tab is chrome pretending to be navigation.
    at("/admin/contacts");
    const { container } = render(<SectionStrip />);
    expect(container).toBeEmptyDOMElement();
  });
});
