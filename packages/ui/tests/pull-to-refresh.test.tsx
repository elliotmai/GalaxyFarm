import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PULL_THRESHOLD, PullToRefresh } from "../src/primitives/pull-to-refresh.js";

/**
 * Pull down to refresh (spec §8, §4.2).
 *
 * The gesture matters more here than in most apps because every read comes
 * from the device's own store — the screen is always instant and therefore
 * always, silently, possibly a few minutes stale.
 *
 * What these guard is the two ways a pull-to-refresh goes wrong: firing when
 * somebody was only scrolling, and not firing when they meant it. Both are
 * about the threshold and where the gesture is allowed to start.
 */

function touch(clientY: number) {
  return { touches: [{ clientY }] };
}

/** A pull is resisted, so the finger has to travel further than the threshold. */
const FAR = 400;

describe("PullToRefresh", () => {
  it("refreshes when pulled past the threshold from the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>Herd</p>
      </PullToRefresh>,
    );

    const region = screen.getByText("Herd").parentElement as HTMLElement;
    fireEvent.touchStart(region, touch(0));
    fireEvent.touchMove(region, touch(FAR));
    fireEvent.touchEnd(region);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  });

  it("does nothing for a short tug", async () => {
    // Otherwise every scroll that starts at the top of the page fires a sync.
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>Herd</p>
      </PullToRefresh>,
    );

    const region = screen.getByText("Herd").parentElement as HTMLElement;
    fireEvent.touchStart(region, touch(0));
    fireEvent.touchMove(region, touch(4));
    fireEvent.touchEnd(region);

    await waitFor(() => expect(onRefresh).not.toHaveBeenCalled());
  });

  it("ignores a pull that starts partway down the page", async () => {
    // Starting a downward drag halfway through the herd is somebody scrolling
    // up. Hijacking it would make a long list unusable.
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(500);

    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>Herd</p>
      </PullToRefresh>,
    );

    const region = screen.getByText("Herd").parentElement as HTMLElement;
    fireEvent.touchStart(region, touch(0));
    fireEvent.touchMove(region, touch(FAR));
    fireEvent.touchEnd(region);

    await waitFor(() => expect(onRefresh).not.toHaveBeenCalled());
    vi.restoreAllMocks();
  });

  it("abandons the pull if the finger goes back up past where it started", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>Herd</p>
      </PullToRefresh>,
    );

    const region = screen.getByText("Herd").parentElement as HTMLElement;
    fireEvent.touchStart(region, touch(100));
    fireEvent.touchMove(region, touch(500));
    fireEvent.touchMove(region, touch(20));
    fireEvent.touchEnd(region);

    await waitFor(() => expect(onRefresh).not.toHaveBeenCalled());
  });

  it("says what will happen once the pull is far enough", async () => {
    render(
      <PullToRefresh onRefresh={() => Promise.resolve()}>
        <p>Herd</p>
      </PullToRefresh>,
    );

    const region = screen.getByText("Herd").parentElement as HTMLElement;
    fireEvent.touchStart(region, touch(0));
    fireEvent.touchMove(region, touch(4));
    expect(screen.getByText("Pull to refresh")).toBeInTheDocument();

    fireEvent.touchMove(region, touch(FAR));
    expect(screen.getByText("Release to refresh")).toBeInTheDocument();
  });

  it("keeps rendering its children throughout", async () => {
    // The content is never replaced by a spinner. On a local-first app the
    // rows on screen are correct whether or not a sync is running.
    render(
      <PullToRefresh onRefresh={() => Promise.resolve()}>
        <p>Herd</p>
      </PullToRefresh>,
    );

    const region = screen.getByText("Herd").parentElement as HTMLElement;
    fireEvent.touchStart(region, touch(0));
    fireEvent.touchMove(region, touch(FAR));

    expect(screen.getByText("Herd")).toBeInTheDocument();
  });

  it("exports the threshold rather than hiding it", () => {
    // A screen that wants to explain the gesture should not have to guess it.
    expect(PULL_THRESHOLD).toBeGreaterThan(0);
  });
});
