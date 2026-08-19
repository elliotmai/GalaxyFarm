import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Attachment, Ulid } from "@galaxy-farm/core";

/**
 * Deleting a photograph (spec §4.5 clauses 3 and 4).
 *
 * The repository's own note about the guards is that they are convention
 * checks over source text, and no substitute for a component test asserting
 * that a *specific* dialog naming the *right* record appears. This is that
 * test: §4.5's table puts a photo at Standard tier, which is a dialog naming
 * it and an undo toast afterwards, and both are asserted here rather than
 * inferred from an import.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const PHOTO = "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid;

const written = vi.hoisted(() => ({
  removed: [] as string[],
  restored: [] as string[],
  updated: [] as { id: string; patch: Record<string, unknown> }[],
  attached: [] as File[][],
  pending: { current: false },
}));

vi.mock("@/lib/photos/use-photos", () => ({
  usePhotos: () => ({
    photos: [
      {
        attachment: {
          id: PHOTO,
          propertyId: PROPERTY,
          createdAt: new Date("2026-06-01"),
          updatedAt: new Date("2026-06-01"),
          ownerEntity: "Animal",
          ownerId: ANIMAL,
          key: `${PROPERTY}/Animal/${ANIMAL}/${PHOTO}.jpg`,
          filename: "IMG_0421.jpg",
          contentType: "image/jpeg",
          bytes: 240_000,
          uploaded: !written.pending.current,
        } as Attachment,
        src: "blob:local",
        pending: written.pending.current,
        stuck: false,
      },
    ],
    loading: false,
    busy: false,
    problem: undefined,
    attach: async (files: readonly File[]) => {
      written.attached.push([...files]);
    },
    clearProblem: () => {},
    mutations: {
      create: async (input: unknown) => ({ ok: true, value: input }),
      update: async (id: string, patch: Record<string, unknown>) => {
        written.updated.push({ id, patch });
        return { ok: true, value: patch };
      },
      remove: async (id: string) => {
        written.removed.push(id);
        return { ok: true, value: {} };
      },
      restoreRecord: async (id: string) => {
        written.restored.push(id);
        return { ok: true, value: {} };
      },
    },
  }),
}));

const { ToastProvider, ConfirmProvider } = await import("@galaxy-farm/ui");
const { PhotoPanel } = await import("../app/_components/photo-panel.js");

function panel() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <PhotoPanel
          propertyId={PROPERTY}
          actorId={ACTOR}
          ownerEntity="Animal"
          ownerId={ANIMAL}
          recordName="Dolly"
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  written.removed = [];
  written.restored = [];
  written.updated = [];
  written.attached = [];
  written.pending.current = false;
});

describe("the panel itself", () => {
  it("shows the record's photographs", () => {
    panel();

    expect(screen.getByAltText("IMG_0421.jpg")).toBeInTheDocument();
  });

  it("offers somewhere to add one", async () => {
    panel();

    expect(screen.getByLabelText("Add photos")).toHaveAttribute("type", "file");
  });
});

describe("deleting one", () => {
  it("asks first, and names the photograph rather than saying 'are you sure'", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("IMG_0421.jpg");
    expect(written.removed).toEqual([]);
  });

  it("says where it goes, because that is what makes the dialog honest", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Trash");
  });

  it("says that one still uploading will finish, so the restore is real", async () => {
    written.pending.current = true;
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("still finish uploading");
  });

  it("deletes nothing when the dialog is dismissed", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(written.removed).toEqual([]);
  });

  it("writes a tombstone once it is confirmed", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Delete/ }));

    await waitFor(() => expect(written.removed).toEqual([PHOTO]));
  });

  it("offers the undo that makes the confirmation honest", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Delete/ }));

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));

    expect(written.restored).toEqual([PHOTO]);
  });
});

describe("captioning one", () => {
  it("saves what was typed", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Caption" }));
    await userEvent.type(await screen.findByLabelText("Caption"), "Scar on the near hip");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(written.updated).toEqual([{ id: PHOTO, patch: { caption: "Scar on the near hip" } }]),
    );
  });

  it("clears the caption when the box is emptied", async () => {
    panel();

    await userEvent.click(screen.getByRole("button", { name: "Caption" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Strictly: the patch has to *name* the field as undefined. An empty
    // patch clears nothing, and the caption would stay on screen.
    await waitFor(() => expect(written.updated).toHaveLength(1));
    expect(written.updated[0]?.patch).toStrictEqual({ caption: undefined });
  });
});
