import { afterEach } from "vitest";

/**
 * Shared setup for every suite.
 *
 * Testing Library only auto-registers its cleanup when Vitest runs with
 * `globals: true`, which this workspace does not — so without the hook below
 * each `render` leaves its markup behind and the next test's `getByRole` finds
 * two dialogs. Registering it explicitly keeps the tests independent.
 *
 * Guarded on `document` because the same setup file loads for the node-
 * environment suites, where importing a DOM testing library would fail.
 */
if (typeof document !== "undefined") {
  const [{ cleanup }] = await Promise.all([
    import("@testing-library/react"),
    import("@testing-library/jest-dom/vitest"),
  ]);
  afterEach(cleanup);
}
