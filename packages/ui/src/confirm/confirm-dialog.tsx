"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  assertValidRequest,
  confirmTitle,
  dependentSummary,
  type ConfirmRequest,
} from "./types.js";

/**
 * The dialog every destructive action routes through (spec §4.5 clause 3).
 *
 * Presentational and controlled — it takes a request and reports the decision.
 * It performs no deletion itself and, critically, never awaits anything: the
 * confirmation must behave identically standing in the barn with zero bars as
 * it does at the kitchen table.
 *
 * It is a real modal, and it was not always. This rendered as unstyled markup
 * at the bottom of the page — correct in structure, correct to a screen
 * reader, and on a phone it appeared below the fold of whatever screen you
 * were already on. The most important safety surface in the app is not one to
 * make somebody scroll to find, so it now covers the page, traps its own
 * scroll, and sits above everything else.
 *
 * The panel is bottom-anchored on a phone and centred on a laptop. A dialog in
 * the middle of a tall phone screen puts its buttons where a thumb has to
 * stretch, and the buttons here are the whole point of it.
 */

export interface ConfirmDialogProps {
  readonly request: ConfirmRequest;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({ request, onConfirm, onCancel }: ConfirmDialogProps) {
  assertValidRequest(request);

  const titleId = useId();
  const descriptionId = useId();
  const [typed, setTyped] = useState("");
  const [pinEntry, setPinEntry] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on Cancel, not Confirm. A stray Enter should do nothing.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  const needsTypedName = request.tier === "typed";
  const needsPin = request.tier === "elevated" && request.pin !== undefined;

  const nameMatches = typed.trim() === request.recordName.trim();
  const pinMatches = request.pin === undefined || pinEntry === request.pin;
  const canConfirm = (!needsTypedName || nameMatches) && (!needsPin || pinMatches);

  const summary = dependentSummary(request.dependents);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-density"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-tier={request.tier}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col gap-density overflow-y-auto rounded-t-density border border-edge bg-panel p-density text-ink shadow-[0_-8px_32px_rgba(0,0,0,0.5)] sm:rounded-density"
      >
        <h2 id={titleId}>{confirmTitle(request)}</h2>

        <div id={descriptionId} className="flex flex-col gap-3 text-density">
          {summary !== undefined && (
            <p data-testid="dependent-summary" className="text-muted">
              {summary}
            </p>
          )}

          {request.dependents.length > 0 && (
            // Elevated and Typed list the dependents individually. A count alone
            // tells you how bad it is; the list tells you whether you meant it.
            <ul data-testid="dependent-list" className="flex flex-col gap-1 text-muted">
              {request.dependents.map((dependent) => (
                <li key={`${dependent.entity}:${dependent.label}`} className="break-words">
                  {dependent.entity} {dependent.label} —{" "}
                  {dependent.effect === "deleted" ? "will be deleted" : "will lose the reference"}
                </li>
              ))}
            </ul>
          )}

          {request.consequence !== undefined && (
            <p className="text-danger">{request.consequence}</p>
          )}

          {request.tier !== "typed" && (
            <p data-testid="undo-hint" className="text-sm text-muted">
              You can restore this from Trash for 30 days.
            </p>
          )}
        </div>

        {needsTypedName && (
          <label className="flex flex-col gap-1 text-sm text-muted">
            <span>
              Type <strong className="text-ink">{request.recordName}</strong> to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              aria-label={`Type ${request.recordName} to confirm`}
              autoComplete="off"
              className="min-h-control w-full rounded-density border border-edge bg-canvas px-3 text-density text-ink"
            />
          </label>
        )}

        {needsPin && (
          <label className="flex flex-col gap-1 text-sm text-muted">
            <span>Enter PIN</span>
            <input
              type="password"
              value={pinEntry}
              onChange={(event) => setPinEntry(event.target.value)}
              aria-label="Enter PIN"
              autoComplete="off"
              inputMode="numeric"
              className="min-h-control w-full rounded-density border border-edge bg-canvas px-3 text-density text-ink"
            />
          </label>
        )}

        {/*
        Cancel first in the DOM, so it is the first thing reached by tab and by
        a screen reader, and it is where focus already is. Confirm is placed
        last visually on a phone — the far side of the row from where a thumb
        rests — because the cheapest way to delete something you did not mean
        to is a button that happens to be under your finger.
      */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className="min-h-target rounded-density border border-edge px-density text-density text-ink hover:border-action"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
            className="min-h-target rounded-density border border-danger bg-danger/10 px-density text-density font-medium text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            {request.action ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
