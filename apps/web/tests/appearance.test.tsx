import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AppearanceSetting } from "../app/(admin)/admin/settings/_components/appearance-setting.js";
import { ThemeSync } from "../app/(admin)/_components/theme-sync.js";
import { APPEARANCE_KEY } from "../lib/appearance.js";

/**
 * Light by default, dark or the device's own choice on request, per device.
 */

function Surface() {
  return (
    <div data-surface="admin" data-theme="flying-day">
      <ThemeSync />
      <AppearanceSetting />
    </div>
  );
}

const theme = () => document.querySelector('[data-surface="admin"]')?.getAttribute("data-theme");

describe("appearance", () => {
  beforeEach(() => window.localStorage.clear());

  it("is light until somebody chooses otherwise", () => {
    render(<Surface />);

    expect(theme()).toBe("flying-day");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches the surface and remembers the choice on this device", async () => {
    render(<Surface />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(theme()).toBe("flying-night");
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe("dark");

    await userEvent.click(screen.getByRole("radio", { name: "Match device" }));
    expect(theme()).toBe("flying-auto");
  });

  it("follows a choice made in another tab", () => {
    render(<Surface />);

    act(() => {
      window.localStorage.setItem(APPEARANCE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY }));
    });
    expect(theme()).toBe("flying-night");
  });
});
