"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A create or edit form, over the list rather than inside it (spec §8, v0.9).
 *
 * Every screen in the app puts its form in the page flow, so the layout grows
 * and collapses under you while you work: you tap "Add", the list you were
 * reading jumps down two hundred pixels, and on a phone it leaves the screen
 * entirely — so the record you were copying a tag number off is gone at the
 * moment you need it.
 *
 * A sheet keeps the list exactly where it was. It arrives from the bottom on a
 * phone, because that is where a thumb is, and from the right on a laptop,
 * because that is where the space is and because a list reads left to right.
 * The direction is chosen with a media query rather than a prop: it is a
 * property of the surface, and a caller that had to pass it would eventually
 * pass the wrong one.
 *
 * `<dialog>` rather than a div with a high z-index. The platform gives the top
 * layer, the backdrop, the Escape key, the inert page behind and the focus
 * trap for free, and every hand-rolled version of that list gets at least one
 * of them wrong.
 */

export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** One line under the title — what this is for, or which record it edits. */
  readonly description?: string;
  /** Buttons along the foot. The primary action goes last. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

export function Sheet({ open, onClose, title, description, footer, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // `showModal()` rather than the `open` attribute: only the method call puts
  // the dialog in the top layer and makes the rest of the page inert. Setting
  // the attribute renders it in place, still inside the flow, which is the
  // problem this component exists to solve.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape fires `cancel`, not `close`, and the default would close the dialog
  // without telling the caller — leaving `open` true and the sheet impossible
  // to reopen until something else changed it.
  const onCancel = useCallback(
    (event: React.SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClose={onClose}
      aria-labelledby={titleId}
      {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
      // A click on the backdrop is a click on the dialog element itself —
      // anything inside it stops at a child. That is the whole test, and it is
      // why the panel below is a real element rather than padding on this one.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={[
        "gf-sheet m-0 max-h-none max-w-none border-0 bg-transparent p-0 text-ink",
        "backdrop:bg-ink/40",
      ].join(" ")}
    >
      <div
        className={[
          "gf-sheet-panel flex flex-col gap-density overflow-y-auto bg-panel",
          "border-rule p-density shadow-[0_-12px_34px_-14px_rgba(20,23,27,0.28)]",
          "sm:shadow-[-14px_0_40px_-18px_rgba(20,23,27,0.28)]",
        ].join(" ")}
      >
        <header className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-heading text-xl font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              // Named rather than an ×: a screen reader saying "times" is not
              // a way out, and the target is a real one at every density.
              className="min-h-target min-w-target shrink-0 rounded-density px-3 text-density text-action"
            >
              Cancel
            </button>
          </div>
          {description === undefined ? null : (
            <p id={descriptionId} className="max-w-prose text-sm text-muted">
              {description}
            </p>
          )}
        </header>

        <div className="flex flex-1 flex-col gap-density">{children}</div>

        {footer === undefined ? null : (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-density">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
