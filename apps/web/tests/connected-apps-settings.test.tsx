import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

/**
 * The Connected apps tab (spec §4.3 "Connected apps", §4.5).
 *
 * The store is tested against Postgres in `board-store.test.ts`. Held here:
 * the token is shown once, on minting, and revoking asks first and names the
 * app it is about to cut off.
 */

const actions = vi.hoisted(() => ({ added: [] as string[], revoked: [] as string[] }));

vi.mock("@/app/(admin)/admin/settings/_components/api-token-actions", () => ({
  addApiToken: async (label: string) => {
    actions.added.push(label);
    return { ok: true, message: "Minted.", token: "gfapp_shown-once" };
  },
  revokeApiTokenAction: async (id: string) => {
    actions.revoked.push(id);
    return { ok: true, message: "Revoked." };
  },
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { ConnectedAppsScreen } =
  await import("../app/(admin)/admin/settings/_components/connected-apps-screen.js");

const TOKEN = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FX1" as Ulid,
  propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid,
  label: "Fridge Board",
  createdAt: new Date("2026-11-01T12:00:00Z"),
  createdBy: "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid,
};

const show = (tokens = [TOKEN]) =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <ConnectedAppsScreen tokens={tokens} />
      </ConfirmProvider>
    </ToastProvider>,
  );

const rows = () => within(screen.getByRole("table"));

beforeEach(() => {
  actions.added.length = 0;
  actions.revoked.length = 0;
});

describe("minting a token", () => {
  it("shows the token once, after naming the app", async () => {
    show([]);
    await userEvent.click(screen.getByRole("button", { name: "Mint a token" }));
    await userEvent.type(screen.getByLabelText("App"), "Fridge Board");
    await userEvent.click(screen.getByRole("button", { name: "Mint and show the token" }));

    await waitFor(() => expect(actions.added).toEqual(["Fridge Board"]));
    expect(await screen.findByText("gfapp_shown-once")).toBeInTheDocument();
  });
});

describe("revoking a token", () => {
  it("names the app in an Elevated dialog before anything is written", async () => {
    show();
    await userEvent.click(rows().getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Fridge Board");
    expect(dialog).toHaveAttribute("data-tier", "elevated");
    expect(actions.revoked).toEqual([]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(actions.revoked).toEqual([TOKEN.id]));
  });

  it("offers nothing further on a revoked token", () => {
    show([{ ...TOKEN, revokedAt: new Date("2026-11-02T12:00:00Z") } as never]);
    expect(rows().queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(rows().getByText(/Revoked/)).toBeInTheDocument();
  });
});
