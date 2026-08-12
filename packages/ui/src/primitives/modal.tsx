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
 * What it does not do is trap focus. That belongs in one place with the
 * confirmation dialog rather than in two, and this is deliberately the
 * lighter-weight thing: Escape closes, the backdrop closes, focus lands
 * inside, and the page behind is inert to scroll.
 */

export interface ModalProps {
  readonly title: string;
  /** Sits under the title, in the muted voice. */
  readonly description?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Wider, for a form with two columns in it. */
  readonly size?: "regular" | "wide";
  readonly footer?: ReactNode;
}

export function Modal({
  title,
  description,
  onClose,
  children,
  size = "regular",
  footer,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Focus lands inside, so the next Tab is in the dialog and a screen reader
  // starts reading here rather than at the top of the page behind it.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  // The page behind must not scroll under the dialog — on a phone that reads
  // as the dialog itself sliding away.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-density"
      onKeyDown={onKeyDown}
      // Clicking the backdrop closes. Checked against the target rather than
      // relying on the bubble, so a click that starts inside the panel and
      // ends on the backdrop — a text selection dragged too far — does not
      // throw the form away.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
        tabIndex={-1}
        className={[
          "flex max-h-[92dvh] w-full flex-col gap-density overflow-y-auto rounded-t-density",
          "border border-edge bg-panel p-density text-ink outline-none",
          "shadow-[0_-8px_32px_rgba(0,0,0,0.5)] sm:rounded-density",
          size === "wide" ? "max-w-3xl" : "max-w-xl",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-density">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="font-heading text-lg font-semibold">
              {title}
            </h2>
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
          <div className="flex flex-wrap gap-2 border-t border-edge pt-density">{footer}</div>
        )}
      </div>
    </div>
  );
}
