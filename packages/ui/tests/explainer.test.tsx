import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PageHeader, Section } from "../src/primitives/layout.js";

/**
 * Folded explanations (spec §8 v0.9).
 *
 * `subtitle` and `description` are both documented as one line and were both
 * being handed paragraphs. The fold is what lets that stay true on screen
 * without deleting anything, so what is worth testing is the part a reader
 * would notice if it broke: that the naming sentence is always visible, that
 * the rest is reachable, and that nothing is lost either way.
 */

describe("PageHeader", () => {
  it("shows the first sentence and folds the rest", async () => {
    render(
      <PageHeader
        title="Supplies"
        subtitle="Shavings through show sticks. On hand is the opening count plus what was bought, less what was used."
      />,
    );

    expect(screen.getByText(/Shavings through show sticks\./)).toBeVisible();

    const rest = screen.getByText(/On hand is the opening count/);
    expect(rest).toBeInTheDocument();
    // jsdom does not implement `<details>` visibility, so the fold itself is
    // asserted on the element that owns it rather than on the text.
    expect(rest.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(screen.getByText("More"));
    expect(rest.closest("details")).toHaveAttribute("open");
  });

  it("leaves a subtitle that is already one line alone", () => {
    render(<PageHeader title="Trash" subtitle="Deleted records, and what still points at them." />);

    expect(screen.getByText("Deleted records, and what still points at them.")).toBeVisible();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });

  it("does not try to split something that is not a string", () => {
    // Several screens pass a count or a chip rather than prose.
    render(
      <PageHeader
        title="Herd"
        subtitle={
          <>
            <strong>42</strong> head. Two pens.
          </>
        }
      />,
    );

    expect(screen.getByText("42")).toBeVisible();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });

  it("does not mistake a section reference for the end of a sentence", () => {
    // "§5.3" and "1.5 lb" both carry a full stop with no space after it.
    render(
      <Section title="Profit" description="Feed is apportioned in §5.3 and never re-derived.">
        <p>x</p>
      </Section>,
    );

    expect(screen.getByText("Feed is apportioned in §5.3 and never re-derived.")).toBeVisible();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });
});

describe("Section", () => {
  it("folds a long description the same way a page header does", async () => {
    render(
      <Section
        title="Breed"
        description="What this one is, in words. More than one, because a crossbred animal is more than one."
      >
        <p>x</p>
      </Section>,
    );

    expect(screen.getByText(/What this one is, in words\./)).toBeVisible();

    const rest = screen.getByText(/because a crossbred animal/);
    expect(rest.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(screen.getByText("More"));
    expect(rest.closest("details")).toHaveAttribute("open");
  });

  it("keeps the heading out of the fold", () => {
    // The title is not part of the disclosure — a collapsed section that hid
    // its own name would be unnavigable.
    render(
      <Section title="Breed" description="One sentence. And a second one.">
        <p>x</p>
      </Section>,
    );

    expect(screen.getByRole("heading", { name: "Breed" })).toBeVisible();
  });
});
