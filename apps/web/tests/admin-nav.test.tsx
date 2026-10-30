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

  it("opens Log knowing the page to close back to", () => {
    at("/admin/feed");
    render(<BottomTabs />);

    expect(screen.getByRole("link", { name: "Log something" }).getAttribute("href")).toBe(
      "/admin/log?from=%2Fadmin%2Ffeed",
    );
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

  it("leaves the species to the page title, and shows the species' own tools", () => {
    // Every animal page switches species from its title (decision 45), so the
    // strip above it is that species' tools alone.
    at("/admin/horses");
    render(<SectionStrip />);

    expect(screen.queryByRole("navigation", { name: "Animals sections" })).not.toBeInTheDocument();
    const tools = screen.getByRole("navigation", { name: "Horses views" });
    for (const label of ["Horses", "Pens", "Feeding", "Breeding"]) {
      expect(within(tools).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("drops the species strip inside cattle, whose groups say where you are", () => {
    at("/admin/cattle/breeding");
    render(<SectionStrip />);

    expect(screen.queryByRole("navigation", { name: "Animals sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Cattle views" })).toBeInTheDocument();
  });
  it("lights the tool that is open, and only that one", () => {
    at("/admin/horses/pens");
    render(<SectionStrip />);

    const tools = screen.getByRole("navigation", { name: "Horses views" });
    const lit = within(tools)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAccessibleName("Pens");
  });
  it("draws no strips on an animal's own page, which has its own way back", () => {
    at("/admin/cattle/01ARZ3NDEKTSV4RRFFQ69G5FAV");
    const { container } = render(<SectionStrip />);
    expect(container).toBeEmptyDOMElement();
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
