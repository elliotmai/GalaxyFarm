import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PhotoCapture } from "../src/photos/photo-capture.js";
import { PhotoGrid, type PhotoTile } from "../src/photos/photo-grid.js";

/**
 * The two controls the photo pipeline shows a person (spec §4.2, §8).
 *
 * What is worth testing here is not that a grid renders. It is the parts a
 * barn depends on: that the camera is one tap away, that a photograph which has
 * not uploaded yet says so *and still shows*, and that the same file can be
 * picked twice — which is the bug a phone naming every shot `image.jpg`
 * produces and which nobody would report as anything but "it did nothing".
 */

const tile = (overrides: Partial<PhotoTile> = {}): PhotoTile => ({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
  filename: "calf.jpg",
  src: "blob:local",
  pending: false,
  ...overrides,
});

function pick(input: HTMLElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const photo = () => new File([new Uint8Array([1])], "IMG_0421.jpg", { type: "image/jpeg" });

describe("PhotoCapture", () => {
  it("is a real file input, so one tap opens the picker", () => {
    // A button that clicks a hidden input synthetically is blocked by every
    // browser outside a genuine gesture, and "the camera did not open" is not
    // something anybody reports as a bug.
    render(<PhotoCapture onPick={() => {}} />);

    expect(screen.getByLabelText("Add a photo")).toHaveAttribute("type", "file");
  });

  it("asks for the camera when it is beside the animal", () => {
    render(<PhotoCapture onPick={() => {}} camera label="Photo" />);

    expect(screen.getByLabelText("Photo")).toHaveAttribute("capture", "environment");
  });

  it("offers the camera roll when it is not", () => {
    render(<PhotoCapture onPick={() => {}} />);

    expect(screen.getByLabelText("Add a photo")).not.toHaveAttribute("capture");
  });

  it("takes photographs and nothing else", () => {
    render(<PhotoCapture onPick={() => {}} />);

    expect(screen.getByLabelText("Add a photo")).toHaveAttribute("accept", "image/*");
  });

  it("hands over what was picked", () => {
    const picked = vi.fn();
    render(<PhotoCapture onPick={picked} />);

    pick(screen.getByLabelText("Add a photo"), [photo()]);

    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("accepts the same filename twice in a row", () => {
    // A phone calls every shot `image.jpg`. Without clearing the input, the
    // second one fires no change event at all.
    const picked = vi.fn();
    render(<PhotoCapture onPick={picked} />);
    const input = screen.getByLabelText("Add a photo") as HTMLInputElement;

    pick(input, [photo()]);
    expect(input.value).toBe("");

    pick(input, [photo()]);
    expect(picked).toHaveBeenCalledTimes(2);
  });

  it("says nothing happened when nothing was picked", () => {
    const picked = vi.fn();
    render(<PhotoCapture onPick={picked} />);

    pick(screen.getByLabelText("Add a photo"), []);

    expect(picked).not.toHaveBeenCalled();
  });

  it("says so while a photo is being shrunk and queued", () => {
    render(<PhotoCapture onPick={() => {}} busy />);

    expect(screen.getByText("Adding…")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a photo")).toBeDisabled();
  });
});

describe("PhotoGrid", () => {
  it("shows the empty state rather than an empty grid", () => {
    render(<PhotoGrid photos={[]} empty={<p>No photos of Dolly yet</p>} />);

    expect(screen.getByText("No photos of Dolly yet")).toBeInTheDocument();
  });

  it("describes a photo by its caption where there is one", () => {
    render(<PhotoGrid photos={[tile({ caption: "Scar on the near hip" })]} />);

    expect(screen.getByAltText("Scar on the near hip")).toBeInTheDocument();
  });

  it("falls back to the filename, so no photo is unlabelled", () => {
    render(<PhotoGrid photos={[tile()]} />);

    expect(screen.getByAltText("calf.jpg")).toBeInTheDocument();
  });

  it("still shows a photograph that has not uploaded yet", () => {
    // Read back out of the upload queue. A grey box where the calf should be
    // is a much worse answer than "it is here, it just has not gone".
    render(<PhotoGrid photos={[tile({ pending: true, src: "blob:local" })]} />);

    expect(screen.getByAltText("calf.jpg")).toBeInTheDocument();
    expect(screen.getByText("On this device")).toBeInTheDocument();
  });

  it("says plainly when one has been set aside", () => {
    render(<PhotoGrid photos={[tile({ pending: true, stuck: true })]} />);

    expect(screen.getByText("Not sent")).toBeInTheDocument();
  });

  it("waits visibly when there is nothing to draw yet", () => {
    render(<PhotoGrid photos={[tile({ pending: true, src: undefined })]} />);

    expect(screen.getByText("Waiting for signal")).toBeInTheDocument();
  });

  it("distinguishes a photo still resolving its URL from one still queued", () => {
    render(<PhotoGrid photos={[tile({ pending: false, src: undefined })]} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("offers no delete where the screen did not pass one", () => {
    // §4.5 clause 3 lives at the call site: a grid that always showed Delete
    // would be a grid that deletes without a dialog on some surface.
    render(<PhotoGrid photos={[tile()]} />);

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("hands the delete back to the screen that has the dialog", async () => {
    const asked = vi.fn();
    render(<PhotoGrid photos={[tile()]} onDelete={asked} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ id: tile().id }));
  });

  it("offers a caption, which is the edit half of the photo's CRUD", async () => {
    const asked = vi.fn();
    render(<PhotoGrid photos={[tile()]} onCaption={asked} />);

    await userEvent.click(screen.getByRole("button", { name: "Caption" }));

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("locks the tile that has an action in flight", () => {
    render(<PhotoGrid photos={[tile()]} onDelete={() => {}} busyId={tile().id} />);

    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("draws one tile per photograph", () => {
    render(
      <PhotoGrid
        photos={[tile(), tile({ id: "01ARZ3NDEKTSV4RRFFQ69G5FB2", filename: "dam.jpg" })]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
