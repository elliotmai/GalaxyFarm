import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Callout, CardGrid, Meter, Pill, RecordCard, Tile } from "../src/primitives/widgets.js";

/**
 * The widgets that make a screen read as designed rather than as a form (§8).
 *
 * What is worth testing here is not that a div renders. It is the handful of
 * places where these carry meaning a screen depends on: a bar that cannot
 * overflow its own track, a state chip that is distinguishable from a label,
 * and an accent that actually changes with the tone.
 */

describe("Pill", () => {
  it("renders its label", () => {
    render(<Pill>Calving window</Pill>);

    expect(screen.getByText("Calving window")).toBeInTheDocument();
  });

  it("takes its colour from the tone", () => {
    render(<Pill tone="danger">Watch tonight</Pill>);

    expect(screen.getByText("Watch tonight").className).toContain("text-danger");
  });

  it("hides the dot from a screen reader", () => {
    // It is a visual cue for a live state. Announcing it would add a word
    // before every status on the page.
    const { container } = render(
      <Pill dot tone="action">
        3 not sent
      </Pill>,
    );

    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(1);
  });
});

describe("Meter", () => {
  it("reports its position to a screen reader as a progressbar", () => {
    render(<Meter value={0.5} label="Gestation" />);

    const bar = screen.getByRole("progressbar", { name: "Gestation" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps past the end rather than overflowing its track", () => {
    // A cow at day 290 of a 283-day projection is real and common. A bar drawn
    // at 103% would break out of its own container.
    render(<Meter value={1.4} label="Gestation" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps a negative value, which is what a future date produces", () => {
    render(<Meter value={-0.2} label="Gestation" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows the detail beside the label", () => {
    render(<Meter value={0.98} label="Gestation" detail="day 279 of 283" />);

    expect(screen.getByText("day 279 of 283")).toBeInTheDocument();
  });
});

describe("Tile", () => {
  it("shows the label, the number and the hint", () => {
    render(<Tile label="Tanks at risk" value={2} hint="No heater fitted" />);

    expect(screen.getByText("Tanks at risk")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("No heater fitted")).toBeInTheDocument();
  });

  it("colours the number only when it is emphasised", () => {
    // An accent on every tile is a row of coloured numbers and no hierarchy.
    const plain = render(<Tile label="Cattle" value={9} tone="danger" />);
    expect(plain.getByText("9").className).toContain("text-ink");

    const loud = render(<Tile label="At risk" value={2} tone="danger" emphasis />);
    expect(loud.getByText("2").className).toContain("text-danger");
  });
});

describe("RecordCard", () => {
  it("renders the title, subtitle, meta and children together", () => {
    render(
      <RecordCard title="Andromeda" subtitle="Due 24 Nov" meta={<Pill>Bred</Pill>}>
        <span>Gestation</span>
      </RecordCard>,
    );

    expect(screen.getByText("Andromeda")).toBeInTheDocument();
    expect(screen.getByText("Due 24 Nov")).toBeInTheDocument();
    expect(screen.getByText("Bred")).toBeInTheDocument();
    expect(screen.getByText("Gestation")).toBeInTheDocument();
  });

  it("accepts a node as its title, not only a string", () => {
    // The title is a link on most of the screens that use this, and `title` on
    // an HTMLAttributes div is a string — hence the Omit on the props.
    render(<RecordCard title={<a href="/admin/cattle">Andromeda</a>} />);

    expect(screen.getByRole("link", { name: "Andromeda" })).toBeInTheDocument();
  });
});

describe("CardGrid", () => {
  it("stacks to one column on a phone whatever the desktop count", () => {
    const { container } = render(
      <CardGrid columns={3}>
        <div>one</div>
      </CardGrid>,
    );

    expect(container.firstElementChild?.className).toContain("grid-cols-1");
    expect(container.firstElementChild?.className).toContain("xl:grid-cols-3");
  });
});

describe("Callout", () => {
  it("announces itself as a standing condition, not as an interruption", () => {
    // A withdrawal period is true when you arrive at the page. `role="alert"`
    // would cut across whatever a screen reader was in the middle of saying to
    // report something that has not just happened.
    render(<Callout title="Under withdrawal for 6 more days">Clears on 18 August.</Callout>);

    expect(screen.getByRole("status")).toHaveTextContent("Under withdrawal for 6 more days");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries the tone into the fill so danger does not read as neutral", () => {
    render(<Callout tone="danger" title="Not clear for sale" />);

    expect(screen.getByRole("status").className).toContain("bg-danger/15");
  });
});
