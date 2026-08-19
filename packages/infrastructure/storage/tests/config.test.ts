import { describe, expect, it } from "vitest";

import { resolveStorageConfig, storageFrom } from "../src/config.js";

/**
 * Reading R2's credentials (spec §3, §9).
 *
 * The branch that matters is the unconfigured one. Photos are not load-bearing
 * — the app works, the queue holds — so an unset variable has to degrade to a
 * sentence somebody can act on rather than a 500 that reads as a broken upload
 * path. That is the whole reason this returns a reason instead of throwing.
 */

const complete = {
  R2_ACCOUNT_ID: "acc",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "galaxy-farm",
};

describe("resolveStorageConfig", () => {
  it("reads a complete configuration", () => {
    const config = resolveStorageConfig(complete);

    expect(config.ok).toBe(true);
    expect(config.ok && config.options.bucket).toBe("galaxy-farm");
  });

  it("leaves the endpoint unset, so R2's own is derived from the account", () => {
    const config = resolveStorageConfig(complete);

    expect(config.ok && "endpoint" in config.options).toBe(false);
  });

  it("takes an endpoint when one is given, which is how MinIO swaps in", () => {
    const config = resolveStorageConfig({ ...complete, R2_ENDPOINT: "http://nas.local:9000" });

    expect(config.ok && config.options.endpoint).toBe("http://nas.local:9000");
  });

  it("ignores an endpoint set to the empty string", () => {
    // `R2_ENDPOINT=""` in an env file is the ordinary way to say "not set", and
    // an empty string here is a URL nothing can parse — which would throw at
    // construction rather than at the first upload.
    const config = resolveStorageConfig({ ...complete, R2_ENDPOINT: "  " });

    expect(config.ok && "endpoint" in config.options).toBe(false);
  });

  it("names every variable that is missing, not just the first", () => {
    const config = resolveStorageConfig({ R2_ACCOUNT_ID: "acc" });

    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.reason).toContain("R2_ACCESS_KEY_ID");
    expect(config.reason).toContain("R2_SECRET_ACCESS_KEY");
    expect(config.reason).toContain("R2_BUCKET");
  });

  it("says what happens to photos meanwhile, because that is the real question", () => {
    const config = resolveStorageConfig({});

    expect(config.ok).toBe(false);
    expect(config.ok || config.reason).toContain("stay queued on the device");
  });

  it("treats whitespace as unset", () => {
    expect(resolveStorageConfig({ ...complete, R2_BUCKET: "   " }).ok).toBe(false);
  });

  it("uses the singular when exactly one is missing", () => {
    const config = resolveStorageConfig({ ...complete, R2_BUCKET: "" });

    expect(config.ok || config.reason).toContain("R2_BUCKET is not set");
  });
});

describe("storageFrom", () => {
  it("builds the adapter when everything is set", () => {
    expect(storageFrom(complete)?.name).toBe("cloudflare-r2");
  });

  it("hands back nothing at all when it is not", () => {
    expect(storageFrom({})).toBeUndefined();
  });
});
