import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import type { CattleProfile } from "@galaxy-farm/module-cattle";

/**
 * Setting a lab result (spec §5.2).
 *
 * Recording one took the whole app down with "Application error: a client-side
 * exception has occurred". The result saved fine; what could not survive was
 * reading it back. A hair card lives inside one JSON column, the sync
 * transport only revived timestamps in columns of their own, and so the card
 * came back from the server with `testedOn` as a string — which this panel
 * formatted, and React answers a render that throws by unmounting everything.
 *
 * The transport is fixed and devices re-read what they hold, but a card
 * written by an older build is still on somebody's phone. So the panel is
 * asserted against both shapes: what a device stores now, and what one that
 * has not caught up still has.
 */

const saved = vi.hoisted(() => ({ writes: [] as Record<string, unknown>[] }));

vi.mock("@/lib/local/mutations", () => ({
  useMutations: () => ({
    create: async (input: Record<string, unknown>) => {
      saved.writes.push(input);
      return { ok: true, value: input };
    },
    update: async (_id: string, patch: Record<string, unknown>) => {
      saved.writes.push(patch);
      return { ok: true, value: patch };
    },
    remove: async () => ({ ok: true, value: {} }),
    restoreRecord: async () => ({ ok: true, value: {} }),
  }),
}));

const { GeneticsPanel } =
  await import("../app/(admin)/admin/cattle/[id]/_components/genetics-panel.js");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;

/** `testedOn` is deliberately untyped: the point is what arrives, not what should. */
function profile(testedOn: unknown): CattleProfile {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FC1" as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    animalId: ANIMAL,
    breedComposition: [],
    registrations: [],
    geneticTests: [{ defect: "TH", status: "free", testedOn, lab: "Neogen" }],
  } as unknown as CattleProfile;
}

function view(record: CattleProfile | undefined) {
  return render(
    <ToastProvider>
      <GeneticsPanel
        profile={record}
        animalId={ANIMAL}
        profiles={record === undefined ? [] : [record]}
        outsiders={[]}
        propertyId={PROPERTY}
        actorId={ACTOR}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  saved.writes = [];
});

describe("the genetics panel", () => {
  it("shows a card the device wrote itself", () => {
    view(profile(new Date("2026-05-01T00:00:00.000Z")));

    expect(screen.getByText(/tested .* · Neogen/)).toBeTruthy();
  });

  it("shows one that came back from the server as a string", () => {
    // This threw where it stood: `testedOn.toLocaleDateString is not a
    // function`, mid-render, which unmounts the app rather than the row.
    view(profile("2026-05-01T00:00:00.000Z"));

    expect(screen.getByText(/tested .* · Neogen/)).toBeTruthy();
  });

  it("still shows the card when the date cannot be read at all", () => {
    // The lab and the status are the result. A date nobody can parse is worth
    // less than the panel staying up.
    view(profile("whenever"));

    // The lab still reads, and no date is claimed beside it.
    expect(screen.getAllByText(/Neogen/).length).toBeGreaterThan(1);
    expect(document.body.textContent).not.toContain("· tested");
  });

  it("records a result against an animal with no profile yet", async () => {
    const user = userEvent.setup();
    view(undefined);

    const [first] = screen.getAllByRole("combobox");
    await user.selectOptions(first as HTMLElement, "carrier");

    const written = saved.writes[0]?.["geneticTests"] as { status: string; testedOn: Date }[];
    expect(written?.[0]?.status).toBe("carrier");
    expect(written?.[0]?.testedOn).toBeInstanceOf(Date);
  });
});
