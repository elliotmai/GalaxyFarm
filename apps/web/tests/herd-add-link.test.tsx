import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

/**
 * `/admin/cattle?add=1` opens the add form (V2 Animals).
 *
 * The Animals list's "+ Add animal" lands here rather than keeping a second
 * add form, so the flag has to open the herd's own one — and then leave the
 * address, so a reload does not open it again.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

vi.mock("@/lib/local/use-records", () => ({
  useRecords: () => ({ records: [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async () => ({ ok: true, value: {} }),
    update: async () => ({ ok: true, value: {} }),
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/cattle",
  useSearchParams: () => new URLSearchParams(),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { HerdScreen } = await import("../app/(admin)/admin/cattle/_components/herd-screen.js");

function view() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <HerdScreen propertyId={PROPERTY} actorId={ACTOR} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the herd's add link", () => {
  it("opens the add form for ?add=1 and drops the flag", () => {
    window.history.replaceState(null, "", "/admin/cattle?add=1");
    view();

    expect(screen.getByRole("dialog", { name: "Add an animal" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("stays closed without it", () => {
    window.history.replaceState(null, "", "/admin/cattle");
    view();

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
