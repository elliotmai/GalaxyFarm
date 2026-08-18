import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Animal,
  ChoreTemplate,
  Contact,
  FeedingPlan,
  Ulid,
  Zone,
  ZoneAssignment,
} from "@galaxy-farm/core";
import type { CareGuide, GuideSection } from "@galaxy-farm/module-housesitting";
import type { FeedType } from "@galaxy-farm/module-feed";
import type { HealthRecord } from "@galaxy-farm/module-cattle";

import { GuidePreview } from "../app/(admin)/admin/housesitter/_components/guide-preview.js";

/**
 * How the guide lands on paper (spec §5.10, §8; issue #42).
 *
 * `guide-composition.test.ts` covers what the document says. This covers the
 * things that are only true of print — and print CSS is not something jsdom
 * can be asked about, since it has no pages, no `@media print` and no
 * pagination. So the suite is split the way the risk is:
 *
 * - **The markup** is asserted here, because every one of the print
 *   stylesheet's tricks depends on the document being shaped a particular way.
 *   A pen's heading that drifts out of its `<thead>` still looks right on
 *   screen and silently stops repeating on the page it spills onto.
 * - **The stylesheet** is asserted as text, for the two rules that were
 *   measured defects rather than preferences: the document must not be lifted
 *   out of the flow, and it must ask for its colours exactly. Both are the
 *   kind of thing a later tidy-up removes for looking redundant.
 *
 * What no test here can see is the paper. That was checked by printing the
 * composed document to PDF in Chromium and reading the result back — recorded
 * in the pull request, because a comment claiming it is not evidence.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (day: number) => new Date(Date.UTC(2026, 5, day, 12));

const zone = (overrides: Partial<Zone> & Pick<Zone, "id" | "name">): Zone =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 1,
    waterSourceIds: [],
    resting: false,
    active: true,
    ...overrides,
  }) as Zone;

const animal = (overrides: Partial<Animal> & Pick<Animal, "id">): Animal =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...overrides,
  }) as Animal;

const assignment = (
  overrides: Partial<ZoneAssignment> & Pick<ZoneAssignment, "id" | "animalId" | "zoneId">,
): ZoneAssignment =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    periodFrom: on(1),
    slot: "pasture",
    ...overrides,
  }) as ZoneAssignment;

const NORTH = id(1);
const BULL = id(10);

const GUIDE = {
  id: id(90),
  propertyId: id(0),
  createdAt: on(1),
  updatedAt: on(1),
  title: "While we are away",
  includes: ["pens"],
  active: true,
} as unknown as CareGuide;

/** The whole screen, with only the arguments a test actually varies. */
function paint(overrides: Partial<Parameters<typeof GuidePreview>[0]> = {}) {
  return render(
    <GuidePreview
      guide={GUIDE}
      sections={[] as GuideSection[]}
      zones={[zone({ id: NORTH, name: "North Trap" })]}
      assignments={[assignment({ id: id(20), animalId: BULL, zoneId: NORTH })]}
      animals={[
        animal({ id: BULL, name: "Buster", safetyLevel: 5, safetyNotes: "Never on foot." }),
      ]}
      contacts={[] as Contact[]}
      templates={[] as ChoreTemplate[]}
      plans={[] as FeedingPlan[]}
      feeds={[] as FeedType[]}
      health={[] as HealthRecord[]}
      farmName="Flying Double M"
      {...overrides}
    />,
  );
}

/**
 * A pen's table, scoped to the document's body cell.
 *
 * `Section` wraps the whole preview in a `<section>` of its own, so a bare
 * `section table` selector finds the document before it finds a pen.
 */
const penTables = (container: HTMLElement) => [
  ...container.querySelectorAll('[data-print-part="body"] table[data-print-part="sheet"]'),
];

afterEach(() => {
  vi.useRealTimers();
});

