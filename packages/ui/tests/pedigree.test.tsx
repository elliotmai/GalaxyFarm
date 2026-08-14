import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PedigreeChart, type Ancestor } from "../src/charts/pedigree.js";

/**
 * The pedigree bracket (spec §8 v0.9, issue #16).
 *
 * What is worth testing is what a reader trusts without checking: that the
 * bracket keeps its shape when a branch is missing, that a gap says it is a
 * gap, that the depth control bounds the drawing, and that a repeated ancestor
 * is marked by something other than a colour.
 *
 * The last two are here because the chart this replaced failed both — it drew
 * an unknown ancestor as blank space and marked a repeat with a hue that the
 * current palette renders identically to the ordinary one.
 */

const node = (id: string, extra: Partial<Ancestor> = {}): Ancestor => ({
  id,
  label: id,
  ...extra,
});

/** Four generations deep on the sire line only — a realistic shape. */
const TREE: Ancestor = node("subject", {
  sire: node("sire", {
    sire: node("sire-sire", { sire: node("sire-sire-sire") }),
    dam: node("sire-dam"),
  }),
  dam: node("dam"),
});

describe("PedigreeChart", () => {
  it("draws nothing above the requested generation", () => {
    render(<PedigreeChart root={TREE} generations={2} />);

    expect(screen.getByText("sire-sire")).toBeInTheDocument();
    // The great-grandsire is generation 3 and the chart was asked for 2.
    expect(screen.queryByText("sire-sire-sire")).not.toBeInTheDocument();
  });

  it("says an unknown ancestor is unknown instead of leaving white space", () => {
    // The whole reason this chart exists. A blank bracket cell is ambiguous
    // between "nobody has entered it" and "there is nothing to enter", and
    // only one of those is somebody's job.
    render(<PedigreeChart root={TREE} generations={2} />);

    // The dam side is unknown from generation 2 up: her sire and her dam.
    expect(screen.getAllByText("Sire unknown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dam unknown").length).toBeGreaterThan(0);
  });

  it("draws every slot, known or not, so the bracket keeps its shape", () => {
    // Three generations is 1 + 2 + 4 + 8 = 15 cells however few are filled.
    // If a missing branch collapsed, the known ancestors would slide into the
    // gaps and a reader would take the tree for complete.
    const { container } = render(<PedigreeChart root={TREE} generations={3} />);

    expect(container.querySelectorAll("[style*='grid-row']")).toHaveLength(15);
  });

  it("keeps a whole side of the tree on its own side of the chart", () => {
    render(<PedigreeChart root={TREE} generations={2} />);

    /**
     * A cell occupies a band and centres inside it, so where it *reads* is the
     * middle of its span, not its first row. The subject and its sire share a
     * top edge — comparing start rows would call them level when the reader
     * plainly sees one above the other.
     */
    const middleOf = (label: string) => {
      const cell = screen.getByText(label).closest("[style*='grid-row']");
      const match = /grid-row: (\d+) \/ span (\d+)/.exec(cell?.getAttribute("style") ?? "");
      const [start, span] = [Number(match?.[1]), Number(match?.[2])];
      return start + span / 2;
    };

    // Sire above subject, dam below — at every depth, not only the first.
    expect(middleOf("sire")).toBeLessThan(middleOf("subject"));
    expect(middleOf("sire-sire")).toBeLessThan(middleOf("sire"));
    expect(middleOf("dam")).toBeGreaterThan(middleOf("subject"));
  });

  it("marks a repeat with a word, not only a colour", () => {
    // `identity` and `action` are the same navy in this palette, so a hue
    // carries nothing here — and would carry nothing to a colour-blind reader
    // even where the two differed.
    render(
      <PedigreeChart
        root={node("ours", { sire: node("twice", { repeated: true }) })}
        generations={1}
      />,
    );

    const cell = screen.getByText("twice").closest("[style*='grid-row']");
    expect(within(cell as HTMLElement).getByText("Repeat")).toBeInTheDocument();
  });

  it("marks an outside animal by its border rather than by its fill", () => {
    // Dashed rather than tinted, so the distinction survives the printer.
    render(
      <PedigreeChart
        root={node("ours", { sire: node("theirs", { outside: true }) })}
        generations={1}
      />,
    );

    expect(screen.getByText("theirs").parentElement).toHaveClass("border-dashed");
    expect(screen.getByText("ours").parentElement).not.toHaveClass("border-dashed");
  });

  it("opens an ancestor from the keyboard, not only from a click", () => {
    // Drill-down is the point of the chart, and a chart you can only use with
    // a mouse is a chart half the people opening it cannot use.
    const onSelect = vi.fn();
    render(<PedigreeChart root={TREE} generations={1} onSelect={onSelect} />);

    screen.getAllByRole("button")[1]?.focus();

    return userEvent.keyboard("{Enter}").then(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  it("does not offer an unknown slot as something to open", () => {
    // Three cells at one generation, one of them a gap: two buttons, not three.
    const onSelect = vi.fn();
    render(
      <PedigreeChart root={node("x", { sire: node("s") })} generations={1} onSelect={onSelect} />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("is inert when there is nothing to drill into", () => {
    render(<PedigreeChart root={TREE} generations={1} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("names the subject for a reader who cannot see the bracket", () => {
    render(<PedigreeChart root={TREE} generations={3} caption="Papers go back 3 generations." />);

    expect(screen.getByText("Papers go back 3 generations.")).toBeVisible();
  });
});
