import { sumMoney, type Money, type PurchaseCandidate, type Ulid } from "@galaxy-farm/core";
import type {
  AcquisitionRecord,
  BreedingRecord,
  HealthRecord,
  ProcessingRecord,
  SaleRecord,
} from "@galaxy-farm/module-cattle";
import type { FeedPurchase } from "@galaxy-farm/module-feed";

/**
 * What a contact has actually done with the farm (spec §5.1).
 *
 * §5.1 asks the CRM for "linked history — animals bought from or sold to them,
 * treatments they administered, feed and supply purchases from them, egg
 * dispositions". None of that is a field on `Contact`, and it must not become
 * one: the hauler who also bought a steer would need two lists kept in step by
 * hand, and the pair would disagree the first time a sale was corrected.
 *
 * So it is derived, here, in the composition root. The records live in six
 * different modules and §4.1 forbids them importing each other — `apps/web` is
 * the one place they may all be read at once. Everything below takes the
 * narrowest shape it needs rather than the whole entity, which is what lets
 * this be tested without building a herd.
 */

export const CONTACT_LINK_KINDS = [
  "acquisition",
  "sale",
  "treatment",
  "breeding",
  "processing",
  "cut_sale",
  "feed_purchase",
  "candidate",
] as const;
export type ContactLinkKind = (typeof CONTACT_LINK_KINDS)[number];

/**
 * Which way the money went, from the farm's side.
 *
 * A property of the *kind* of dealing, not of whether somebody wrote the
 * figure down: a vet call is money out whether or not the bill was entered.
 * That is what lets the totals below say how many entries they could not price
 * rather than quietly counting an unrecorded bill as free.
 *
 * `none` is for the links where nothing changed hands at all — a breeding, a
 * listing somebody is still thinking about.
 */
export type MoneyDirection = "paid" | "received" | "none";

export interface ContactLink {
  readonly kind: ContactLinkKind;
  readonly recordId: Ulid;
  readonly date: Date;
  /** The animal it concerns, when it concerns one. */
  readonly animalId?: Ulid | undefined;
  readonly amount?: Money | undefined;
  readonly direction: MoneyDirection;
  /** A short line the screen shows verbatim. */
  readonly detail?: string | undefined;
}

type Acquisition = Pick<AcquisitionRecord, "id" | "animalId" | "counterpartyId" | "date" | "price">;
type Sale = Pick<SaleRecord, "id" | "animalId" | "counterpartyId" | "date" | "price">;
type Treatment = Pick<
  HealthRecord,
  "id" | "animalId" | "vetContactId" | "date" | "type" | "product" | "cost"
>;
type Breeding = Pick<BreedingRecord, "id" | "damId" | "technicianId" | "date" | "method">;
type Processing = Pick<
  ProcessingRecord,
  "id" | "animalId" | "processorId" | "deliveredOn" | "collectedOn" | "processingCost" | "cutLines"
>;
type Purchase = Pick<
  FeedPurchase,
  "id" | "feedTypeId" | "vendorContactId" | "purchasedOn" | "quantity" | "unitCost"
>;
type Candidate = Pick<PurchaseCandidate, "id" | "sellerId" | "title" | "askingPrice" | "firstSeen">;

export interface ContactLinkSources {
  readonly acquisitions: readonly Acquisition[];
  readonly sales: readonly Sale[];
  readonly treatments: readonly Treatment[];
  readonly breedings: readonly Breeding[];
  readonly processing: readonly Processing[];
  readonly feedPurchases: readonly Purchase[];
  readonly candidates: readonly Candidate[];
}

export const NO_LINK_SOURCES: ContactLinkSources = {
  acquisitions: [],
  sales: [],
  treatments: [],
  breedings: [],
  processing: [],
  feedPurchases: [],
  candidates: [],
};

/**
 * Everything this contact appears in, newest first.
 *
 * A processing record can produce two entries — the kill fee we paid the
 * processor, and cuts a neighbour bought — and they are deliberately separate
 * links rather than one netted line, because they are two different
 * relationships that happen to share a record.
 */
