import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { choreDaySheet, type Contact, type Task, type Ulid } from "@galaxy-farm/core";
import type { CareGuide, GuideSection } from "@galaxy-farm/module-housesitting";

import { EMPTY_SITTER_VIEW, type SitterView } from "@/lib/sitter-store";

/**
 * The housesitter's guide on a phone (spec §5.10).
 *
 * What these hold down is the order a sitter needs things in: today's jobs
 * before the reference, help one tap away from anywhere on the page, and the
 * reference folded so the jobs and the numbers are what a phone screen shows
 * first. The guide's content is the same composition the PDF prints; the
 * shape is what this surface owns.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/(sitter)/sitter/_components/chore-actions", () => ({
  setChoreDone: async () => ({ ok: true }),
}));

const { SitterScreen } = await import("../app/(sitter)/sitter/_components/sitter-screen.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const SITTER = "01ARZ3NDEKTSV4RRFFQ69G5U03" as Ulid;
const OWNER = "01ARZ3NDEKTSV4RRFFQ69G5U01" as Ulid;
const NOW = new Date(2026, 8, 17, 9, 0);
const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };

const guide: CareGuide = {
  ...base,
  id: id(1),
  title: "While we are away",
  intro: "Gate code is 4417.",
  includes: ["emergency_contacts", "custom"],
  active: true,
};

const generator: GuideSection = {
  ...base,
  id: id(2),
  careGuideId: guide.id,
  title: "The generator",
  bodyMarkdown: "Pull the choke out fully before starting it.",
  order: 0,
};

const vet = {
  ...base,
  id: id(3),
  name: "Dr Alvarez",
  tags: ["emergency"],
  phones: [{ label: "mobile", number: "555-0142" }],
  emails: [],
} as unknown as Contact;

const hay = {
  ...base,
  id: id(4),
  title: "Hay to the cows",
  dueAt: new Date(2026, 8, 17, 7, 0),
} as Task;

const hens = {
  ...base,
  id: id(5),
  title: "Let the hens out",
  dueAt: new Date(2026, 8, 17, 7, 30),
  completedAt: new Date(2026, 8, 17, 7, 35),
  completedBy: SITTER,
} as Task;

const water = {
  ...base,
  id: id(6),
  title: "Check the bull's water",
  dueAt: new Date(2026, 8, 17, 8, 0),
  completedAt: new Date(2026, 8, 17, 8, 10),
  completedBy: OWNER,
} as Task;

function renderGuide(
  tasks: readonly Task[] = [hay, hens, water],
  view: Partial<SitterView> = {},
  names?: Promise<Readonly<Record<string, string>>>,
) {
  const full: SitterView = {
    ...EMPTY_SITTER_VIEW,
    guide,
    sections: [generator],
    contacts: [vet],
    tasks,
    ...view,
  };
  const chores = choreDaySheet({ tasks: full.tasks, templates: [] }, NOW, NOW);

  return render(
    <SitterScreen
      farmName="Flying Double M"
      view={full}
      chores={chores}
      day={NOW}
      mayTick
      actorId={SITTER}
      names={names}
    />,
  );
}

describe("today's jobs come first", () => {
  it("puts the checklist above the numbers and the reference", () => {
    renderGuide();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^Today/);
    expect(headings.indexOf("Who to ring")).toBeGreaterThan(0);
  });

  it("leads with what is left and sinks what is done, each a real checkbox", () => {
    renderGuide();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[0]?.closest("label")).toHaveTextContent("Hay to the cows");
    expect(boxes[1]).toBeChecked();
  });

  it("counts the day the way the barn board does", () => {
    renderGuide();

    expect(screen.getByText("2 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });

  it("says who ticked each one", async () => {
    const names = Promise.resolve({ [OWNER]: "Mai" });
    await act(async () => {
      renderGuide(undefined, undefined, names);
      await names;
    });

    expect(screen.getByText(/Done by you · 7:35/)).toBeInTheDocument();
    expect(screen.getByText(/Done by Mai · 8:10/)).toBeInTheDocument();
  });

  it("says a finished day in one green line rather than a meter", () => {
    renderGuide([{ ...hay, completedAt: NOW, completedBy: SITTER }, hens, water]);

    expect(screen.getByText(/All done for today/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the list read-only once the window to change it has closed", () => {
    const chores = choreDaySheet({ tasks: [hay], templates: [] }, NOW, NOW);
    render(
      <SitterScreen
        farmName="Flying Double M"
        view={{ ...EMPTY_SITTER_VIEW, guide, tasks: [hay] }}
        chores={chores}
        day={NOW}
        mayTick={false}
      />,
    );

    expect(screen.getByText("Hay to the cows")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /read-only/ })).toBeInTheDocument();
  });
});

describe("help is one tap away", () => {
  it("pins a call to the first emergency number to the foot of the page", () => {
    renderGuide();

    const bar = screen.getByRole("navigation", { name: "Get help" });
    expect(within(bar).getByRole("link", { name: /Call Dr Alvarez/ })).toHaveAttribute(
      "href",
      "tel:555-0142",
    );
    expect(within(bar).getByRole("link", { name: "All numbers" })).toHaveAttribute(
      "href",
      "#who-to-ring",
    );
  });

  it("lists every number as a link that dials it", () => {
    renderGuide();

    const list = screen.getByRole("heading", { name: "Who to ring" }).closest("section");
    expect(within(list as HTMLElement).getByRole("link", { name: /555-0142/ })).toHaveAttribute(
      "href",
      "tel:555-0142",
    );
  });

  it("draws no call bar when there is nobody to call", () => {
    renderGuide(undefined, { contacts: [] });

    expect(screen.queryByRole("navigation", { name: "Get help" })).not.toBeInTheDocument();
  });
});

describe("the reference waits to be opened", () => {
  it("folds the owners' own sections to one line each", () => {
    const { container } = renderGuide();

    const fold = screen.getByText("The generator").closest("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");
    // The intro is a few lines the owners wrote to be read, so it stays open.
    expect(container).toHaveTextContent("Gate code is 4417.");
  });
});
