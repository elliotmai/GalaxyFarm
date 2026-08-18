// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKIP_WAITING } from "../lib/sw-contract.js";
import {
  IDLE_BEFORE_APPLY_MS,
  UPDATE_POLL_MS,
  applyUpdate,
  applyWhenIdle,
  shouldReloadOnControllerChange,
  watchForUpdates,
  type UpdatableRegistration,
  type UpdatableWorker,
} from "../lib/sw-update.js";

/**
 * Getting a screen off a stale build (issue #11, spec §4.2).
 *
 * The interesting cases here are all the ones that only happen on a device
 * nobody is standing at: a build that installed while the tab was closed, a
 * poll that fails because the barn has no signal, a first install that must not
 * be mistaken for an update. None of them can be found by opening the app and
 * looking at it, which is exactly why they are worth testing.
 */

class FakeWorker implements UpdatableWorker {
  state = "installing";
  readonly messages: unknown[] = [];
  private listeners: Array<() => void> = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  addEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: "statechange", listener: () => void): void {
    this.listeners = this.listeners.filter((each) => each !== listener);
  }

  /** What the browser does when the worker moves on: set the state, then tell. */
  moveTo(state: string): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

class FakeRegistration implements UpdatableRegistration {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updates = 0;
  offline = false;
  private listeners: Array<() => void> = [];

  update(): Promise<unknown> {
    this.updates += 1;
    return this.offline ? Promise.reject(new Error("no signal")) : Promise.resolve();
  }

  addEventListener(_type: "updatefound", listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: "updatefound", listener: () => void): void {
    this.listeners = this.listeners.filter((each) => each !== listener);
  }

  /** A new build has started installing. */
  beginInstalling(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    this.fireUpdateFound();
    return worker;
  }

