import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import type { EggReturn } from "../lib/chores.js";

/**
 * Egg Quick-Entry (spec §4.4, §5.4): how many, and nothing else.
 *
 * Counted up on the big buttons and logged once as one row, with no colour or
 * size asked for — and, when it was opened by ticking off the egg round,
 * handed straight back to the board it came from.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const COOP = "01ARZ3NDEKTSV4RRFFQ69G5C01" as Ulid;

const calls = vi.hoisted(() => ({ logged: [] as unknown[], pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => calls.pushed.push(href) }),
  usePathname: () => "/kiosk/eggs",
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({
    records:
      store === "flocks"
        ? [{ id: COOP, propertyId: PROPERTY, name: "Main coop", active: true }]
        : [],
    loading: false,
  }),
}));

vi.mock("@/app/_components/sync-provider", () => ({
  useSyncEngine: () => ({ store: {}, syncNow: async () => {} }),
}));

vi.mock("@/app/(kiosk)/kiosk/_components/kiosk-weather", () => ({ KioskWeather: () => null }));

vi.mock("@/app/(kiosk)/kiosk/_actions", () => ({
  logKioskEggs: async (input: unknown) => {
    calls.logged.push(input);
    return { ok: true };
  },
}));

const { ToastProvider } = await import("@galaxy-farm/ui");
const { EggsBoardScreen } = await import("../app/(kiosk)/kiosk/eggs/eggs-board-screen.js");

beforeEach(() => {
  calls.logged = [];
  calls.pushed = [];
});

function view(returnTo?: EggReturn) {
  return render(
    <ToastProvider>
      <EggsBoardScreen propertyId={PROPERTY} returnTo={returnTo} />
    </ToastProvider>,
  );
}

describe("Egg Quick-Entry", () => {
  it("asks how many and nothing else", () => {
    view();

    expect(screen.queryByText(/brown|large|medium|colour|size/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Count the eggs first" })).toBeDisabled();
  });

  it("logs the collection once, as one count", async () => {
    view();

    await userEvent.click(screen.getByRole("button", { name: "Add 12" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 1" }));
    await userEvent.click(screen.getByRole("button", { name: "One fewer" }));
    await userEvent.click(screen.getByRole("button", { name: "Log 13 eggs" }));

    expect(calls.logged).toEqual([{ flockId: COOP, count: 13 }]);
    // Opened from the boards, it stays put for the next coop.
    expect(calls.pushed).toEqual([]);
  });

  it("hands back to the chore board it was opened from", async () => {
    view("/kiosk/chores");

    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/kiosk/chores");

    await userEvent.click(screen.getByRole("button", { name: "Add 6" }));
    await userEvent.click(screen.getByRole("button", { name: "Log 6 eggs" }));

    expect(calls.pushed).toEqual(["/kiosk/chores"]);
  });

  it("inside Hive, asks Hive to close it once logged, with no back link of its own", async () => {
    const posted: unknown[] = [];
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    const spy = vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);

    view("hive");

    expect(screen.queryByRole("link", { name: "Back" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add 12" }));
    await userEvent.click(screen.getByRole("button", { name: "Log 12 eggs" }));

    expect(calls.logged).toEqual([{ flockId: COOP, count: 12 }]);
    expect(posted).toEqual([{ type: "hive:close", v: 1 }]);
    expect(calls.pushed).toEqual([]);
    spy.mockRestore();
  });
});
