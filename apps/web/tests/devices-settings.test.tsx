import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

/**
 * The Kiosk devices tab (spec §4.4, §4.5, §7 `/admin/settings`).
 *
 * The store is tested against real Postgres in `device-store.test.ts`; what is
 * asserted here is the half a person actually touches — that a screen can be
 * given a better name, that deleting one asks first and says what it costs,
 * and that a deleted one can be brought back. The README's note on the §4.5
 * guards asks for exactly this: the guard proves a dialog is imported, and
 * only a test like this one proves the dialog names the right screen.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

const actions = vi.hoisted(() => ({
  renamed: [] as { id: string; name: string }[],
  deleted: [] as string[],
  restored: [] as string[],
  revoked: [] as string[],
}));

vi.mock("@/app/(admin)/admin/settings/_components/device-actions", () => ({
  addDevice: async () => ({ ok: true, message: "Added." }),
  clearKioskPinAction: async () => ({ ok: true, message: "Cleared." }),
  lockDeviceAction: async () => ({ ok: true, message: "Locked." }),
  reissueDeviceAction: async () => ({ ok: true, message: "Reissued." }),
  setKioskPinAction: async () => ({ ok: true, message: "Set." }),
  renameDeviceAction: async (id: string, name: string) => {
    actions.renamed.push({ id, name });
    return { ok: true, message: `Renamed to ${name}.` };
  },
  deleteDeviceAction: async (id: string) => {
    actions.deleted.push(id);
    return { ok: true, message: "Deleted." };
  },
  restoreDeviceAction: async (id: string) => {
    actions.restored.push(id);
    return { ok: true, message: "Restored." };
  },
  revokeDeviceAction: async (id: string) => {
    actions.revoked.push(id);
    return { ok: true, message: "Revoked." };
  },
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { DevicesScreen } =
  await import("../app/(admin)/admin/settings/_components/devices-screen.js");

type Device = Parameters<typeof DevicesScreen>[0]["devices"][number];

const device = (over: Partial<Device> = {}): Device =>
  ({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FD1" as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-06-01T08:00:00Z"),
    updatedAt: new Date("2026-06-01T08:00:00Z"),
    name: "Barn TV",
    pairedAt: new Date("2026-06-01T08:05:00Z"),
    ...over,
  }) as Device;

function devicesScreen(props: Partial<Parameters<typeof DevicesScreen>[0]> = {}) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <DevicesScreen
          propertyId={PROPERTY}
          devices={[device()]}
          deleted={[]}
          pinSet={false}
          {...props}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

/**
 * The desktop half of `DataTable`.
 *
 * It renders a card stack and a table from the same columns — one hidden by a
 * breakpoint the other is not — so every row control is in the document twice
 * and an unscoped query finds both. Asserting against the table is arbitrary
 * but consistent; the card stack is the same `render` for the same column.
 */
const rows = () => within(screen.getByRole("table"));

beforeEach(() => {
  actions.renamed.length = 0;
  actions.deleted.length = 0;
  actions.restored.length = 0;
  actions.revoked.length = 0;
});

describe("renaming a paired screen", () => {
  it("saves the new name against the screen it was opened on", async () => {
    devicesScreen();

    await userEvent.click(rows().getByRole("button", { name: "Rename" }));
    const field = rows().getByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Coop tablet");
    await userEvent.click(rows().getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(actions.renamed).toEqual([{ id: device().id, name: "Coop tablet" }]),
    );
  });

  it("commits on Enter, because a rename is one field", async () => {
    devicesScreen();

    await userEvent.click(rows().getByRole("button", { name: "Rename" }));
    await userEvent.clear(rows().getByLabelText("Name"));
    await userEvent.type(rows().getByLabelText("Name"), "Coop tablet{Enter}");

    await waitFor(() =>
      expect(actions.renamed).toEqual([{ id: device().id, name: "Coop tablet" }]),
    );
  });

  it("writes nothing when the edit is abandoned", async () => {
    devicesScreen();

    await userEvent.click(rows().getByRole("button", { name: "Rename" }));
    await userEvent.type(rows().getByLabelText("Name"), " and more");
    await userEvent.click(rows().getByRole("button", { name: "Cancel" }));

    expect(actions.renamed).toEqual([]);
    expect(rows().getByText("Barn TV")).toBeInTheDocument();
  });
});

describe("deleting a screen", () => {
  it("names the screen in the dialog before anything is written (§4.5 clause 3)", async () => {
    devicesScreen();

    await userEvent.click(rows().getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Barn TV");
    // Elevated, not Standard: §4.5 puts anything on a kiosk in that tier.
    expect(dialog).toHaveAttribute("data-tier", "elevated");
    expect(actions.deleted).toEqual([]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(actions.deleted).toEqual([device().id]));
  });

  it("says a live screen goes dark, and that a restore brings it back", async () => {
    devicesScreen();

    await userEvent.click(rows().getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/goes dark within a minute/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/picks itself back up/i)).toBeInTheDocument();
  });

  it("does not warn a screen will go dark when it is already revoked", async () => {
    // Saying the wrong consequence is worse than saying none: it teaches
    // people to click past this dialog.
    devicesScreen({ devices: [device({ revokedAt: new Date("2026-06-02T08:00:00Z") })] });

    await userEvent.click(rows().getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/goes dark within a minute/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/already stopped/i)).toBeInTheDocument();
  });

  it("leaves the screen alone when the dialog is cancelled", async () => {
    devicesScreen();

    await userEvent.click(rows().getByRole("button", { name: "Delete" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(actions.deleted).toEqual([]);
  });

  it("offers the delete on a revoked screen, which has no other action left", async () => {
    devicesScreen({ devices: [device({ revokedAt: new Date("2026-06-02T08:00:00Z") })] });

    expect(rows().getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(rows().queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });
});

describe("the deleted screens", () => {
  it("is not there at all when nothing has been deleted", () => {
    devicesScreen();

    expect(screen.queryByText(/deleted screens/i)).not.toBeInTheDocument();
  });

  it("restores a tombstoned screen without a second confirmation", async () => {
    devicesScreen({
      devices: [],
      deleted: [device({ name: "Old coop tablet", deletedAt: new Date("2026-06-03T08:00:00Z") })],
    });

    expect(screen.getByText(/deleted screens/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(actions.restored).toEqual([device().id]));
  });
});