  /** The event on its own, with whatever `installing` currently holds. */
  fireUpdateFound(): void {
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

describe("watchForUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces a build that finishes installing under an existing worker", () => {
    const registration = new FakeRegistration();
    const onUpdateReady = vi.fn();
    watchForUpdates({ registration, onUpdateReady, isControlled: () => true });

    const worker = registration.beginInstalling();
    expect(onUpdateReady).not.toHaveBeenCalled();

    worker.moveTo("installed");
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it("says nothing about the first worker this device has ever had", () => {
    // The case that would otherwise offer somebody a reload on their first
    // visit — and, on a kiosk, reload a screen that had only just opened.
    const registration = new FakeRegistration();
    const onUpdateReady = vi.fn();
    watchForUpdates({ registration, onUpdateReady, isControlled: () => false });

    registration.beginInstalling().moveTo("installed");

    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it("announces a build that was already waiting before anybody looked", () => {
    // Installed while the tab was closed. There is no event left to hear, so
    // the state has to be read on the spot.
    const registration = new FakeRegistration();
    const waiting = new FakeWorker();
    waiting.state = "installed";
    registration.waiting = waiting;

    const onUpdateReady = vi.fn();
    watchForUpdates({ registration, onUpdateReady, isControlled: () => true });

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it("announces once, however many times the browser says so", () => {
    // `updatefound`, then `statechange`, then a redundant reading of `waiting`
    // all describe the same build. Three offers to reload for one deploy is a
    // banner people learn to ignore.
    const registration = new FakeRegistration();
    const onUpdateReady = vi.fn();
    watchForUpdates({ registration, onUpdateReady, isControlled: () => true });

    const worker = registration.beginInstalling();
    worker.moveTo("installed");
    worker.moveTo("installed");
    registration.waiting = worker;
    registration.beginInstalling();

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it("shrugs off an updatefound with nothing installing behind it", () => {
    // The browser fires the event and `installing` can already be null by the
    // time the listener runs — the worker was discarded as redundant in the
    // same task. Reading `.addEventListener` off it would throw inside an
    // event handler, where nothing would report it.
    const registration = new FakeRegistration();
    const onUpdateReady = vi.fn();
    watchForUpdates({ registration, onUpdateReady, isControlled: () => true });

    expect(() => registration.fireUpdateFound()).not.toThrow();
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it("ignores a worker that installs and is discarded rather than waiting", () => {
    const registration = new FakeRegistration();
    const onUpdateReady = vi.fn();
    watchForUpdates({ registration, onUpdateReady, isControlled: () => true });

    registration.beginInstalling().moveTo("redundant");

    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it("asks for itself on a timer, because a barn screen never navigates", () => {
    const registration = new FakeRegistration();
    watchForUpdates({ registration, onUpdateReady: vi.fn(), isControlled: () => true });

    expect(registration.updates).toBe(0);
    vi.advanceTimersByTime(UPDATE_POLL_MS * 3);
    expect(registration.updates).toBe(3);
  });

  it("treats a check with no signal as a non-event", () => {
    // The rejection has to be swallowed, not merely unobserved: an unhandled
    // rejection every fifteen minutes is a screen that logs an error all night
    // for being in the state it is designed for. Vitest fails this test if one
    // escapes.
    const registration = new FakeRegistration();
    registration.offline = true;
    watchForUpdates({ registration, onUpdateReady: vi.fn(), isControlled: () => true });

    expect(() => vi.advanceTimersByTime(UPDATE_POLL_MS)).not.toThrow();
    expect(registration.updates).toBe(1);
  });

  it("checks again the moment the device is back in signal", () => {
    const registration = new FakeRegistration();
    watchForUpdates({ registration, onUpdateReady: vi.fn(), isControlled: () => true });

    window.dispatchEvent(new Event("online"));

    expect(registration.updates).toBe(1);
  });

  it("lets go of everything it took hold of", () => {
    const registration = new FakeRegistration();
    const stop = watchForUpdates({
      registration,
      onUpdateReady: vi.fn(),
      isControlled: () => true,
    });
    const worker = registration.beginInstalling();
    expect(registration.listenerCount).toBe(1);
    expect(worker.listenerCount).toBe(1);

    stop();

    expect(registration.listenerCount).toBe(0);
    expect(worker.listenerCount).toBe(0);

    vi.advanceTimersByTime(UPDATE_POLL_MS * 2);
    window.dispatchEvent(new Event("online"));
    expect(registration.updates).toBe(0);
  });
});

describe("applyUpdate", () => {
  it("asks the waiting worker to take over", () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker();
    registration.waiting = waiting;

    expect(applyUpdate(registration)).toBe(true);
    expect(waiting.messages).toEqual([{ type: SKIP_WAITING }]);
  });

  it("says so when there is nothing waiting", () => {
    // Another tab can apply the same update first, leaving this page holding a
    // registration with nothing left to talk to.
    expect(applyUpdate(new FakeRegistration())).toBe(false);
  });
});

describe("applyWhenIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies once the screen has been left alone", () => {
    const apply = vi.fn();
    applyWhenIdle(apply);

    vi.advanceTimersByTime(IDLE_BEFORE_APPLY_MS - 1);
    expect(apply).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("starts the wait over every time somebody touches the screen", () => {
    // The behaviour that keeps a kiosk from reloading under a gloved hand
    // halfway through logging eggs.
    const apply = vi.fn();
    applyWhenIdle(apply);

    for (let taps = 0; taps < 5; taps += 1) {
      vi.advanceTimersByTime(IDLE_BEFORE_APPLY_MS - 1_000);
      document.dispatchEvent(new Event("pointerdown"));
    }

    expect(apply).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDLE_BEFORE_APPLY_MS);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("watches a target it is handed, and stops when told to", () => {
    const target = document.createElement("div");
    const apply = vi.fn();
    const stop = applyWhenIdle(apply, { idleMs: 500, target });

    vi.advanceTimersByTime(400);
    target.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(400);
    expect(apply).not.toHaveBeenCalled();

    stop();
    vi.advanceTimersByTime(10_000);
    expect(apply).not.toHaveBeenCalled();
  });

  it("survives having nowhere to listen", () => {
    // Server-rendered, or any context with no document. The update still
    // applies on the timer; there is simply nothing that could defer it.
    const apply = vi.fn();
    applyWhenIdle(apply, { idleMs: 100, target: undefined });

    vi.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe("shouldReloadOnControllerChange", () => {
  it("reloads when a new build replaces the one that was in charge", () => {
    expect(shouldReloadOnControllerChange(true, false)).toBe(true);
  });

  it("does not reload the visit that installed the first worker", () => {
    // `clientsClaim` fires `controllerchange` on a first install too. Reloading
    // there would reload every first visit the app ever gets.
    expect(shouldReloadOnControllerChange(false, false)).toBe(false);
  });

  it("does not start a second reload on top of one already running", () => {
    expect(shouldReloadOnControllerChange(true, true)).toBe(false);
  });
});
