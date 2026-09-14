import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type {
  Animal,
  ChoreTemplate,
  Contact,
  FeedingPlan,
  Ulid,
  Zone,
  ZoneAssignment,
} from "@galaxy-farm/core";
import type { CareGuide, GuideSection, Trip } from "@galaxy-farm/module-housesitting";
import type { FeedType } from "@galaxy-farm/module-feed";
import type { HealthRecord } from "@galaxy-farm/module-cattle";

import { HousesitterGuide } from "../app/(kiosk)/kiosk/housesitter/housesitter-guide.js";

/**
 * The housesitter board, rebuilt for somebody who will not scroll (§4.4, §5.10).
 *
 * This board used to be the day's chores followed by the whole guide as a
 * stack of folds, and grew past the screen as soon as the farm had a few pens.
 * The fix was tabs, and what these tests hold down is the *reason* for them:
 * exactly one panel's worth of content is in the document at a time, so the
 * page cannot grow however much the farm does.
 *
 * The two exceptions are the point of the design and are asserted hardest —
 * the do-not-handle list and when the owners are back are never behind a tap,
 * because both are read by somebody who will not go looking for them.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const NOW = new Date(2026, 8, 17, 9, 0);
const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;

const guide: CareGuide = {
  id: id(1),
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  title: "While we are away",
  intro: "Gate code is 4417.",
  includes: ["emergency_contacts", "custom"],
  active: true,
};

const section: GuideSection = {
  id: id(2),
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  careGuideId: guide.id,
  title: "The generator",
  bodyMarkdown: "Pull the choke out fully before starting it.",
  order: 0,
};

const vet: Contact = {
  id: id(3),
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  name: "Dr Alvarez",
  tags: ["emergency"],
  phones: [{ label: "mobile", number: "555-0142" }],
  emails: [],
} as unknown as Contact;

const trip: Trip = {
  id: id(4),
  propertyId: PROPERTY,
  createdAt: NOW,
  updatedAt: NOW,
  name: "Orlando and Cincinnati",
  destination: "Florida",
  startDate: new Date(2026, 8, 15),
  endDate: new Date(2026, 8, 20),
  whoIsAway: "Elliot and Mai",
  reachableAt: "555-0199",
  legs: [
    {
      transport: "flight",
      number: "F9 4018",
      from: "Dallas/Ft. Worth (DFW)",
      to: "Orlando (MCO)",
      departAt: "2026-09-15T09:21",
      departTz: "America/Chicago",
      arriveAt: "2026-09-15T12:09",
      arriveTz: "America/New_York",
    },
  ],
  source: "manual",
};

function renderBoard(overrides: { trip?: Trip | undefined } = {}) {
  return render(
    <HousesitterGuide
      guide={guide}
      sections={[section]}
      zones={[] as Zone[]}
      assignments={[] as ZoneAssignment[]}
      animals={[] as Animal[]}
      contacts={[vet]}
      templates={[] as ChoreTemplate[]}
      plans={[] as FeedingPlan[]}
      feeds={[] as FeedType[]}
      health={[] as HealthRecord[]}
      trip={"trip" in overrides ? overrides.trip : trip}
      today={<p>Muck out the north trap</p>}
      choresLeft={4}
      now={NOW}
    />,
  );
}

describe("the board opens on the day's work", () => {
  it("shows today's chores without anybody choosing a tab", () => {
    renderBoard();

    expect(screen.getByText("Muck out the north trap")).toBeInTheDocument();
  });

  it("carries how much is left on the tab itself", () => {
    renderBoard();

    expect(screen.getByRole("tab", { name: /Today/ })).toHaveTextContent("4");
  });
});

describe("only one panel is ever in the document", () => {
  it("replaces the chores rather than growing the page", async () => {
    renderBoard();
    expect(screen.getByText("Muck out the north trap")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Who to ring/ }));

    // The whole point: the day is *gone*, not pushed down. A board that kept
    // both is a board that scrolls, which is the bug this replaced.
    expect(screen.queryByText("Muck out the north trap")).not.toBeInTheDocument();
    expect(screen.getByText("Dr Alvarez")).toBeInTheDocument();
  });

  it("keeps the notes a tap away rather than open", () => {
    renderBoard();

    expect(screen.queryByText(/Pull the choke out fully/)).not.toBeInTheDocument();
  });
});

describe("what is never behind a tap", () => {
  it("says when they are back whatever panel is open", async () => {
    renderBoard();

    expect(screen.getByText(/Back Sunday/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Who to ring/ }));
    expect(screen.getByText(/Back Sunday/)).toBeInTheDocument();
  });

  it("puts the number to reach them on next to it", () => {
    renderBoard();

    expect(screen.getByRole("link", { name: "555-0199" })).toHaveAttribute("href", "tel:555-0199");
  });

  it("drops the banner entirely when nobody is away", () => {
    renderBoard({ trip: undefined });

    expect(screen.queryByText(/Back Sunday/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Travel/ })).not.toBeInTheDocument();
  });
});

describe("the journey", () => {
  it("reads the departure back exactly as it was typed", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("tab", { name: /Travel/ }));

    // 9:21 as stored, not 9:21 converted into the test runner's zone and back.
    // A board that shifted this by an hour would be wrong on the one screen
    // where somebody is deciding whether to wait up.
    expect(screen.getByText(/9:21 AM/)).toBeInTheDocument();
    expect(screen.getByText(/12:09 PM/)).toBeInTheDocument();
  });

  it("names the flight it belongs to", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("tab", { name: /Travel/ }));

    expect(screen.getByText(/F9 4018/)).toBeInTheDocument();
  });
});
