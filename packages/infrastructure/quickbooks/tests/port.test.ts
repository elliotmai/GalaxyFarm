import { describe, expect, it } from "vitest";

import { fromDollars, invoiceDraftTotal, type InvoiceDraft, type Ulid } from "@galaxy-farm/core";

import { QuickBooksNotConfiguredError, quickBooksProvider } from "../src/index.js";

/**
 * The invoicing port, and the seam its adapter will fill (spec §5.7, §12
 * decision 3).
 *
 * §5.7: "the port exists from day one so nothing needs restructuring". These
 * tests exist to hold that line — the invoice shape is ours, decided before
 * any OAuth flow gets a vote in it.
 */

const draft: InvoiceDraft = {
  customerReference: "cust-1",
  issuedOn: new Date("2027-01-31"),
  idempotencyKey: "01ARZ3NDEKTSV4RRFFQ69G5F01" as Ulid,
  lines: [
    { description: "Board, 31 days", quantity: 31, unitAmount: fromDollars(12) },
    { description: "Feed allocation", quantity: 1, unitAmount: fromDollars(87.5) },
  ],
};

describe("invoiceDraftTotal", () => {
  it("totals the lines before anything is sent", () => {
    // Computed on our side so both sides can be compared rather than trusted.
    expect(invoiceDraftTotal(draft)).toEqual(fromDollars(459.5));
  });

  it("rounds each line rather than the total, which is how an invoice reads", () => {
    const thirds: InvoiceDraft = {
      ...draft,
      lines: [{ description: "Thirds", quantity: 3, unitAmount: { cents: 333 } }],
    };

    expect(invoiceDraftTotal(thirds)).toEqual({ cents: 999 });
  });

  it("totals an empty draft to nothing", () => {
    expect(invoiceDraftTotal({ lines: [] })).toEqual({ cents: 0 });
  });
});

describe("quickBooksProvider", () => {
  it("refuses loudly rather than pretending to succeed", async () => {
    // A stub that silently succeeded would let a Phase 5 invoice look raised
    // when nothing was.
    const provider = quickBooksProvider();

    await expect(provider.createInvoice(draft)).rejects.toBeInstanceOf(
      QuickBooksNotConfiguredError,
    );
    await expect(provider.ensureCustomer({ name: "A customer" })).rejects.toThrow(/Phase 5/);
    await expect(provider.voidInvoice("qb-1", "duplicate")).rejects.toThrow(/not connected/);
  });

  it("names itself, so a log says which provider refused", () => {
    expect(quickBooksProvider().name).toBe("quickbooks-online");
  });
});
