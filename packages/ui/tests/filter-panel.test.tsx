import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FilterPanel } from "../src/primitives/filter-panel.js";

/**
 * Filters, folded away until they are wanted (spec §8).
 *
 * The clutter argument is easy and the failure it can cause is not: a
 * collapsed panel over a *narrowed* list is a screen that lies. Eight of
 * twenty-six animals, no visible reason, and the missing eighteen look like
 * animals that do not exist — somebody checks whether a cow is on the place,
 * does not find her, and concludes wrongly. Most of what is asserted here is
 * about that, not about the folding.
 */

describe("a filter panel with nothing set", () => {
  it("starts shut, because what was wanted was the herd", () => {
    render(
      <FilterPanel active={0}>
        <label htmlFor="pen">Pen</label>
      </FilterPanel>,
    );

    expect(screen.queryByText("Pen")).not.toBeInTheDocument();
  });

  it("opens when asked, and shuts again", () => {
    render(
      <FilterPanel active={0}>
        <label htmlFor="pen">Pen</label>
      </FilterPanel>,
    );
    const toggle = screen.getByRole("button", { name: /Filters/ });

    fireEvent.click(toggle);
    expect(screen.getByText("Pen")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(screen.queryByText("Pen")).not.toBeInTheDocument();
  });

  it("offers nothing to clear when nothing is set", () => {
    render(
      <FilterPanel active={0} onClear={vi.fn()}>
        {null}
      </FilterPanel>,
    );

    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});

describe("a filter panel with filters on", () => {
  it("starts open, since the filters explain what is on screen", () => {
    render(
      <FilterPanel active={2} summary="Pen: North · Sex: bull">
        <label htmlFor="pen">Pen</label>
      </FilterPanel>,
    );

    expect(screen.getByText("Pen")).toBeInTheDocument();
  });

  it("says what is on even after it is shut again", () => {
    // The whole point. A narrowed list must always say why it is narrowed.
    render(
      <FilterPanel active={2} summary="Pen: North · Sex: bull">
        <label htmlFor="pen">Pen</label>
      </FilterPanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    expect(screen.queryByText("Pen")).not.toBeInTheDocument();
    expect(screen.getByText("Pen: North · Sex: bull")).toBeInTheDocument();
  });

  it("counts them in the heading, so the number is readable at a glance", () => {
    render(<FilterPanel active={3}>{null}</FilterPanel>);

    expect(screen.getByRole("button", { name: /Filters \(3\)/ })).toBeInTheDocument();
  });

  it("can be cleared without opening it first", () => {
    // The state that needs clearing most is the one where somebody has not
    // realised a filter is on, so it must not be behind the toggle.
    const clear = vi.fn();
    render(
      <FilterPanel active={2} onClear={clear}>
        <label htmlFor="pen">Pen</label>
      </FilterPanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(clear).toHaveBeenCalledOnce();
  });

  it("keeps the count of what is showing visible either way", () => {
    render(
      <FilterPanel active={1} count="Showing 8 of 26.">
        <label htmlFor="pen">Pen</label>
      </FilterPanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    expect(screen.getByText("Showing 8 of 26.")).toBeInTheDocument();
  });

  it("takes the controls out of the page rather than hiding them with CSS", () => {
    // A display:none subtree can keep its focus order, and tabbing into a
    // control nobody can see is worse than the clutter this was closed for.
    const { container } = render(
      <FilterPanel active={0}>
        <input aria-label="Pen" />
      </FilterPanel>,
    );

    expect(container.querySelectorAll("input")).toHaveLength(0);
  });
});
