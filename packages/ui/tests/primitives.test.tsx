import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../src/primitives/button.js";
import { Checkbox, Select, TextArea, TextInput } from "../src/primitives/field.js";
import { Badge, Card, DataTable, EmptyState } from "../src/primitives/surfaces.js";
import { Tabs } from "../src/primitives/tabs.js";

/**
 * What the primitives promise.
 *
 * Not how they look — the token tests cover colour and size, and asserting
 * class names here would only restate the implementation. These are the
 * behaviours that break silently: a label that reaches no screen reader, an
 * error nobody is told about, a button that submits a form it was never meant
 * to touch, a tab strip that takes eleven presses to walk past.
 */

describe("Button", () => {
  it("does not submit the form it happens to be inside", async () => {
    // A row-action button that reloads the page gets reported as "it lost my
    // work", and the cause is one missing attribute.
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Move pen</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Move pen" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when it is asked to", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("drops the click while busy but stays reachable", async () => {
    // Disabling would drop the control out of the tab order mid-action and
    // throw a screen reader out of the place it was.
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Saving
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving" });
    await userEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toBeDisabled();
  });
});

describe("form controls", () => {
  it("labels the input, so it can be filled in without seeing it", async () => {
    render(<TextInput label="Tag number" />);

    await userEvent.type(screen.getByLabelText("Tag number"), "42");

    expect(screen.getByLabelText("Tag number")).toHaveValue("42");
  });

  it("attaches the error to the field, not to the page", () => {
    // §4.5 clause 2: errors surface per field. A banner saying "something went
    // wrong" has told nobody which of eleven fields to fix.
    render(<TextInput label="Birth weight" error="Must be a number" />);

    const input = screen.getByLabelText("Birth weight");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Must be a number");
  });

  it("replaces the hint with the error rather than showing both", () => {
    const { rerender } = render(<TextInput label="Weight" hint="Pounds" />);
    expect(screen.getByLabelText("Weight")).toHaveAccessibleDescription("Pounds");

    rerender(<TextInput label="Weight" hint="Pounds" error="Cannot be negative" />);

    expect(screen.getByLabelText("Weight")).toHaveAccessibleDescription("Cannot be negative");
    expect(screen.queryByText("Pounds")).not.toBeInTheDocument();
  });

  it("says a field is required in words, not only with an asterisk", () => {
    render(<TextInput label="Name" required />);

    expect(screen.getByText("(required)")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeRequired();
  });

  it("lines numbers up when they are meant to be compared", () => {
    // A column of weights in proportional figures cannot be scanned, and
    // scanning is the only reason the column exists.
    render(<TextInput label="Weight" numeric />);

    expect(screen.getByLabelText("Weight")).toHaveClass("gf-numeric");
  });

  it("carries label and error through the textarea and select too", () => {
    render(
      <>
        <TextArea label="Notes" error="Too long" />
        <Select label="Sex" options={[{ value: "female", label: "Female" }]} error="Pick one" />
      </>,
    );

    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription("Too long");
    expect(screen.getByLabelText("Sex")).toHaveAccessibleDescription("Pick one");
  });

  it("offers a placeholder that cannot be chosen", () => {
    render(
      <Select
        label="Zone"
        placeholder="Choose a pen"
        defaultValue=""
        options={[{ value: "pen-a", label: "Pen A" }]}
      />,
    );

    expect(screen.getByRole("option", { name: "Choose a pen" })).toBeDisabled();
  });

  it("makes the whole checkbox row the target, not the 16px box", async () => {
    // One-thumb logging in a barn does not tolerate a 16px hit area.
    render(<Checkbox label="Treated today" />);

    await userEvent.click(screen.getByText("Treated today"));

    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});

describe("DataTable", () => {
  const rows = [
    { id: "1", name: "Andromeda", weight: 1320 },
    { id: "2", name: "Cassiopeia", weight: 1180 },
  ];
  const columns = [
    { key: "name", header: "Name", render: (r: (typeof rows)[number]) => r.name },
    {
      key: "weight",
      header: "Weight",
      numeric: true,
      render: (r: (typeof rows)[number]) => r.weight,
    },
  ];

  it("names itself, so a page of tables is not a maze", () => {
    render(
      <DataTable caption="Cattle by pen" columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );

    expect(screen.getByRole("table", { name: "Cattle by pen" })).toBeInTheDocument();
  });

  it("renders a row per record with its cells", () => {
    render(<DataTable caption="Cattle" columns={columns} rows={rows} rowKey={(r) => r.id} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
    expect(within(table).getByText("Andromeda")).toBeInTheDocument();
  });

  it("puts numbers in a tabular column", () => {
    render(<DataTable caption="Cattle" columns={columns} rows={rows} rowKey={(r) => r.id} />);

    // Scoped to the table: the phone layout renders the same values as cards,
    // and both are in the DOM at once. Only one is ever *displayed* — the
    // other is `display: none`, which also takes it out of the accessibility
    // tree — but jsdom applies no CSS, so a bare query finds both.
    const table = screen.getByRole("table");
    expect(within(table).getByText("1320")).toHaveClass("gf-numeric");
  });

  it("renders a card per row for a phone, built from the same columns", () => {
    // A seven-column table on a 375px screen is one you read by dragging
    // sideways, and the moment you drag, the name of the animal the row is
    // about scrolls off the left.
    render(<DataTable caption="Cattle" columns={columns} rows={rows} rowKey={(r) => r.id} />);

    const cards = screen.getByRole("list");
    expect(within(cards).getAllByRole("listitem")).toHaveLength(rows.length);
    // The identity column heads the card; the rest arrive as labelled pairs.
    expect(within(cards).getByText("Andromeda")).toBeInTheDocument();
    expect(within(cards).getAllByRole("term").length).toBeGreaterThan(0);
  });

  it("shows the empty state instead of a table with no rows", () => {
    // A blank panel teaches nobody what the screen is for. A new install
    // spends its first week in this state.
    render(
      <DataTable
        caption="Cattle"
        columns={columns}
        rows={[]}
        rowKey={(r: { id: string }) => r.id}
        empty={<EmptyState title="No cattle yet" detail="Add the first one to get started." />}
      />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No cattle yet")).toBeInTheDocument();
  });
});

describe("Card and Badge", () => {
  it("gives a titled card a heading, so the page has an outline", () => {
    render(<Card title="Breeding">content</Card>);

    expect(screen.getByRole("heading", { name: "Breeding" })).toBeInTheDocument();
  });

  it("renders an untitled card without an empty header", () => {
    const { container } = render(<Card>content</Card>);

    expect(container.querySelector("header")).toBeNull();
  });

  it("shows a badge's text, which is what carries its meaning", () => {
    // Outlined rather than filled: a page of filled badges would compete with
    // the safety chips, where a block of colour means something specific.
    render(<Badge tone="danger">Overdue</Badge>);

    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "health", label: "Health" },
    { id: "breeding", label: "Breeding" },
  ];

  const harness = () =>
    render(
      <Tabs tabs={tabs} label="Animal sections">
        {(active) => <p>Panel: {active}</p>}
      </Tabs>,
    );

  it("opens on the first tab", () => {
    harness();

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel: overview")).toBeInTheDocument();
  });

  it("takes one tab stop for the whole strip", () => {
    // Individually tabbable tabs turn an eleven-section animal profile into
    // eleven presses to reach the content.
    harness();

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Health" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves with the arrow keys", async () => {
    harness();
    screen.getByRole("tab", { name: "Overview" }).focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Health" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel: health")).toBeInTheDocument();
  });

  it("wraps around rather than stopping at the end", async () => {
    harness();
    screen.getByRole("tab", { name: "Overview" }).focus();

    await userEvent.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Breeding" })).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the ends with Home and End", async () => {
    harness();
    screen.getByRole("tab", { name: "Overview" }).focus();

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Breeding" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("ties each panel to its tab", () => {
    harness();

    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Overview");
  });

  it("lets the URL own the active tab when it needs to", async () => {
    // A deep link to an animal's health tab has to survive a refresh.
    const onTabChange = vi.fn();
    render(
      <Tabs tabs={tabs} label="Animal sections" activeTab="health" onTabChange={onTabChange}>
        {(active) => <p>Panel: {active}</p>}
      </Tabs>,
    );

    expect(screen.getByText("Panel: health")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Breeding" }));

    // Reports the change and leaves the decision to the caller.
    expect(onTabChange).toHaveBeenCalledWith("breeding");
    expect(screen.getByText("Panel: health")).toBeInTheDocument();
  });
});
