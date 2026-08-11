"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "./confirm-dialog.js";
import type { ConfirmRequest } from "./types.js";

/**
 * The hook call sites use.
 *
 * `confirm(request)` resolves `true` if the user went ahead. The caller then
 * performs the deletion — which keeps this component free of any knowledge
 * about what is being deleted, and means the CI guard's rule ("a file that
 * deletes must import a confirmation helper") is satisfied by the import.
 */

export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

export function useConfirmDelete(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (confirm === undefined) {
    throw new Error(
      "useConfirmDelete must be used inside a <ConfirmProvider>. Every surface that can " +
        "delete anything needs one (spec §4.5 clause 3).",
    );
  }
  return confirm;
}

interface PendingConfirmation {
  readonly request: ConfirmRequest;
  readonly resolve: (confirmed: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | undefined>(undefined);
  // Held in a ref as well so settle() cannot lose the resolver to a re-render.
  const pendingRef = useRef<PendingConfirmation | undefined>(undefined);

  const confirm = useCallback<ConfirmFn>((request) => {
    return new Promise<boolean>((resolve) => {
      const next = { request, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = undefined;
    setPending(undefined);
    current?.resolve(confirmed);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending !== undefined && (
        <ConfirmDialog
          request={pending.request}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
