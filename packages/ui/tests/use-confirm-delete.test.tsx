import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider, useConfirmDelete } from "../src/confirm/use-confirm-delete.js";
import type { ConfirmRequest } from "../src/confirm/types.js";

/**
 * The hook is what call sites import, and importing it is what satisfies the
 * CI guard. These tests cover the contract that guard cannot see: that the
 * promise actually gates the deletion.
 */

const request: ConfirmRequest = {
  tier: "standard",
  recordName: "North Trap",
  entity: "pen",
  dependents: [],
};

function DeleteButton({
  onDelete,
  overrides = {},
}: {
  onDelete: () => void;
  overrides?: Partial<ConfirmRequest>;
}) {
  const confirm = useConfirmDelete();
  const [result, setResult] = useState<string>("untouched");

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const confirmed = await confirm({ ...request, ...overrides });
          setResult(confirmed ? "confirmed" : "cancelled");
          if (confirmed) onDelete();
        }}
      >
        Delete pen
      </button>
      <output>{result}</output>
    </>
  );
}

describe("useConfirmDelete", () => {
  it("does not delete until the user confirms", async () => {
    const onDelete = vi.fn();
    render(
      <ConfirmProvider>
        <DeleteButton onDelete={onDelete} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("never deletes when the user cancels", async () => {
    const onDelete = vi.fn();
    render(
      <ConfirmProvider>
        <DeleteButton onDelete={onDelete} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("cancelled");
  });

  it("closes the dialog once a decision is made", async () => {
    render(
      <ConfirmProvider>
        <DeleteButton onDelete={vi.fn()} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resolves without touching the network", async () => {
    // Spec §4.5: a delete performed in the barn with zero bars must behave
    // exactly like one performed at the kitchen table. Any fetch here would
    // be a bug, so fail loudly if one appears.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ConfirmProvider>
        <DeleteButton onDelete={vi.fn()} />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("can be used again after a decision", async () => {
    const onDelete = vi.fn();
    render(
      <ConfirmProvider>
        <DeleteButton onDelete={onDelete} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("passes the tier through to the dialog", async () => {
    render(
      <ConfirmProvider>
        <DeleteButton onDelete={vi.fn()} overrides={{ tier: "typed", recordName: "Dolly" }} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete pen" }));

    expect(screen.getByRole("dialog")).toHaveAttribute("data-tier", "typed");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("refuses to work outside a provider, rather than silently doing nothing", () => {
    // A missing provider must not degrade into deleting without confirmation.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<DeleteButton onDelete={vi.fn()} />)).toThrow(/ConfirmProvider/);

    consoleError.mockRestore();
  });
});
