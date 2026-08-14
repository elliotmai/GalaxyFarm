"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A dialog for anything that is not a confirmation (spec §8).
 *
 * The confirmation dialog was made a real modal because rendering it inline
 * put the most important safety surface in the app below the fold of whatever
 * screen you were already on. Editors have the same problem for a duller
 * reason: an edit form that opens at the top of a long list, when the row you
 * clicked is near the foot of it, appears to do nothing at all. That is
 * exactly how the ancestors editor was reported.
 *
 * Same shell as the confirmation on purpose — bottom-anchored on a phone,
 * centred on a laptop, its own scroll, above everything. A dialog centred in a
 * tall phone screen puts its buttons where a thumb has to stretch.
 *
 * Built on the platform `<dialog>` and `showModal()`. That is where the top
 * layer, the backdrop, the Escape key, the focus trap and an inert page behind
 * all come from — this used to be a div at `z-index: 40` that hand-rolled four
 * of those five and deliberately went without the focus trap, which meant Tab
 * walked straight out of an open editor and into the list behind it.
 *
 * `placement="side"` is for a form over a list it is about. Centring an editor
 * covers the rows somebody is copying a tag number off; arriving from the right
 * keeps them in view. On a phone both placements are the same bottom sheet,
 * because there is no room beside anything.
 */

export interface ModalProps {
  readonly title: string;
  /** Sits under the title, in the muted voice. */
  readonly description?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Wider, for a form with two columns in it. Ignored when placed to the side. */
  readonly size?: "regular" | "wide";
  /**
   * Centred over the page, or arriving from the right beside it.
   *
   * Side for anything editing a row of a list still worth seeing; centred for
   * everything else. On a phone both are a bottom sheet.
   */
  readonly placement?: "center" | "side";
  readonly footer?: ReactNode;
}

export function Modal({
  title,
  description,
  onClose,
  children,
  size = "regular",
  placement = "center",
  footer,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  // `showModal()` rather than the `open` attribute: only the method call puts
  // the dialog in the top layer and makes the rest of the page inert. The
  // attribute renders it in place, still in the flow, which is the problem a
  // dialog exists to solve.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) element.showModal();

    // `showModal()` puts focus on the first focusable descendant, which here is
    // the Close button — so a screen reader opens an editor by announcing the
    // way out of it. Focusing the dialog itself instead means the title is read
    // first and the next Tab lands on the first field.
    element.focus();
  }, []);

  // The page behind must not scroll under the dialog. `showModal()` makes the
  // page inert to *interaction* but not to scrolling, and on a phone a page
  // that scrolls behind an open editor reads as the editor sliding away.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape fires `cancel`, not `close`, and the default would shut the dialog
  // without telling the caller — leaving the state that opened it untouched
  // and the editor impossible to reopen.
  const onCancel = useCallback(
    (event: React.SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialog}
      onCancel={onCancel}
      onClose={onClose}
      tabIndex={-1}
      // Redundant on a dialog opened with `showModal()`, which is modal by
      // definition — but stated anyway, because it is the one part of that
      // promise a test can actually hold us to.
      aria-modal="true"
      aria-labelledby={titleId}
      {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
      // Clicking the backdrop closes. A click on the backdrop is a click on the
      // dialog element itself — anything inside stops at a child — and it is
      // checked on mousedown against the target so a text selection dragged
      // past the panel edge does not throw the form away.
      onMouseDown={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className={[
        "gf-modal m-0 max-h-none max-w-none border-0 bg-transparent p-0 text-ink",
        placement === "side" ? "gf-modal--side" : "gf-modal--center",
        "backdrop:bg-ink/50",
      ].join(" ")}
    >
      <div
        className={[
          "gf-modal-panel flex flex-col gap-density overflow-y-auto",
          "border-rule bg-panel p-density text-ink outline-none",
          placement === "side" ? "" : size === "wide" ? "sm:max-w-3xl" : "sm:max-w-xl",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="flex items-start justify-between gap-density">
          <div className="flex flex-col gap-1">
            <h2 id={titleId}>{title}</h2>
            {description === undefined ? null : (
              <p id={descriptionId} className="text-density text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-density px-2 py-1 text-lg text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-action"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-density">{children}</div>

        {footer === undefined ? null : (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-density">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
