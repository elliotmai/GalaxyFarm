"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Toasts (spec §8, and §4.5 clause 3's undo).
 *
 * The undo toast is the reason this exists. Clause 3 pairs a Standard-tier
 * delete with an undo, and an undo the user never sees is not an undo — so a
 * toast carrying one waits longer than an informational one, and hovering or
 * focusing the stack holds every timer. Someone reaching for "Undo" with a
 * mouse must not watch it disappear on the way.
 */

export type ToastTone = "info" | "success" | "danger";

export interface ToastAction {
  readonly label: string;
  readonly onAct: () => void;
}

export interface ToastOptions {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
  /** Milliseconds. Defaults to 5s, or 10s when there is an action to take. */
  readonly durationMs?: number;
}

interface ActiveToast extends ToastOptions {
  readonly id: number;
}

export interface ToastApi {
  show(options: ToastOptions): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export const DEFAULT_TOAST_MS = 5_000;
/** An action needs time to be noticed, moved to, and pressed. */
export const ACTIONABLE_TOAST_MS = 10_000;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === undefined) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return api;
}

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** Injected in tests so timing is asserted rather than waited out. */
  readonly setTimer?: (fn: () => void, ms: number) => number;
  readonly clearTimer?: (handle: number) => void;
}

export function ToastProvider({ children, setTimer, clearTimer }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ActiveToast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const [held, setHeld] = useState(false);

  const schedule = setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
  const unschedule = clearTimer ?? ((handle) => window.clearTimeout(handle));

  const dismiss = useCallback(
    (id: number) => {
      const handle = timers.current.get(id);
      if (handle !== undefined) {
        unschedule(handle);
        // crud-guard: allow-unconfirmed — cancelling a timer, nothing persisted
        timers.current.delete(id);
      }
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [unschedule],
  );

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...options, id }]);

      const ms =
        options.durationMs ??
        (options.action === undefined ? DEFAULT_TOAST_MS : ACTIONABLE_TOAST_MS);
      timers.current.set(
        id,
        schedule(() => dismiss(id), ms),
      );
    },
    [dismiss, schedule],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  /** Pause every timer while the stack is hovered or focused. */
  const hold = () => {
    setHeld(true);
    for (const handle of timers.current.values()) unschedule(handle);
    // crud-guard: allow-unconfirmed — dropping timer handles, nothing persisted
    timers.current.clear();
  };

  const release = () => setHeld(false);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Polite: a toast is a confirmation, not an interruption. The one
        // exception is a failure, which is announced by role="alert" below.
        aria-live="polite"
        aria-label="Notifications"
        data-held={held}
        onMouseEnter={hold}
        onMouseLeave={release}
        onFocus={hold}
        onBlur={release}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "danger" ? "alert" : "status"}
            className={[
              "pointer-events-auto flex min-h-target w-full max-w-md items-center justify-between gap-4",
              "rounded-density border bg-panel px-4 py-2 text-density text-ink shadow-lg",
              toast.tone === "danger" ? "border-danger" : "border-edge",
            ].join(" ")}
          >
            <span>{toast.message}</span>
            <span className="flex items-center gap-2">
              {toast.action === undefined ? null : (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onAct();
                    dismiss(toast.id);
                  }}
                  className="min-h-target font-semibold text-action underline underline-offset-2"
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={`Dismiss: ${toast.message}`}
                className="min-h-target px-2 text-muted"
              >
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
