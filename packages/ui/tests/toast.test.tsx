import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ACTIONABLE_TOAST_MS,
  DEFAULT_TOAST_MS,
  ToastProvider,
  useToast,
  type ToastOptions,
} from "../src/primitives/toast.js";

/**
 * The undo toast, which is half of §4.5 clause 3.
 *
 * A Standard-tier delete is a dialog plus an undo, and an undo the user never
 * manages to reach is not an undo. So the timing is asserted rather than
 * eyeballed: an actionable toast waits twice as long as an informational one,
 * and reaching for it with a mouse stops the clock.
 */

/** A controllable clock, so the tests assert timing instead of waiting it out. */
function fakeTimers() {
  const scheduled = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;

  return {
    setTimer: (fn: () => void, ms: number) => {
      const handle = next++;
      scheduled.set(handle, { fn, ms });
      return handle;
    },
    clearTimer: (handle: number) => {
      scheduled.delete(handle);
    },
    /** Fire everything due within `ms`. Wrapped in act — these fire state updates. */
    advance(ms: number) {
      act(() => {
        for (const [handle, timer] of [...scheduled]) {
          if (timer.ms <= ms) {
            scheduled.delete(handle);
            timer.fn();
          }
        }
      });
    },
    pending: () => [...scheduled.values()],
  };
}

function Harness({ toast }: { toast: ToastOptions }) {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show(toast)}>
      trigger
    </button>
  );
}

async function raise(toast: ToastOptions, timers = fakeTimers()) {
  const view = render(
    <ToastProvider setTimer={timers.setTimer} clearTimer={timers.clearTimer}>
      <Harness toast={toast} />
    </ToastProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "trigger" }));
  return { ...timers, unmount: view.unmount };
}

describe("ToastProvider", () => {
  it("shows the message", async () => {
    await raise({ message: "Weight recorded" });

    expect(screen.getByText("Weight recorded")).toBeInTheDocument();
  });

  it("gives an actionable toast twice as long to be noticed", async () => {
    // An undo has to be seen, moved to, and pressed. Five seconds is enough
    // to read a confirmation and not enough to act on one.
    const informational = await raise({ message: "Saved" });
    expect(informational.pending()[0]?.ms).toBe(DEFAULT_TOAST_MS);
    informational.unmount();

    const actionable = await raise({
      message: "Animal deleted",
      action: { label: "Undo", onAct: () => {} },
    });
    expect(actionable.pending()[0]?.ms).toBe(ACTIONABLE_TOAST_MS);
    expect(ACTIONABLE_TOAST_MS).toBeGreaterThan(DEFAULT_TOAST_MS);
  });

  it("holds the clock while someone is reaching for Undo", async () => {
    // Watching the button you are moving towards disappear is the specific
    // failure this prevents.
    const timers = await raise({
      message: "Animal deleted",
      action: { label: "Undo", onAct: () => {} },
    });

    await userEvent.hover(screen.getByText("Animal deleted"));

    expect(timers.pending()).toHaveLength(0);
    timers.advance(60_000);
    expect(screen.getByText("Animal deleted")).toBeInTheDocument();
  });

  it("runs the action and closes when Undo is pressed", async () => {
    const onAct = vi.fn();
    await raise({ message: "Animal deleted", action: { label: "Undo", onAct } });

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onAct).toHaveBeenCalledOnce();
    expect(screen.queryByText("Animal deleted")).not.toBeInTheDocument();
  });

  it("goes away on its own when nothing happens", async () => {
    const timers = await raise({ message: "Saved" });

    timers.advance(DEFAULT_TOAST_MS);

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("can be dismissed by hand", async () => {
    await raise({ message: "Saved" });

    await userEvent.click(screen.getByRole("button", { name: "Dismiss: Saved" }));

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("announces a failure as an alert and a confirmation as a status", async () => {
    // A confirmation that interrupts is worse than one that waits; a failure
    // that waits may never be heard at all.
    const failure = await raise({ message: "Sync failed", tone: "danger" });
    expect(screen.getByRole("alert")).toHaveTextContent("Sync failed");
    failure.unmount();

    await raise({ message: "Saved" });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("stacks rather than replacing, so a fast logger loses nothing", async () => {
    const timers = fakeTimers();
    render(
      <ToastProvider setTimer={timers.setTimer} clearTimer={timers.clearTimer}>
        <Harness toast={{ message: "Weight recorded" }} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "trigger" }));
    await userEvent.click(screen.getByRole("button", { name: "trigger" }));

    expect(screen.getAllByText("Weight recorded")).toHaveLength(2);
  });

  it("refuses to be used outside a provider, rather than silently doing nothing", () => {
    // A delete whose undo toast never appears looks exactly like a delete
    // that worked.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness toast={{ message: "orphan" }} />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });
});
