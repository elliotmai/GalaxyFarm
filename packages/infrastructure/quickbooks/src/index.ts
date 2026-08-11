import type {
  CustomerDraft,
  InvoiceDraft,
  InvoicingProvider,
  SyncedInvoice,
} from "@galaxy-farm/core";

/**
 * QuickBooks Online (spec §5.7, §12 decision 3).
 *
 * The port lives in the kernel and is real; this package is the seam where the
 * adapter will go. §4.1 says "port defined now, adapter later" and §5.7 says
 * the port exists "from day one so nothing needs restructuring" — the point
 * being that the invoice shape is ours, decided before any OAuth flow gets a
 * vote in it.
 *
 * What is here is the honest amount: a provider that refuses, loudly, with a
 * message that says what is missing. A stub that silently succeeded would let
 * a Phase 5 invoice look raised when nothing was.
 */

export class QuickBooksNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `QuickBooks is not connected yet, so "${operation}" cannot run. ` +
        `The OAuth flow and adapter land with Phase 5 (spec §5.7); the port is in place so ` +
        `nothing above it needs to change when they do.`,
    );
    this.name = "QuickBooksNotConfiguredError";
  }
}

/** The Phase 5 seam. Every call refuses until the adapter is written. */
export function quickBooksProvider(): InvoicingProvider {
  return {
    name: "quickbooks-online",

    async ensureCustomer(_draft: CustomerDraft): Promise<string> {
      throw new QuickBooksNotConfiguredError("ensureCustomer");
    },

    async createInvoice(_draft: InvoiceDraft): Promise<SyncedInvoice> {
      throw new QuickBooksNotConfiguredError("createInvoice");
    },

    async voidInvoice(_externalId: string, _reason: string): Promise<void> {
      throw new QuickBooksNotConfiguredError("voidInvoice");
    },
  };
}
