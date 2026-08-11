import type { Money } from "../value-objects/money.js";
import type { Ulid } from "../types/ids.js";

/**
 * Invoicing (spec §5.7, §12 decision 3).
 *
 * QuickBooks Online is the chosen adapter, and the spec is specific about the
 * timing: "the port exists from day one so nothing needs restructuring". The
 * business module is a Phase 5 scaffold, but an invoice shape bolted on later
 * around an existing QuickBooks client is how the dependency ends up pointing
 * the wrong way.
 *
 * Deliberately small. Everything QuickBooks-shaped — OAuth, realm ids, token
 * refresh, their idea of a customer — stays behind it.
 */

export interface InvoiceLineDraft {
  readonly description: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  /** Our own line id, so a synced invoice can be reconciled line by line. */
  readonly reference?: string | undefined;
}

export interface InvoiceDraft {
  readonly customerReference: string;
  readonly issuedOn: Date;
  readonly dueOn?: Date | undefined;
  readonly lines: readonly InvoiceLineDraft[];
  readonly memo?: string | undefined;
  /** Our invoice id, so a retry cannot raise the same invoice twice. */
  readonly idempotencyKey: Ulid;
}

export interface SyncedInvoice {
  /** The provider's id, stored alongside ours. */
  readonly externalId: string;
  readonly number?: string | undefined;
  readonly total: Money;
  readonly url?: string | undefined;
}

export interface CustomerDraft {
  readonly name: string;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
}

export interface InvoicingProvider {
  readonly name: string;
  /** Returns the provider's customer id, creating the customer if needed. */
  ensureCustomer(draft: CustomerDraft): Promise<string>;
  createInvoice(draft: InvoiceDraft): Promise<SyncedInvoice>;
  voidInvoice(externalId: string, reason: string): Promise<void>;
}

/** What a draft comes to, computed here so both sides agree before sending. */
export function invoiceDraftTotal(draft: Pick<InvoiceDraft, "lines">): Money {
  return {
    cents: draft.lines.reduce(
      (total, line) => total + Math.round(line.unitAmount.cents * line.quantity),
      0,
    ),
  };
}
