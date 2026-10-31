import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PageHeader, Section } from "../src/primitives/layout.js";

/**
 * Explanations behind a `?` (spec §8 v0.9).
 *
 * A header carries facts; an explanation waits beside the title until it is
 * asked for. What is worth testing is what a reader would notice if it broke:
 * that a fact stays on screen, that an explanation is one click away and never
 * lost, and that the heading itself is never folded.
 */

describe("PageHeader", () => {
  it("puts an explanation behind the ? beside the title", async () => {
    render(
      <PageHeader
        title="Supplies"
        subtitle="Shavings through show sticks. On hand is the opening count plus what was bought, less what was used."
      />,
    );

    const help = screen.getByText(/On hand is the opening count/);
    expect(help.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(screen.getByLabelText("About Supplies"));
    expect(help.closest("details")).toHaveAttribute("open");
  });

  it("leaves a short fact on screen", () => {
    render(<PageHeader title="Trash" subtitle="Deleted records, and what still points at them" />);

    expect(screen.getByText("Deleted records, and what still points at them")).toBeVisible();
    expect(screen.queryByLabelText("About Trash")).not.toBeInTheDocument();
  });

  it("always shows something a screen built from data", () => {
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
    expect(screen.queryByLabelText("About Herd")).not.toBeInTheDocument();
  });

  it("does not mistake a section reference for a second sentence", () => {
    render(
      <Section title="Profit" description="Feed is apportioned in §5.3 and never re-derived.">
        <p>x</p>
      </Section>,
    );

    expect(screen.getByText("Feed is apportioned in §5.3 and never re-derived.")).toBeVisible();
    expect(screen.queryByLabelText("About Profit")).not.toBeInTheDocument();
  });
});

describe("Section", () => {
  it("puts a long description behind the ? the same way a page header does", async () => {
    render(
      <Section
        title="Breed"
        description="What this one is, in words. More than one, because a crossbred animal is more than one."
      >
        <p>x</p>
      </Section>,
    );

    const help = screen.getByText(/because a crossbred animal/);
    expect(help.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(screen.getByLabelText("About Breed"));
    expect(help.closest("details")).toHaveAttribute("open");
  });

  it("keeps the heading out of the fold", () => {
    render(
      <Section title="Breed" description="One sentence. And a second one.">
        <p>x</p>
      </Section>,
    );

    expect(screen.getByRole("heading", { name: "Breed" })).toBeVisible();
  });
});
