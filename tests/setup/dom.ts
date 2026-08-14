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

  /**
   * jsdom ships `<dialog>` as an element but not as a dialog: `showModal` and
   * `close` are simply absent, so any component built on the platform dialog
   * throws the moment it mounts.
   *
   * Filled in here rather than per suite because it is a gap in the
   * environment, not a concern of any one test. The top layer, the backdrop
   * and the focus trap are still not real — what these give back is the
   * open/close state and the `close` event, which is the part components
   * actually branch on.
   */
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.show ??= function show(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
}
