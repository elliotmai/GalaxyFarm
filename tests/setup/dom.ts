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
  /**
   * jsdom gives every element a layout that never scrolls, and leaves
   * `scrollIntoView` off `Element.prototype` entirely — so a component that
   * scrolls to its own form after a tap does not fail to scroll, it throws.
   *
   * Stubbed here rather than per suite for the same reason as the dialog
   * methods below: it is a gap in the environment, not a concern of any one
   * test. Vitest reports the throw as an unhandled error and exits non-zero
   * even when every test passed, which is enough on its own to hold the whole
   * `pnpm verify` gate red.
   */
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};

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

  /**
   * jsdom has no `ResizeObserver` at all.
   *
   * A component that measures itself — the spatial editor needs a width and a
   * height in pixels before it can project a coordinate onto a panel — throws
   * on mount without one, so the gap is filled here rather than in each suite,
   * for the same reason `<dialog>` is.
   *
   * It reports whatever `getBoundingClientRect` says, which in jsdom is zeros
   * until a test stubs it. That is the honest behaviour: an element that has
   * not been laid out has no size, and a component that draws itself into one
   * has to cope with being told so.
   */
  /**
   * jsdom has no `PointerEvent` either.
   *
   * Testing Library falls back to a bare `Event` when the constructor is
   * missing, and a bare event carries no `button`, no `pointerId` and no
   * coordinates — so a component that drags things reads every gesture as a
   * click at the origin, and the tests pass or fail for reasons unrelated to
   * the component. Extending `MouseEvent` gets the buttons and the coordinates
   * from the platform and adds only the two fields pointer events contribute.
   */
  if (typeof globalThis.PointerEvent === "undefined") {
    globalThis.PointerEvent = class PointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "mouse";
        this.isPrimary = init.isPrimary ?? true;
      }
    } as unknown as typeof globalThis.PointerEvent;
  }

  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
          this as unknown as globalThis.ResizeObserver,
        );
      }

      unobserve(): void {}

      disconnect(): void {}
    };
  }
}
