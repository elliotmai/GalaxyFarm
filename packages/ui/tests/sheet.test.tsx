import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Sheet } from "../src/primitives/sheet.js";

/**
 * jsdom implements `<dialog>` as an element but not as a dialog: `showModal`
 * and `close` are absent, so without these the component throws on mount.
 * Stubbed rather than skipped, because what is being tested here is the
 * component's contract — that it opens, closes, and reports closing — and not
 * the browser's top-layer implementation.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

function Harness({ open = true, onClose = () => {} }: { open?: boolean; onClose?: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log a weight"
      description="Juniper, tag 118"
      footer={<button type="button">Save weigh-in</button>}
    >
      <label>
        Weight
        <input defaultValue="1184" />
      </label>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("opens only when asked to", () => {
    const { rerender } = render(<Harness open={false} />);
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");

    rerender(<Harness open />);
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });

  it("names itself and its purpose for a screen reader", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName("Log a weight");
    expect(dialog).toHaveAccessibleDescription("Juniper, tag 118");
  });

  it("keeps the form and the footer action", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Weight")).toHaveValue("1184");
    expect(screen.getByRole("button", { name: "Save weigh-in" })).toBeInTheDocument();
  });

  it("reports a cancel so the caller's state can follow", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a backdrop click but not on a click inside", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    // Anything inside the panel stops at a child; only the dialog element
    // itself is the backdrop. Getting this wrong closes the sheet whenever
    // somebody taps a label.
    await userEvent.click(screen.getByLabelText("Weight"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("tells the caller when Escape closes it", () => {
    // Escape fires `cancel`, not `close`. Left to the default the dialog would
    // shut without the caller hearing, leaving `open` true and the sheet
    // impossible to reopen.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
