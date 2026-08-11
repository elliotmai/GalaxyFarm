import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../src/confirm/confirm-dialog.js";
import { InvalidConfirmRequestError, type ConfirmRequest } from "../src/confirm/types.js";

/**
 * Spec §4.5 clause 3. The CI guard checks that a confirmation helper is
 * *present* in a file that deletes; these tests check that the dialog it
 * renders actually says something useful.
 */

const request = (overrides: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  tier: "standard",
  recordName: "North Trap",
  entity: "pen",
  dependents: [],
  ...overrides,
});

describe("ConfirmDialog", () => {
  it("names the record being deleted", () => {
    render(<ConfirmDialog request={request()} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("heading")).toHaveTextContent("Delete pen North Trap?");
  });

  it("names what else is affected, rather than asking a bare are-you-sure", () => {
    // "Delete pen North Trap? 4 animals are currently assigned to it."
    render(
      <ConfirmDialog
        request={request({
          tier: "elevated",
          dependents: [
            { entity: "Animal", label: "Dolly", effect: "detached" },
            { entity: "Animal", label: "Maisie", effect: "detached" },
          ],
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("dependent-summary")).toHaveTextContent(
      "2 records will lose the reference",
    );
    expect(screen.getByTestId("dependent-list")).toHaveTextContent("Dolly");
    expect(screen.getByTestId("dependent-list")).toHaveTextContent("Maisie");
  });

  it("omits the dependent line entirely when nothing else is affected", () => {
    render(<ConfirmDialog request={request()} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByTestId("dependent-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dependent-list")).not.toBeInTheDocument();
  });

  it("distinguishes cascade from detach in the wording", () => {
    render(
      <ConfirmDialog
        request={request({
          tier: "elevated",
          dependents: [
            { entity: "WeightRecord", label: "3 entries", effect: "deleted" },
            { entity: "Photo", label: "barn shot", effect: "detached" },
          ],
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const summary = screen.getByTestId("dependent-summary");
    expect(summary).toHaveTextContent("1 record will be deleted");
    expect(summary).toHaveTextContent("1 record will lose the reference");
  });

  it("tells the user the delete is recoverable", () => {
    // This is what makes the confirmation honest — §4.5 clause 4.
    render(<ConfirmDialog request={request()} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId("undo-hint")).toHaveTextContent("Trash");
  });

  it("states the exact count for a bulk delete", () => {
    render(
      <ConfirmDialog
        request={request({ tier: "elevated", bulkCount: 12 })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading")).toHaveTextContent("Delete 12 pen records?");
  });

  it("confirms and cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog request={request()} onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("focuses Cancel, so a stray Enter does nothing", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog request={request()} onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog request={request()} onConfirm={vi.fn()} onCancel={onCancel} />);

    await userEvent.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("is announced as a modal dialog", () => {
    render(<ConfirmDialog request={request()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Delete pen North Trap?");
  });

  it("uses a custom action verb for irreversible non-deletes", () => {
    // §4.5 covers voiding an invoice and revoking a device too.
    render(
      <ConfirmDialog
        request={request({ entity: "invoice", recordName: "#1042", action: "Void" })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
  });
});

describe("Typed tier", () => {
  const typed = request({ tier: "typed", recordName: "Dolly", entity: "animal" });

  it("disables confirm until the name is typed exactly", async () => {
    render(<ConfirmDialog request={typed} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const confirmButton = screen.getByRole("button", { name: "Delete" });

    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Type Dolly to confirm"), "Doll");
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Type Dolly to confirm"), "y");
    expect(confirmButton).toBeEnabled();
  });

  it("is case-sensitive, because a whole animal's history is going", async () => {
    render(<ConfirmDialog request={typed} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Type Dolly to confirm"), "dolly");

    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("tolerates surrounding whitespace", async () => {
    render(<ConfirmDialog request={typed} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Type Dolly to confirm"), "  Dolly  ");

    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("does not promise a restore, since Typed covers purges", () => {
    render(<ConfirmDialog request={typed} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByTestId("undo-hint")).not.toBeInTheDocument();
  });
});

describe("Elevated tier on a kiosk", () => {
  const gated = request({ tier: "elevated", pin: "2468" });

  it("disables confirm until the PIN matches", async () => {
    render(<ConfirmDialog request={gated} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const confirmButton = screen.getByRole("button", { name: "Delete" });

    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Enter PIN"), "1111");
    expect(confirmButton).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Enter PIN"));
    await userEvent.type(screen.getByLabelText("Enter PIN"), "2468");
    expect(confirmButton).toBeEnabled();
  });

  it("does not ask for a PIN when the surface is not a kiosk", () => {
    render(
      <ConfirmDialog
        request={request({ tier: "elevated" })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Enter PIN")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});

describe("requests too weak to satisfy the clause", () => {
  it("refuses an unnamed record", () => {
    expect(() =>
      render(
        <ConfirmDialog
          request={request({ recordName: "  " })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    ).toThrow(InvalidConfirmRequestError);
  });

  it("refuses a bulk delete at Standard tier", () => {
    expect(() =>
      render(
        <ConfirmDialog
          request={request({ bulkCount: 9, tier: "standard" })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    ).toThrow(/at least Elevated/);
  });

  it("refuses an empty PIN gate", () => {
    expect(() =>
      render(
        <ConfirmDialog
          request={request({ tier: "elevated", pin: "" })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    ).toThrow(/non-empty PIN/);
  });
});
