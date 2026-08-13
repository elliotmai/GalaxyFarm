import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  contactLedger,
  linkCounts,
  linkedHistory,
  referenceCount,
  NO_LINK_SOURCES,
  type ContactLinkSources,
} from "../lib/contact-links.js";

/**
 * The CRM's linked history (spec §5.1).
 *
 * The behaviour worth pinning is the one a screen cannot show wrong twice: a
 * contact who is the vet on Tuesday and the buyer on Friday has to appear in
 * both places, and money the farm paid must never be added to money the farm
 * received.
 */

const id = (suffix: string) => `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}` as Ulid;
/** Record ids, kept off the contact ids so a mixed-up filter cannot pass. */
const rec = (suffix: string) => `01ARZ3NDEKTSV4RRFFQ69G6R${suffix}` as Ulid;

const VET = id("A0");
const HAULER = id("A1");
const COW = id("B0");
const on = (day: number) => new Date(Date.UTC(2026, 2, day, 12));

const sources = (overrides: Partial<ContactLinkSources>): ContactLinkSources => ({
  ...NO_LINK_SOURCES,
  ...overrides,
});

describe("linkedHistory", () => {
  it("finds a contact on both sides of the farm's dealings with them", () => {
    const links = linkedHistory(
      VET,
      sources({
        treatments: [
          {
            id: rec("T1"),
            animalId: COW,
            vetContactId: VET,
            date: on(3),
            type: "vaccination",
            product: "Bovi-Shield",
            cost: { cents: 4_200 },
          },
        ],
        sales: [
          {
            id: rec("S1"),
            animalId: COW,
            counterpartyId: VET,
            date: on(7),
            price: { cents: 180_000 },
          },
        ],
      }),
    );

    expect(links.map((link) => link.kind)).toEqual(["sale", "treatment"]);
    expect(links[0]?.direction).toBe("received");
    expect(links[1]?.detail).toBe("vaccination — Bovi-Shield");
  });

  it("ignores records pointing at somebody else", () => {
    const links = linkedHistory(
      VET,
      sources({
        acquisitions: [
          {
            id: rec("A1"),
            animalId: COW,
            counterpartyId: HAULER,
            date: on(1),
            price: { cents: 250_000 },
          },
        ],
      }),
    );

    expect(links).toEqual([]);
  });

  it("reads a buyer out of the cut lines and sums what they took in one line", () => {
    // Four packages off one steer is one transaction to a person. Four entries
    // would make the history look busier than it was.
    const links = linkedHistory(
      HAULER,
      sources({
        processing: [
          {
            id: rec("P1"),
            animalId: COW,
            processorId: VET,
            deliveredOn: on(1),
            collectedOn: on(14),
            processingCost: { cents: 65_000 },
            cutLines: [
              {
                cut: "Ribeye",
                pounds: 20,
                disposition: "sold",
                pricePerLb: { cents: 1_800 },
                buyerId: HAULER,
              },
              {
                cut: "Ground",
                pounds: 100,
                disposition: "sold",
                pricePerLb: { cents: 700 },
                buyerId: HAULER,
              },
              { cut: "Brisket", pounds: 12, disposition: "kept" },
            ],
          },
        ],
      }),
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.kind).toBe("cut_sale");
    expect(links[0]?.amount).toEqual({ cents: 20 * 1_800 + 100 * 700 });
    expect(links[0]?.detail).toBe("Ribeye, Ground");
    // The date somebody collected the meat, not the day it went in.
    expect(links[0]?.date).toEqual(on(14));
  });

  it("gives the processor and the cut buyer separate links off one record", () => {
    const record = {
      id: rec("P1"),
      animalId: COW,
      processorId: VET,
      deliveredOn: on(1),
      collectedOn: undefined,
      processingCost: { cents: 65_000 },
      cutLines: [
        {
          cut: "Ribeye",
          pounds: 20,
          disposition: "sold" as const,
          pricePerLb: { cents: 1_800 },
          buyerId: VET,
        },
      ],
    };

    const links = linkedHistory(VET, sources({ processing: [record] }));

    expect(links.map((link) => link.kind).sort()).toEqual(["cut_sale", "processing"]);
    // Two relationships that happen to share a record, netted separately.
    expect(contactLedger(links)).toMatchObject({
      paid: { cents: 65_000 },
      received: { cents: 36_000 },
    });
  });

  it("prices a feed purchase by quantity, which the record does not store", () => {
    const links = linkedHistory(
      HAULER,
      sources({
        feedPurchases: [
          {
            id: rec("F1"),
            feedTypeId: rec("FT1"),
            vendorContactId: HAULER,
            purchasedOn: on(9),
            quantity: 12,
            unitCost: { cents: 1_450 },
          },
        ],
      }),
    );

    expect(links[0]?.amount).toEqual({ cents: 17_400 });
    expect(links[0]?.direction).toBe("paid");
  });

  it("dates a candidate from when it was first seen", () => {
    const links = linkedHistory(
      HAULER,
      sources({
        candidates: [
          {
            id: rec("C1"),
            sellerId: HAULER,
            title: "2018 F-250",
            askingPrice: { cents: 3_200_000 },
            firstSeen: on(5),
          },
        ],
      }),
    );

    expect(links[0]?.date).toEqual(on(5));
    // A listing is not a transaction: nothing has changed hands.
    expect(links[0]?.direction).toBe("none");
  });

  it("orders everything newest first, across kinds", () => {
    const links = linkedHistory(
      HAULER,
      sources({
        acquisitions: [
          {
            id: rec("A1"),
            animalId: COW,
            counterpartyId: HAULER,
            date: on(1),
            price: { cents: 100 },
          },
        ],
        breedings: [
          { id: rec("B1"), damId: COW, technicianId: HAULER, date: on(20), method: "AI" },
        ],
        sales: [
          {
            id: rec("S1"),
            animalId: COW,
            counterpartyId: HAULER,
            date: on(10),
            price: { cents: 100 },
          },
        ],
      }),
    );

    expect(links.map((link) => link.recordId)).toEqual([rec("B1"), rec("S1"), rec("A1")]);
  });
});

