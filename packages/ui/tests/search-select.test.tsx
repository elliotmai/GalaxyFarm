import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { matchesSearch, SearchSelect } from "../src/primitives/search-select.js";

/**
 * The picker you can type into (spec §8).
 *
 * Built for the ancestors list, which is thirty animals after one import and
 * several hundred within a year. What has to hold: typing filters rather than
 * creates, the match covers the registration number as well as the name, and
 * the whole thing works from the keyboard — a picker that needs a mouse is a
 * picker that cannot be used with gloves on.
 */

const OPTIONS = [
  { value: "a", label: "CMAC TYSON ET", detail: "AMAA 364424", group: "Ours" },
  { value: "b", label: "SULL TINA'S SOLUTION ET", detail: "ASA *x4157771", group: "On the papers" },
  { value: "c", label: "ZNT JENNA 707T", detail: "ACA 337003", group: "On the papers" },
];

describe("matching", () => {
  it("needs every word, in any order", () => {
    const option = OPTIONS[1] as (typeof OPTIONS)[number];

    expect(matchesSearch(option, "sull tina")).toBe(true);
    expect(matchesSearch(option, "tina sull")).toBe(true);
    expect(matchesSearch(option, "sull hereford")).toBe(false);
  });

  it("searches the detail as well as the label", () => {
    // The registration number is what somebody has in front of them off the
    // paper, and often the only part of a worn tag they can read.
    expect(matchesSearch(OPTIONS[2] as (typeof OPTIONS)[number], "337003")).toBe(true);
  });

  it("ignores punctuation and case", () => {
    expect(matchesSearch(OPTIONS[1] as (typeof OPTIONS)[number], "tinas")).toBe(true);
  });
});

describe("the control", () => {
  const setup = (value = "") => {
    const onChange = vi.fn();
    render(
      <SearchSelect
        label="Sire"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        clearLabel="Unknown"
      />,
    );
    return { onChange, input: screen.getByRole("combobox", { name: "Sire" }) };
  };

  it("shows what is chosen when it is closed", () => {
    const { input } = setup("a");

    expect(input).toHaveValue("CMAC TYSON ET");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("narrows the list as you type", async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.click(input);
    expect(screen.getAllByRole("option")).toHaveLength(4); // three, plus "Unknown"

    await user.type(input, "jenna");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /ZNT JENNA/ })).toBeInTheDocument();
  });

  it("picks with the keyboard alone", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup();

    await user.click(input);
    await user.type(input, "tyson");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("moves through the list with the arrow keys", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup();

    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");

    // The first row is the clear option, the second is the first animal.
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("offers a way to clear the choice", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup("a");

    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Unknown" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("closes on Escape without changing anything", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup("a");

    await user.click(input);
    await user.type(input, "jenna");
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // And the half-typed name is gone, so it cannot read as a selection.
    expect(input).toHaveValue("CMAC TYSON ET");
  });

  it("says so rather than showing an empty box when nothing matches", async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.click(input);
    await user.type(input, "hereford");

    expect(screen.getByText(/Nothing on file matches/)).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("never invents a value from what was typed", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup();

    // A free-text field that accepts a name nobody has on file is how a
    // pedigree ends up pointing at a bull that does not exist.
    await user.click(input);
    await user.type(input, "A BULL I MADE UP{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });
});