export function linkedHistory(contactId: Ulid, sources: ContactLinkSources): ContactLink[] {
  const links: ContactLink[] = [];

  for (const record of sources.acquisitions) {
    if (record.counterpartyId !== contactId) continue;
    links.push({
      kind: "acquisition",
      recordId: record.id,
      date: record.date,
      animalId: record.animalId,
      amount: record.price,
      direction: "paid",
    });
  }

  for (const record of sources.sales) {
    if (record.counterpartyId !== contactId) continue;
    links.push({
      kind: "sale",
      recordId: record.id,
      date: record.date,
      animalId: record.animalId,
      amount: record.price,
      direction: "received",
    });
  }

  for (const record of sources.treatments) {
    if (record.vetContactId !== contactId) continue;
    links.push({
      kind: "treatment",
      recordId: record.id,
      date: record.date,
      animalId: record.animalId,
      amount: record.cost,
      direction: "paid",
      detail: record.product === undefined ? record.type : `${record.type} — ${record.product}`,
    });
  }

  for (const record of sources.breedings) {
    if (record.technicianId !== contactId) continue;
    links.push({
      kind: "breeding",
      recordId: record.id,
      date: record.date,
      animalId: record.damId,
      direction: "none",
      detail: record.method,
    });
  }

  for (const record of sources.processing) {
    if (record.processorId === contactId) {
      links.push({
        kind: "processing",
        recordId: record.id,
        date: record.deliveredOn,
        animalId: record.animalId,
        amount: record.processingCost,
        direction: "paid",
      });
    }

    // Cuts are lines inside the record rather than records of their own, so a
    // buyer is found by looking through them. Summed per record: four packages
    // to the same neighbour off one steer is one transaction to a person, not
    // four entries that make the history look busier than it was.
    const bought = record.cutLines.filter((line) => line.buyerId === contactId);
    if (bought.length > 0) {
      const priced = bought.filter((line) => line.pricePerLb !== undefined);
      links.push({
        kind: "cut_sale",
        recordId: record.id,
        date: record.collectedOn ?? record.deliveredOn,
        animalId: record.animalId,
        // Undefined rather than zero when not one line carried a price: a
        // quarter beef sold at a price nobody entered is unpriced, and zero
        // would report it as a gift.
        amount:
          priced.length === 0
            ? undefined
            : sumMoney(
                priced.map((line) => ({
                  cents: Math.round((line.pricePerLb as Money).cents * line.pounds),
                })),
              ),
        direction: "received",
        detail: bought.map((line) => line.cut).join(", "),
      });
    }
  }

  for (const record of sources.feedPurchases) {
    if (record.vendorContactId !== contactId) continue;
    links.push({
      kind: "feed_purchase",
      recordId: record.id,
      date: record.purchasedOn,
      amount: { cents: Math.round(record.unitCost.cents * record.quantity) },
      direction: "paid",
      detail: `${record.quantity} ×`,
    });
  }

  for (const record of sources.candidates) {
    if (record.sellerId !== contactId) continue;
    links.push({
      kind: "candidate",
      recordId: record.id,
      // A listing's own date is when we first saw it, not when the row was
      // written — a candidate entered from a photo taken last month belongs
      // where it happened.
      date: record.firstSeen,
      amount: record.askingPrice,
      direction: "none",
      detail: record.title,
    });
  }

  return links.sort((left, right) => right.date.getTime() - left.date.getTime());
}

export interface ContactLedger {
  /** What the farm has paid them. */
  readonly paid: Money;
  /** What they have paid the farm. */
  readonly received: Money;
  /** Received minus paid, from the farm's side. */
  readonly net: Money;
  /**
   * Links that moved money but never said how much.
   *
   * Surfaced rather than swallowed: a vet bill with no cost on it makes this
   * total a floor, and a screen that presented it as the answer would be
   * confidently wrong.
   */
  readonly unpriced: number;
}

export function contactLedger(links: readonly ContactLink[]): ContactLedger {
  const paid = sumMoney(
    links.filter((link) => link.direction === "paid").map((link) => link.amount ?? { cents: 0 }),
  );
  const received = sumMoney(
    links
      .filter((link) => link.direction === "received")
      .map((link) => link.amount ?? { cents: 0 }),
  );

  return {
    paid,
    received,
    net: { cents: received.cents - paid.cents },
    unpriced: links.filter((link) => link.direction !== "none" && link.amount === undefined).length,
  };
}

/** How many of each kind, for the summary line under a contact's name. */
export function linkCounts(links: readonly ContactLink[]): Map<ContactLinkKind, number> {
  const counts = new Map<ContactLinkKind, number>();
  for (const link of links) counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);
  return counts;
}

/**
 * Which contacts are still safe to delete outright.
 *
 * §4.5 clause 3 wants the dialog to name what else is affected, and the
 * dependents of a contact are every record pointing at them by id. Nothing
 * cascades — a sale whose buyer was deleted is still a sale — so the effect is
 * always `detached`, and the count is what the dialog says out loud.
 */
export function referenceCount(contactId: Ulid, sources: ContactLinkSources): number {
  return linkedHistory(contactId, sources).length;
}