describe("the printed document's shape", () => {
  it("puts the farm name and the date in a table head, which is what repeats", () => {
    // Not a decoration: `@page` margin boxes are unimplemented everywhere and a
    // fixed-position header prints on page one only in some engines. A table
    // head is the mechanism, so the name and the date have to be inside one or
    // they appear on sheet one and nowhere else.
    const { container } = paint();

    const running = container.querySelector('thead[data-print-part="running"]');
    expect(running).not.toBeNull();
    expect(running).toHaveTextContent("Flying Double M");
    expect(running).toHaveTextContent(/Printed \w+day, \d+ \w+ \d{4}|Printed \w+, \w+ \d+, \d{4}/);
  });

  it("keeps the document in the single cell below that head", () => {
    // One cell, so the head is the only part the browser repeats. A second row
    // of content would repeat nothing and paginate on its own terms.
    const { container } = paint();

    const body = container.querySelector('td[data-print-part="body"]');
    expect(body).not.toBeNull();
    expect(body).toHaveTextContent("While we are away");
    expect(body).toHaveTextContent("Buster");
  });

  it("gives each pen its own head, so a pen too tall for a sheet carries its level over", () => {
    // The failure this prevents: forty head in one pasture, the section runs
    // past the foot of the page, and sheet five opens with a list of names and
    // nothing to say whether you can walk in among them.
    const { container } = paint();

    const [pen] = penTables(container);
    expect(pen).not.toBeUndefined();

    const head = pen!.querySelector("thead");
    expect(head).not.toBeNull();
    expect(head).toHaveTextContent("North Trap");
    expect(head).toHaveTextContent("Do not handle");

    // The animals belong to the body, not the head — a head that carried them
    // would repeat the whole pen rather than its heading.
    expect(head).not.toHaveTextContent("Buster");
    expect(pen!.querySelector("tbody")).toHaveTextContent("Buster");
  });

  it("prints the safety level as a number as well as a colour", () => {
    // §8. A level that reaches paper as a coloured square and nothing else is
    // no level at all — to a photocopier, to a monochrome printer, and to the
    // reader who does not distinguish red from green.
    const { container } = paint();

    const head = penTables(container)[0]!.querySelector("thead") as HTMLElement;
    expect(within(head).getByText("5")).toBeInTheDocument();
    expect(head).toHaveTextContent("Do not handle");
  });

  it("re-dates the document when the print dialog opens", () => {
    // A guide recomposes on every render, so a tab left open on the kitchen
    // laptop overnight is already showing this morning's facts. The date it was
    // given is the one thing that would still say yesterday — and it is the one
    // thing printed on every sheet.
    vi.useFakeTimers();
    vi.setSystemTime(on(15));

    const { container } = paint();
    const dated = () =>
      container.querySelector('thead[data-print-part="running"]')?.textContent ?? "";

    expect(dated()).toContain("15");

    vi.setSystemTime(on(16));
    act(() => {
      globalThis.window.dispatchEvent(new Event("beforeprint"));
    });

    expect(dated()).toContain("16");
    // And the document is still there afterwards, rather than a re-render that
    // threw somewhere inside `flushSync`.
    expect(container.querySelector('td[data-print-part="body"]')).toHaveTextContent("Buster");
  });

  it("says so plainly when there is no guide yet", () => {
    paint({ guide: undefined });

    expect(screen.getByText("No guide to preview")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("marks the document for the print stylesheet to find", () => {
    paint();

    expect(screen.getByRole("article")).toHaveAttribute("data-print", "guide");
  });
});

/**
 * The rules in `globals.css` that are load-bearing rather than cosmetic.
 *
 * Read as text because there is no other way: jsdom parses the file but has no
 * print medium to apply it in, and asserting on computed styles would only
 * prove the screen rules.
 */
const CSS = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

/** The body of the `@media print` block, braces balanced. */
function printBlock(): string {
  const start = CSS.indexOf("@media print {");
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  for (let index = CSS.indexOf("{", start); index < CSS.length; index += 1) {
    if (CSS[index] === "{") depth += 1;
    if (CSS[index] === "}") {
      depth -= 1;
      if (depth === 0) return CSS.slice(start, index);
    }
  }
  throw new Error("Unclosed @media print block");
}

describe("the print stylesheet", () => {
  const block = printBlock();

  it("asks for the guide's colours exactly, in both spellings", () => {
    // Browsers print backgrounds only when the reader ticks "Background
    // graphics", and the safety chip's fill is a background. Measured in
    // Chromium: without this, the red is not painted at all and the white
    // numeral on it comes out as #ababab — a level 5 badge reading as a grey
    // smudge. The prefixed spelling is what WebKit answers to.
    expect(block).toMatch(/[^-]print-color-adjust:\s*exact/);
    expect(block).toMatch(/-webkit-print-color-adjust:\s*exact/);
  });

  it("never lifts the document out of the page's flow", () => {
    // The defect #42 was opened on. Chromium does not paginate an absolutely
    // positioned box past the end of its overflow, so a seven-page guide
    // printed six and lost every hand-written section with nothing on paper to
    // say anything was missing.
    expect(block).not.toMatch(/position:\s*(absolute|fixed)/);
  });

  it("takes the app off the page rather than making it invisible", () => {
    // Hidden-but-present chrome still occupies the sheet, which is what forced
    // the absolute positioning above. `display: none` collapses it instead.
    expect(block).toMatch(/display:\s*none\s*!important/);
    expect(block).not.toMatch(/visibility:\s*hidden/);
  });

  it("keeps a pen, a notice and a single instruction whole across a break", () => {
    expect(block).toMatch(/break-inside:\s*avoid/);

    // The selectors that earn it: the notices, which are sections; the pens,
    // which are now tables; and list items, which is what catches the lists
    // that are too long to be kept whole at all.
    const selectors = block.slice(0, block.indexOf("break-inside"));
    expect(selectors).toContain('[data-print="guide"] section');
    expect(selectors).toContain('[data-print="guide"] section > table');
    expect(selectors).toContain('[data-print="guide"] li');
  });

  it("turns the running head back on for paper and leaves it off on screen", () => {
    expect(CSS).toMatch(/thead\[data-print-part="running"\]\s*\{\s*display:\s*none/);
    expect(block).toMatch(
      /\[data-print-part="sheet"\]\s*>\s*thead\s*\{\s*display:\s*table-header-group/,
    );
  });
});