describe("contactLedger", () => {
  it("keeps money out and money in on their own sides", () => {
    const links = linkedHistory(
      HAULER,
      sources({
        acquisitions: [
          {
            id: rec("A1"),
            animalId: COW,
            counterpartyId: HAULER,
            date: on(1),
            price: { cents: 250_000 },
          },
        ],
        sales: [
          {
            id: rec("S1"),
            animalId: COW,
            counterpartyId: HAULER,
            date: on(9),
            price: { cents: 180_000 },
          },
        ],
      }),
    );

    expect(contactLedger(links)).toEqual({
      paid: { cents: 250_000 },
      received: { cents: 180_000 },
      net: { cents: -70_000 },
      unpriced: 0,
    });
  });

  it("counts what it could not price rather than treating it as free", () => {
    // A vet bill with no cost on it makes the total a floor, and the screen
    // has to be able to say so.
    const links = linkedHistory(
      VET,
      sources({
        treatments: [
          {
            id: rec("T1"),
            animalId: COW,
            vetContactId: VET,
            date: on(3),
            type: "exam",
            product: undefined,
            cost: undefined,
          },
        ],
      }),
    );

    // Money out, whether or not the bill was ever entered — and the ledger
    // says how many it could not price rather than counting them as free.
    expect(links[0]?.direction).toBe("paid");
    expect(contactLedger(links)).toMatchObject({ paid: { cents: 0 }, unpriced: 1 });
    expect(links[0]?.detail).toBe("exam");
  });

  it("is all zeroes for a contact with no dealings", () => {
    expect(contactLedger([])).toEqual({
      paid: { cents: 0 },
      received: { cents: 0 },
      net: { cents: 0 },
      unpriced: 0,
    });
  });
});

describe("linkCounts and referenceCount", () => {
  const busy = sources({
    sales: [
      { id: rec("S1"), animalId: COW, counterpartyId: HAULER, date: on(4), price: { cents: 1 } },
      { id: rec("S2"), animalId: COW, counterpartyId: HAULER, date: on(5), price: { cents: 1 } },
    ],
    breedings: [{ id: rec("B1"), damId: COW, technicianId: HAULER, date: on(6), method: "AI" }],
  });

  it("tallies by kind", () => {
    const counts = linkCounts(linkedHistory(HAULER, busy));

    expect(counts.get("sale")).toBe(2);
    expect(counts.get("breeding")).toBe(1);
    expect(counts.get("acquisition")).toBeUndefined();
  });

  it("counts every record that would lose its reference, for the delete dialog", () => {
    expect(referenceCount(HAULER, busy)).toBe(3);
    expect(referenceCount(VET, busy)).toBe(0);
  });
});

describe("what could not be priced", () => {
  it("counts a quarter beef sold at a price nobody entered, rather than calling it a gift", () => {
    const links = linkedHistory(
      HAULER,
      sources({
        processing: [
          {
            id: rec("P1"),
            animalId: COW,
            processorId: undefined,
            deliveredOn: on(1),
            collectedOn: undefined,
            processingCost: undefined,
            cutLines: [{ cut: "Quarter", pounds: 180, disposition: "sold", buyerId: HAULER }],
          },
        ],
      }),
    );

    expect(links[0]?.amount).toBeUndefined();
    expect(contactLedger(links)).toMatchObject({ received: { cents: 0 }, unpriced: 1 });
  });

  it("prices the lines it can and still flags the record", () => {
    const links = linkedHistory(
      HAULER,
      sources({
        processing: [
          {
            id: rec("P1"),
            animalId: COW,
            processorId: undefined,
            deliveredOn: on(1),
            collectedOn: undefined,
            processingCost: undefined,
            cutLines: [
              {
                cut: "Ribeye",
                pounds: 10,
                disposition: "sold",
                pricePerLb: { cents: 1_800 },
                buyerId: HAULER,
              },
              { cut: "Ground", pounds: 40, disposition: "sold", buyerId: HAULER },
            ],
          },
        ],
      }),
    );

    // The priced half counts; the unpriced half is not invented at zero and
    // not dropped from the label either.
    expect(links[0]?.amount).toEqual({ cents: 18_000 });
    expect(links[0]?.detail).toBe("Ribeye, Ground");
  });
});
