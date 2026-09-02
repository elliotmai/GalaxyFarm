import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A barn screen getting its own session back (spec §4.4).
 *
 * The behaviour under test is the one nobody is present for. A wall-mounted
 * tablet whose session lapsed used to land on `/login` — a form with no
 * keyboard, no account, and no way forward except somebody walking out with a
 * fresh pairing code. It now lands here and signs itself back in with the
 * device token it kept.
 *
 * So the first assertion is that *nothing is tapped*: the screen resumes on
 * its own. The rest are about the three ways that can fail, which need
 * opposite responses — one is permanent and asks for a code, one is the barn's
 * ordinary weather and should keep retrying, and one is a loop that has to
 * stop.
 */

const action = vi.hoisted(() => ({
  calls: 0,
  result: { ok: true } as { ok: true } | { ok: false; why: string },
}));

vi.mock("@/app/(kiosk)/kiosk/pair/_actions", () => ({
  resumeKioskSession: () => {
    action.calls += 1;
    return Promise.resolve(action.result);
  },
}));

// The real form pulls in `next-auth/react`, which has no business booting for
// a test about what happens before anybody types anything.
vi.mock("@/app/(kiosk)/kiosk/pair/pair-form", () => ({
  PairForm: () => <div>Enter the pairing code</div>,
}));

const { ResumeScreen } = await import("../app/(kiosk)/kiosk/pair/resume-screen.js");

const assign = vi.fn();

beforeEach(() => {
  action.calls = 0;
  action.result = { ok: true };
  assign.mockClear();

  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign, href: "http://localhost/kiosk/pair" },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resuming a paired screen", () => {
  it("signs itself back in and returns to the board, with nobody touching it", async () => {
    render(<ResumeScreen next="/kiosk/chores" />);

    // No button, no code, no trip to the barn — this is the entire point.
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/kiosk/chores"));
    expect(action.calls).toBe(1);
  });

  it("says what it is doing while it does it", () => {
    render(<ResumeScreen next="/kiosk" />);

    // Somebody who does walk up mid-reconnect should not read it as broken.
    expect(screen.getByText("Reconnecting this screen")).toBeInTheDocument();
  });

  it("asks for a code once the device has actually been unpaired", async () => {
    action.result = { ok: false, why: "unpaired" };
    render(<ResumeScreen next="/kiosk" />);

    expect(await screen.findByText("This screen was unpaired")).toBeInTheDocument();
    // Revoked from Settings: no amount of retrying brings it back, so the one
    // thing that does is put in front of whoever is standing there.
    expect(screen.getByText("Enter the pairing code")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops, rather than spinning, when a session will not stick", async () => {
    action.result = { ok: false, why: "looping" };
    render(<ResumeScreen next="/kiosk" />);

    expect(await screen.findByText("Pair this screen again")).toBeInTheDocument();
    expect(screen.getByText("Enter the pairing code")).toBeInTheDocument();
  });

  it("keeps a screen that only lost signal, and carries on trying", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    action.result = { ok: false, why: "unreachable" };
    render(<ResumeScreen next="/kiosk" />);

    // Not "unpaired": the token is fine and Neon is not answering, and a
    // screen that asked for a code here would send somebody to the barn over
    // a wifi hiccup.
    expect(await screen.findByText("Waiting for signal")).toBeInTheDocument();
    expect(screen.queryByText("Enter the pairing code")).not.toBeInTheDocument();

    const before = action.calls;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(action.calls).toBeGreaterThan(before);
  });

  it("goes back to the board once signal returns", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    action.result = { ok: false, why: "unreachable" };
    render(<ResumeScreen next="/kiosk/pen-board" />);

    await screen.findByText("Waiting for signal");

    action.result = { ok: true };
    await vi.advanceTimersByTimeAsync(30_000);

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/kiosk/pen-board"));
  });
});
