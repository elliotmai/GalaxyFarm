import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Modal } from "../src/primitives/modal.js";

/**
 * The dialog for anything that is not a confirmation (spec §8).
 *
 * It exists because an edit form rendered inline at the top of a long list,
 * when the row you clicked is near the foot of it, appears to do nothing at
 * all — which is exactly how the ancestors editor was reported.
 */

describe("the dialog", () => {
  it("is announced as a modal, by its title", () => {
    render(
      <Modal title="Editing CMAC TYSON ET" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Editing CMAC TYSON ET" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("takes focus, so the next Tab is inside it", () => {
    render(
      <Modal title="Editing" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="Editing" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on the backdrop but not on the panel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Modal title="Editing" onClose={onClose}>
        <button type="button">inside</button>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "inside" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(container.firstElementChild as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stops the page behind it scrolling, and puts it back", () => {
    // On a phone the page scrolling under a dialog reads as the dialog itself
    // sliding away.
    const { unmount } = render(
      <Modal title="Editing" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );

    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("has a close control that says what it is", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="Editing" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("describes itself with the subtitle when there is one", () => {
    render(
      <Modal title="Editing" description="Off the certificate." onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Off the certificate.");
  });
});
