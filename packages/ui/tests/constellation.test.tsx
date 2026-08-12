import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Constellation, type ConstellationNode } from "../src/charts/constellation.js";

/**
 * The constellation (spec §8, issue #16).
 *
 * What is worth testing is the geometry, because that is what a reader trusts
 * without checking: that a missing ancestor leaves its slot empty rather than
 * letting the known ones slide into it, that the depth control actually bounds
 * the drawing, and that a star can be reached without a mouse.
 */

const node = (id: string, extra: Partial<ConstellationNode> = {}): ConstellationNode => ({
  id,
  label: id,
  ...extra,
});

/** Four generations deep on the sire line only — a realistic shape. */
const TREE: ConstellationNode = node("subject", {
  sire: node("sire", {
    sire: node("sire-sire", { sire: node("sire-sire-sire") }),
    dam: node("sire-dam"),
  }),
  dam: node("dam"),
});

describe("Constellation", () => {
  it("names the subject and the depth for a reader who cannot see it", () => {
    render(<Constellation root={TREE} generations={3} />);

    expect(screen.getByRole("img", { name: "Pedigree of subject, 3 generations" })).toBeVisible();
  });

  it("draws nothing above the requested generation", () => {
    render(<Constellation root={TREE} generations={2} />);

    expect(screen.getByText("sire-sire")).toBeInTheDocument();
    // The great-grandsire is generation 3 and the chart was asked for 2.
    expect(screen.queryByText("sire-sire-sire")).not.toBeInTheDocument();
  });

  it("leaves a missing ancestor's slot empty rather than closing the gap", () => {
    // The dam side is unknown past generation 1. If the layout collapsed the
    // gap, the sire line would drift down the chart and a reader would take
    // the tree for complete.
    const { container } = render(<Constellation root={TREE} generations={3} />);

    const y = (label: string) =>
      Number(
        Array.from(container.querySelectorAll("text"))
          .find((text) => text.textContent === label)
          ?.getAttribute("y") ?? Number.NaN,
      );

    // The whole sire half sits in the top half of the chart, whatever is
    // missing beneath it.
    expect(y("sire")).toBeLessThan(y("subject"));
    expect(y("sire-sire")).toBeLessThan(y("sire"));
    expect(y("dam")).toBeGreaterThan(y("subject"));
  });

  it("connects each ancestor to its child, and only where both are drawn", () => {
    const { container } = render(<Constellation root={TREE} generations={1} />);

    // Subject→sire and subject→dam. Nothing above, because nothing above is drawn.
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("marks an outside animal differently from one of ours", () => {
    const { container } = render(
      <Constellation
        root={node("ours", { sire: node("theirs", { outside: true }) })}
        generations={1}
      />,
    );

    const filled = Array.from(container.querySelectorAll("circle")).filter(
      (circle) => circle.getAttribute("fill") === "none",
    );
    expect(filled).toHaveLength(1);
  });

  it("opens an ancestor from the keyboard, not only from a click", () => {
    // Drill-down is the point of the chart, and a chart you can only use with
    // a mouse is a chart half the people opening it cannot use.
    const onSelect = vi.fn();
    render(<Constellation root={TREE} generations={1} onSelect={onSelect} />);

    const stars = screen.getAllByRole("button");
    stars[1]?.focus();

    return userEvent.keyboard("{Enter}").then(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  it("is inert when there is nothing to drill into", () => {
    render(<Constellation root={TREE} generations={1} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shortens a long registered name instead of letting it run into the next column", () => {
    render(
      <Constellation
        root={node("x", { label: "Sunny Hill Double Stuff Cinnamon Roll 42X" })}
        generations={0}
      />,
    );

    expect(screen.getByText(/^Sunny Hill Double/)).toHaveTextContent("…");
  });
});
