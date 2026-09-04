import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the pairing screen can tell somebody about why it is asking (spec §4.4).
 *
 * The form renders only when the server found no device token. Reaching it is
 * therefore already "this screen has no credential" — but *why* is the whole
 * question, and the browser holds the one clue the server cannot see. The
 * `deviceId` written into `localStorage` at pairing survives anything short of
 * a full storage wipe, so finding it beside a missing cookie means cookies
 * specifically were cleared, which is not something this app ever does.
 *
 * That is a hint, not a verdict, and these assertions hold it to being one: it
 * appears when there is a reason to show it, stays away when there is not, and
 * a browser that refuses to answer at all is not treated as having answered.
 */

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/app/(kiosk)/kiosk/pair/_actions", () => ({ redeemPairingCode: vi.fn() }));

const { DEVICE_ID_STORAGE_KEY } = await import("../lib/local/device-id.js");
const { PairForm } = await import("../app/(kiosk)/kiosk/pair/pair-form.js");

const CLEARED_COOKIES = /cleared this browser.s cookies/i;

beforeEach(() => {
  globalThis.localStorage?.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pairing screen's account of why it is asking", () => {
  it("says nothing extra to a screen that has never been paired", async () => {
    render(<PairForm />);

    // Nothing was cleared — this is a new tablet, and inventing a cause for it
    // would be worse than silence.
    expect(await screen.findByRole("button", { name: /pair this screen/i })).toBeInTheDocument();
    expect(screen.queryByText(CLEARED_COOKIES)).not.toBeInTheDocument();
  });

  it("names cookie clearing when everything but the credential survived", async () => {
    // Written beside the token at pairing, and never removed by the app.
    globalThis.localStorage.setItem(DEVICE_ID_STORAGE_KEY, "01ARZ3NDEKTSV4RRFFQ69G5FP1");

    render(<PairForm />);

    // The one thing the server cannot see, said where somebody is standing.
    expect(await screen.findByText(CLEARED_COOKIES)).toBeInTheDocument();
  });

  it("claims nothing when the browser refuses to answer", async () => {
    // A browser set to block site data throws on access rather than returning
    // null. Not knowing is not the same as knowing there was nothing.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("The operation is insecure.");
    });

    render(<PairForm />);

    expect(await screen.findByRole("button", { name: /pair this screen/i })).toBeInTheDocument();
    expect(screen.queryByText(CLEARED_COOKIES)).not.toBeInTheDocument();
  });
});
