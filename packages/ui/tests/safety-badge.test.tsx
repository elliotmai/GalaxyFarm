import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { safetyScale } from "@galaxy-farm/config/tailwind";

import { SafetyBadge } from "../src/safety/safety-badge.js";
import { HalterSwatch } from "../src/halter/halter-swatch.js";

/**
 * The badge is the thing standing between someone and an animal that will hurt
 * them, and it is read in the worst possible conditions: off a photograph
 * texted to a housesitter, off a sheet taped inside the barn door, by someone
 * who does not distinguish red from green. Everything below is about surviving
 * that rather than about looking right.
 */

describe("SafetyBadge", () => {
  it("always shows the number", () => {
    // Not configurable. A badge reduced to a coloured dot carries nothing to
    // a photocopy, and nothing to a third of the people who will look at it.
    render(<SafetyBadge level={4} />);

    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("tells a screen reader what the level means, not just its number", () => {
    // "3" alone says nothing to someone who cannot see the colour either.
    render(<SafetyBadge level={3} />);

    expect(screen.getByText(/Safety level 3, Confident handlers only/)).toBeInTheDocument();
  });

  it("says when a level was raised by an occupant rather than the place", () => {
    // A quiet pen holding a fresh cow is a level 4 pen. Without the reason,
    // that reads as the pen having changed.
    render(<SafetyBadge level={4} raisedBy="Andromeda, fresh with calf" />);

    expect(screen.getByText(/Raised by Andromeda, fresh with calf/)).toBeInTheDocument();
  });

  it("shows the written meaning when asked, for badges standing alone", () => {
    render(<SafetyBadge level={5} showLabel />);

    expect(screen.getAllByText(/Do not handle/).length).toBeGreaterThan(0);
  });

  it("uses the level's own ink, which differs between levels", () => {
    // Levels 2, 3 and 4 need dark ink; 1 and 5 need light. One choice for all
    // five would fail AA somewhere — see contrast.test.ts.
    const { container: dark } = render(<SafetyBadge level={3} />);
    const { container: light } = render(<SafetyBadge level={5} />);

    expect(dark.querySelector("[aria-hidden]")).toHaveStyle({ color: safetyScale[3].ink });
    expect(light.querySelector("[aria-hidden]")).toHaveStyle({ color: safetyScale[5].ink });
  });

  it("rings the chip so its edge survives a low-contrast fill", () => {
    const { container } = render(<SafetyBadge level={2} />);

    expect(container.querySelector("[aria-hidden]")?.getAttribute("style")).toContain(
      "--gf-border",
    );
  });

  it("grows for the kiosk, which is read from across a pen", () => {
    const { container: small } = render(<SafetyBadge level={1} size="compact" />);
    const { container: big } = render(<SafetyBadge level={1} size="kiosk" />);

    const height = (root: HTMLElement) =>
      Number.parseInt(
        (root.querySelector("[aria-hidden]") as HTMLElement).style.height.replace("px", ""),
        10,
      );

    expect(height(big)).toBeGreaterThan(height(small) * 2);
  });

  it("exposes the level to a test or a stylesheet without re-deriving it", () => {
    const { container } = render(<SafetyBadge level={2} />);

    expect(container.querySelector("[data-safety-level='2']")).not.toBeNull();
  });
});

describe("HalterSwatch", () => {
  it("defaults to black, which is what an unlabelled calf wears", () => {
    render(<HalterSwatch />);

    expect(screen.getByText("Black halter")).toBeInTheDocument();
  });

  it("names the colour for anyone who cannot see it", () => {
    // "The one in the red halter" is the sentence people say. Two calves in
    // navy and black are the same swatch in a dark barn.
    render(<HalterSwatch color="#1B2A4A" name="Navy" />);

    expect(screen.getByText("Navy halter")).toBeInTheDocument();
  });

  it("shows the name beside the swatch when asked", () => {
    render(<HalterSwatch color="#C62828" name="Red" showName />);

    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("rings the swatch, or black on midnight is invisible", () => {
    const { container } = render(<HalterSwatch />);

    expect(container.querySelector("[aria-hidden]")?.getAttribute("style")).toContain(
      "--gf-border",
    );
  });
});
