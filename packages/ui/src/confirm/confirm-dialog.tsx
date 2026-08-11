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
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-tier={request.tier}
      onKeyDown={handleKeyDown}
    >
      <h2 id={titleId}>{confirmTitle(request)}</h2>

      <div id={descriptionId}>
        {summary !== undefined && <p data-testid="dependent-summary">{summary}</p>}

        {request.dependents.length > 0 && (
          // Elevated and Typed list the dependents individually. A count alone
          // tells you how bad it is; the list tells you whether you meant it.
          <ul data-testid="dependent-list">
            {request.dependents.map((dependent) => (
              <li key={`${dependent.entity}:${dependent.label}`}>
                {dependent.entity} {dependent.label} —{" "}
                {dependent.effect === "deleted" ? "will be deleted" : "will lose the reference"}
              </li>
            ))}
          </ul>
        )}

        {request.consequence !== undefined && <p>{request.consequence}</p>}

        {request.tier !== "typed" && (
          <p data-testid="undo-hint">You can restore this from Trash for 30 days.</p>
        )}
      </div>

      {needsTypedName && (
        <label>
          Type <strong>{request.recordName}</strong> to confirm
          <input
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label={`Type ${request.recordName} to confirm`}
            autoComplete="off"
          />
        </label>
      )}

      {needsPin && (
        <label>
          Enter PIN
          <input
            type="password"
            value={pinEntry}
            onChange={(event) => setPinEntry(event.target.value)}
            aria-label="Enter PIN"
            autoComplete="off"
          />
        </label>
      )}

      <button type="button" ref={cancelRef} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" disabled={!canConfirm} onClick={onConfirm}>
        {request.action ?? "Delete"}
      </button>
    </div>
  );
}
