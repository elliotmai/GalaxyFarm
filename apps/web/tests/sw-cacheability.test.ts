import { describe, expect, it } from "vitest";

import { mayCacheDocument } from "../lib/sw-contract.js";

/**
 * What the app-shell cache is allowed to hold (spec §3, §4.4).
 *
 * The bug this rule exists for is a kiosk that appears to sign itself out. The
 * app-shell cache answers a navigation whenever the network does not inside
 * four seconds — which on a barn's wifi, or on a page that waits up to eight
 * seconds for a Neon cold start, is an ordinary morning. If the entry stored
 * under a board's URL is the *reply to a sign-in redirect*, that is what the
 * screen renders, on a device whose session is perfectly fine. It never ages
 * out either: the cache measures age from last use, so serving it keeps it
 * fresh forever.
 *
 * The rule is therefore that only a plain page may be stored, and only under
 * the URL it was asked for.
 */

const response = (over: Partial<Response>): Response => ({ status: 200, ...over }) as Response;

describe("what may be written to the app-shell cache", () => {
  it("stores a page that came from the URL it was asked for", () => {
    expect(mayCacheDocument(response({ status: 200, redirected: false, type: "basic" }))).toBe(
      true,
    );
  });

  it("refuses an opaque redirect", () => {
    // A navigation is fetched with `redirect: "manual"`, so this is the shape
    // the middleware's bounce to `/kiosk/pair` or `/login` actually arrives in.
    expect(mayCacheDocument(response({ status: 0, type: "opaqueredirect" }))).toBe(false);
  });

  it("refuses a response that followed a redirect", () => {
    // Caching this would file the sign-in page under the board's own URL.
    expect(mayCacheDocument(response({ status: 200, redirected: true, type: "basic" }))).toBe(
      false,
    );
  });

  it("refuses anything that is not a 200", () => {
    for (const status of [0, 204, 302, 401, 404, 500, 503]) {
      expect(mayCacheDocument(response({ status })), `status ${status}`).toBe(false);
    }
  });
});
