import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandingConfig, Ulid } from "@galaxy-farm/core";

/**
 * Naming the farm, and who may (spec §5.1, §4.3, §7).
 *
 * Two separate things are asserted here and they are not the same thing:
 *
 * 1. **An owner can rename the farm and the app shows it.** The name is a
 *    stored value, not a string in code, so the payoff is that the navigation
 *    picks it up from the device rather than waiting for a deploy.
 * 2. **The tab is absent for anybody else.** Worth testing, and worth being
 *    clear that it proves nothing about permission. §4.3 is explicit that a
 *    hidden tab is not a check, and the check that matters lives in the push
 *    handler — `capabilities.test.ts` covers that, and `local-schema.test.ts`
 *    holds the two halves of its lookup table together.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const stored = vi.hoisted(() => ({
  current: {} as Record<string, readonly unknown[]>,
}));
const written = vi.hoisted(() => ({
  created: [] as unknown[],
  updated: [] as { id: string; patch: unknown }[],
}));

vi.mock("@/lib/local/use-records", () => ({
  useRecords: (store: string) => ({ records: stored.current[store] ?? [], loading: false }),
  useRecord: () => ({ record: undefined, loading: false }),
}));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: unknown) => {
      written.created.push(input);
      return { ok: true, value: input };
    },
    update: async (id: string, patch: unknown) => {
      written.updated.push({ id, patch });
      return { ok: true, value: patch };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings",
  useSearchParams: () => new URLSearchParams(),
}));

// The People tab sits beside Branding on this screen and reaches the `users`
// table through server actions, which pull in Auth.js and a Postgres client.
// None of that is under test here, and importing it needs a running server.
vi.mock("@/app/(admin)/admin/settings/_components/user-actions", () => ({
  invitePerson: async () => ({ ok: true, message: "" }),
  editPerson: async () => ({ ok: true, message: "" }),
  deletePerson: async () => ({ ok: true, message: "" }),
  restorePerson: async () => ({ ok: true, message: "" }),
  resendInvitation: async () => ({ ok: true, message: "" }),
  setPersonActive: async () => ({ ok: true, message: "" }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { SettingsScreen } =
  await import("../app/(admin)/admin/settings/_components/settings-screen.js");
const { AdminNav } = await import("../app/(admin)/_components/admin-nav.js");

vi.mock("@/app/_components/sync-provider", () => ({
  useSync: () => ({
    offline: false,
    problem: undefined,
    syncing: false,
    pending: 0,
    stuck: 0,
    retryStuck: async () => {},
  }),
}));

const config = (farmName: string, id = "01ARZ3NDEKTSV4RRFFQ69G5FB1"): BrandingConfig =>
  ({
    id: id as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    farmName,
  }) as BrandingConfig;

function settings(mayManageBranding: boolean) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <SettingsScreen
          propertyId={PROPERTY}
          actorId={ACTOR}
          people={[]}
          deleted={[]}
          mayManagePeople={false}
          mayManageBranding={mayManageBranding}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  stored.current = {};
  written.created = [];
  written.updated = [];
});

describe("the Branding tab", () => {
  it("is there for an owner", () => {
    settings(true);

    expect(screen.getByRole("tab", { name: /Branding/ })).toBeInTheDocument();
  });

  it("is absent for anybody else", () => {
    settings(false);

    expect(screen.queryByRole("tab", { name: /Branding/ })).not.toBeInTheDocument();
  });

  it("does not render the farm name field when the tab is absent", () => {
    // The tab strip falls through to Calving watch, rather than rendering the
    // branding panel with no tab pointing at it.
    settings(false);

    expect(screen.queryByLabelText(/^Farm name/)).not.toBeInTheDocument();
  });
});

describe("naming the farm", () => {
  it("creates the config the first time, since there is none to update", async () => {
    const user = userEvent.setup();
    settings(true);
    await user.click(screen.getByRole("tab", { name: /Branding/ }));

    const field = screen.getByLabelText(/^Farm name/);
    await user.clear(field);
    await user.type(field, "Rocking M Cattle");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(written.created).toHaveLength(1));
    expect(written.created[0]).toEqual({ farmName: "Rocking M Cattle" });
    expect(written.updated).toHaveLength(0);
  });

  it("updates the one that exists rather than adding a second", async () => {
    stored.current = { brandingConfigs: [config("Flying Double M")] };
    const user = userEvent.setup();
    settings(true);
    await user.click(screen.getByRole("tab", { name: /Branding/ }));

    const field = screen.getByLabelText(/^Farm name/);
    await user.clear(field);
    await user.type(field, "Home Place");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(written.updated).toHaveLength(1));
    expect(written.updated[0]?.patch).toEqual({ farmName: "Home Place" });
    expect(written.created).toHaveLength(0);
  });

  it("starts from the name already stored", async () => {
    stored.current = { brandingConfigs: [config("Home Place")] };
    const user = userEvent.setup();
    settings(true);
    await user.click(screen.getByRole("tab", { name: /Branding/ }));

    expect(screen.getByLabelText(/^Farm name/)).toHaveValue("Home Place");
  });

  it("refuses to save a blank name, and writes nothing", async () => {
    // Spaces rather than an empty box: the field is `required`, so the browser
    // already refuses to submit nothing at all. Whitespace is what gets past
    // that and would otherwise store a farm with no readable name.
    stored.current = { brandingConfigs: [config("Home Place")] };
    const user = userEvent.setup();
    settings(true);
    await user.click(screen.getByRole("tab", { name: /Branding/ }));

    const field = screen.getByLabelText(/^Farm name/);
    await user.clear(field);
    await user.type(field, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The farm needs a name");
    expect(written.created).toHaveLength(0);
    expect(written.updated).toHaveLength(0);
  });

  it("has nothing to save until something is typed", async () => {
    stored.current = { brandingConfigs: [config("Home Place")] };
    const user = userEvent.setup();
    settings(true);
    await user.click(screen.getByRole("tab", { name: /Branding/ }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("the navigation", () => {
  it("shows the stored name rather than what the server rendered", () => {
    // The point of the whole feature: the layout is a server component and
    // cannot see the device, so a rename would sit unread until a deploy if
    // the nav did not read it itself.
    stored.current = { brandingConfigs: [config("Rocking M Cattle")] };

    render(<AdminNav propertyId={PROPERTY} farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: /Rocking M Cattle/ })).toBeInTheDocument();
  });

  it("falls back to what the server rendered until the device answers", () => {
    // Dexie is still opening on the first render. A nav that showed a
    // placeholder here would flash the wrong farm name on every page load.
    stored.current = {};

    render(<AdminNav propertyId={PROPERTY} farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: /Flying Double M/ })).toBeInTheDocument();
  });

  it("agrees with the settings screen when two configs exist", () => {
    // Two devices named the farm offline. Both rows arrive, and every surface
    // has to pick the same one — see `resolveBranding`.
    stored.current = {
      brandingConfigs: [
        config("Second", "01ARZ3NDEKTSV4RRFFQ69G5FB2"),
        config("First", "01ARZ3NDEKTSV4RRFFQ69G5FB1"),
      ],
    };

    render(<AdminNav propertyId={PROPERTY} farmName="Flying Double M" />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: /First/ })).toBeInTheDocument();
  });
});
