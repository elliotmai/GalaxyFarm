import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TagInput } from "../src/primitives/tag-input.js";

/**
 * The short-list field (spec §8).
 *
 * Written for breed, which is the case that proves the shape: a crossbred cow
 * is Maine-Anjou *and* Angus, so a single text box gets it wrong every time.
 */

const setup = (value: string[] = [], props: Partial<Parameters<typeof TagInput>[0]> = {}) => {
  const onChange = vi.fn();
  render(<TagInput label="Breed" value={value} onChange={onChange} {...props} />);
  return { onChange, box: screen.getByLabelText("Breed") };
};

describe("adding", () => {
  it("adds what was typed when Enter is pressed", () => {
    const { onChange, box } = setup();

    fireEvent.change(box, { target: { value: "Angus" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["Angus"]);
  });

  it("adds what was typed when the box is left", () => {
    // Typing a breed and tabbing away expecting it to be there is what people
    // do. Losing it is the sort of quiet data loss nobody reports.
    const { onChange, box } = setup(["Angus"]);

    fireEvent.change(box, { target: { value: "Maine-Anjou" } });
    fireEvent.blur(box);

    expect(onChange).toHaveBeenCalledWith(["Angus", "Maine-Anjou"]);
  });

  it("does not submit the form it sits in", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <TagInput label="Breed" value={[]} onChange={() => undefined} />
      </form>,
    );

    const box = screen.getByLabelText("Breed");
    fireEvent.change(box, { target: { value: "Angus" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses the same word twice, whatever the capitals", () => {
    // "angus" typed under "Angus" is the same breed, and two spellings of it
    // split every filter that reads the field.
    const { onChange, box } = setup(["Angus"]);

    fireEvent.change(box, { target: { value: "angus" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores blank input", () => {
    const { onChange, box } = setup();

    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops at the limit rather than growing forever", () => {
    const { box } = setup(["a", "b"], { max: 2 });

    expect(box).toBeDisabled();
  });
});

describe("removing", () => {
  it("takes one out by its own button", () => {
    const { onChange } = setup(["Angus", "Maine-Anjou"]);

    fireEvent.click(screen.getByLabelText("Remove Angus"));

    expect(onChange).toHaveBeenCalledWith(["Maine-Anjou"]);
  });

  it("takes the last one back on backspace in an empty box", () => {
    const { onChange, box } = setup(["Angus", "Maine-Anjou"]);

    fireEvent.keyDown(box, { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith(["Angus"]);
  });

  it("leaves the list alone when backspace has text to eat", () => {
    const { onChange, box } = setup(["Angus"]);

    fireEvent.change(box, { target: { value: "Mai" } });
    fireEvent.keyDown(box, { key: "Backspace" });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("suggestions", () => {
  it("offers what is not already set", () => {
    setup(["Angus"], { suggestions: ["Angus", "Maine-Anjou", "Shorthorn"] });

    const offered = Array.from(document.querySelectorAll("datalist option")).map((node) =>
      node.getAttribute("value"),
    );
    expect(offered).toEqual(["Maine-Anjou", "Shorthorn"]);
  });

  it("narrows as you type, without stopping anything else being entered", () => {
    const { onChange, box } = setup([], { suggestions: ["Maine-Anjou", "Shorthorn"] });

    fireEvent.change(box, { target: { value: "short" } });
    const offered = Array.from(document.querySelectorAll("datalist option")).map((node) =>
      node.getAttribute("value"),
    );
    expect(offered).toEqual(["Shorthorn"]);

    // A farm that buys one unusual bull should not wait for a code change to
    // record what he is.
    fireEvent.change(box, { target: { value: "Black Baldy" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Black Baldy"]);
  });
});

describe("the label and the error", () => {
  it("names what is set, for a screen reader", () => {
    setup(["Angus"]);

    expect(screen.getByLabelText("Breed, currently set")).toBeInTheDocument();
  });

  it("marks the field invalid and says why", () => {
    setup([], { error: "Pick at least one" });

    expect(screen.getByLabelText("Breed")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Pick at least one")).toBeInTheDocument();
  });
});
