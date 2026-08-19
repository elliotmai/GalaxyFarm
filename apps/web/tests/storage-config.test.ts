import { describe, expect, it } from "vitest";

import { fileStorage, storageConfig } from "../lib/storage.js";

/**
 * Storage's corner of the composition root (spec §4.1).
 *
 * Thin on purpose — the resolving lives in the adapter and is tested there.
 * What is worth pinning here is that this file, and only this file, reads the
 * environment, and that an unset bucket degrades to a sentence rather than to
 * a throw: photographs are already safe on the device, and taking a screen
 * down over a variable nobody has set yet would be the wrong trade.
 */

const complete = {
  R2_ACCOUNT_ID: "acc",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "galaxy-farm",
};

describe("storageConfig", () => {
  it("reads whatever environment it is handed", () => {
    expect(storageConfig(complete).ok).toBe(true);
  });

  it("says what is unset rather than throwing", () => {
    const config = storageConfig({});

    expect(config.ok).toBe(false);
    expect(config.ok || config.reason).toContain("R2_ACCOUNT_ID");
  });
});

describe("fileStorage", () => {
  it("builds the R2 adapter, and names nothing else", () => {
    expect(fileStorage(complete)?.name).toBe("cloudflare-r2");
  });

  it("is undefined when there is nowhere to put anything", () => {
    expect(fileStorage({})).toBeUndefined();
  });

  it("defaults to the process environment", () => {
    // The point of the default: every caller asks for a `FileStorage` and no
    // caller reads `R2_*`.
    expect(() => fileStorage()).not.toThrow();
  });
});
