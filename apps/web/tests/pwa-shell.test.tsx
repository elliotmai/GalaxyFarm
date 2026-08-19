import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PwaShell } from "../app/_components/pwa-shell.js";
import { INSTALL_DISMISSED_KEY } from "../lib/install-prompt.js";
import { SKIP_WAITING } from "../lib/sw-contract.js";
import { IDLE_BEFORE_APPLY_MS } from "../lib/sw-update.js";

/**
 * What the two kinds of screen do when a new build lands (issue #11).
 *
 * The pieces underneath are tested on their own in `sw-update.test.ts`; what is
 * asserted here is the decision this component makes with them, because it is
 * the one part of the update path a person actually meets. A kiosk must never
 * be *offered* a reload — there is nobody there to take it — and a phone must
 * never be reloaded without being asked.
 */

interface FakeWorker {
  state: string;
  readonly messages: unknown[];
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

function fakeWorker(state: string): FakeWorker {
  return {
    state,
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

/** A registration with a build already installed and waiting to take over. */
function serviceWorkerContainer(waiting: FakeWorker | null, controlled: boolean) {
  const registration = {
    installing: null,
    waiting,
    update: vi.fn(async () => undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const register = vi.fn(async () => registration);

  return {
    registration,
    register,
    container: {
      controller: controlled ? {} : null,
      register,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  };
}

function install(container: unknown): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: container,
    configurable: true,
    writable: true,
  });
}

/** Mount, and let the registration promise settle before asserting on it. */
async function mount(ui: React.ReactElement): Promise<void> {
  render(ui);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  // Cleared before rather than after: Testing Library unmounts in its own
  // `afterEach`, and a component whose teardown reaches for a
  // `navigator.serviceWorker` that has just been deleted throws on the way out.
  Reflect.deleteProperty(window.navigator, "serviceWorker");
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registering the worker", () => {
  it("takes the whole origin, and never answers the check from the HTTP cache", async () => {
    // Scope is what decides which paths the worker can serve at all — anything
    // narrower than the root and half the app is uncovered. And a screen that
    // asks every fifteen minutes whether there is a new build, and is handed
    // this morning's answer each time, has not asked at all.
    const { register, container } = serviceWorkerContainer(null, true);
    install(container);

    await mount(<PwaShell />);

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  it("renders nothing at all on a browser with no service workers", async () => {
    const { container } = render(<PwaShell />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
  });
});

describe("a screen somebody is holding", () => {
  it("offers the update rather than taking it", async () => {
    const waiting = fakeWorker("installed");
    const { container } = serviceWorkerContainer(waiting, true);
    install(container);

    await mount(<PwaShell />);

    expect(screen.getByText(/newer version of the app is ready/i)).toBeInTheDocument();
    expect(waiting.messages).toEqual([]);
  });

  it("applies it on the tap, and says nothing about the data", async () => {
    // Somebody being asked to reload wants to know what it costs them. The
    // answer is nothing: §4.2 has every write on the device already.
    const waiting = fakeWorker("installed");
    const { container } = serviceWorkerContainer(waiting, true);
    install(container);

    await mount(<PwaShell />);
    expect(screen.getByText(/on this device already/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(waiting.messages).toEqual([{ type: SKIP_WAITING }]);
  });

  it("says nothing when the worker it just registered is this device's first", async () => {
    // No controller means nothing was replaced. Offering a reload on a first
    // visit is asking somebody to fix a problem they do not have.
    const waiting = fakeWorker("installed");
    const { container } = serviceWorkerContainer(waiting, false);
    install(container);

    await mount(<PwaShell />);

    expect(screen.queryByText(/newer version/i)).not.toBeInTheDocument();
  });
});

describe("a screen nobody is holding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("never offers a reload to an empty barn", async () => {
    const waiting = fakeWorker("installed");
    const { container } = serviceWorkerContainer(waiting, true);
    install(container);

    await mount(<PwaShell unattended />);

    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
  });

  it("takes the update itself once the screen has gone quiet", async () => {
    // The acceptance criterion in as many words: a service worker update does
    // not strand a kiosk on a stale build.
    const waiting = fakeWorker("installed");
    const { container } = serviceWorkerContainer(waiting, true);
    install(container);

    await mount(<PwaShell unattended />);
    expect(waiting.messages).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(IDLE_BEFORE_APPLY_MS);
    });

    expect(waiting.messages).toEqual([{ type: SKIP_WAITING }]);
  });

  it("waits while somebody is using it", async () => {
    const waiting = fakeWorker("installed");
    const { container } = serviceWorkerContainer(waiting, true);
    install(container);

    await mount(<PwaShell unattended />);

    for (let taps = 0; taps < 4; taps += 1) {
      await act(async () => {
        vi.advanceTimersByTime(IDLE_BEFORE_APPLY_MS - 5_000);
        document.dispatchEvent(new Event("pointerdown"));
      });
    }

    expect(waiting.messages).toEqual([]);
  });
});

describe("offering to install the app", () => {
  /** What Chromium fires, as much of it as this component touches. */
  function promptable() {
    const prompt = vi.fn(async () => undefined);
    // Cancelable, as Chromium fires it — holding the prompt back is the whole
    // point of the event, and `preventDefault()` on an uncancelable one is a
    // no-op that would make the assertion below meaningless.
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    return { event, prompt };
  }

  it("shows nothing until the browser says an install is possible", async () => {
    const { container } = serviceWorkerContainer(null, true);
    install(container);

    await mount(<PwaShell />);

    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("holds the browser's prompt and raises it on a tap", async () => {
    const { container } = serviceWorkerContainer(null, true);
    install(container);
    const { event, prompt } = promptable();

    await mount(<PwaShell />);
    await act(async () => {
      window.dispatchEvent(event);
    });

    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("remembers a no, so it is not asked again tomorrow", async () => {
    const { container } = serviceWorkerContainer(null, true);
    install(container);

    await mount(<PwaShell />);
    await act(async () => {
      window.dispatchEvent(promptable().event);
    });

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).not.toBeNull();
  });

  it("stays quiet for a month after that no", async () => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
    const { container } = serviceWorkerContainer(null, true);
    install(container);

    await mount(<PwaShell />);
    await act(async () => {
      window.dispatchEvent(promptable().event);
    });

    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("does not ask a stranger reading the front page", async () => {
    // The public surface mounts the shell for the worker, not for this.
    const { container } = serviceWorkerContainer(null, true);
    install(container);

    await mount(<PwaShell offerInstall={false} />);
    await act(async () => {
      window.dispatchEvent(promptable().event);
    });

    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });
});
