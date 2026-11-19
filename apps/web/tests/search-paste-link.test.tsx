import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

/** Pasting a shared link into Search opens that screen (spec §8). */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/admin" }));
vi.mock("@/lib/local/use-records", () => ({
  useRecords: () => ({ records: [], loading: false }),
}));

const { SearchPaletteProvider, useSearchPalette } =
  await import("../app/(admin)/_components/search-palette.js");

function Opener() {
  const search = useSearchPalette();
  return (
    <button type="button" onClick={search.open}>
      Open search
    </button>
  );
}

describe("Search, given a shared link", () => {
  it("offers the shared screen, and Enter goes there", async () => {
    const user = userEvent.setup();
    render(
      <SearchPaletteProvider propertyId={"01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid}>
        <Opener />
      </SearchPaletteProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open search" }));
    const box = screen.getByRole("searchbox");
    await user.click(box);
    await user.paste(
      "Feeding today\n☐ Morning feed\nhttps://farm.test/admin/feed?tab=today&shared=1",
    );

    expect(screen.getByRole("link", { name: /Open the shared screen/ })).toHaveAttribute(
      "href",
      "/admin/feed?tab=today",
    );
    expect(screen.queryByText(/association catalog/)).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/admin/feed?tab=today");
  });
});
