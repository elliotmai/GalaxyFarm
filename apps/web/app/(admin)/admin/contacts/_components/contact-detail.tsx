"use client";

import {
  Badge,
  Card,
  DataTable,
  DetailList,
  EmptyState,
  Pill,
  Section,
  Stat,
  StatRow,
  type Column,
} from "@galaxy-farm/ui";
import {
  displayName,
  formatMoney,
  type Animal,
  type Contact,
  type PurchaseCandidate,
  type Ulid,
} from "@galaxy-farm/core";
import type {
  AcquisitionRecord,
  BreedingRecord,
  HealthRecord,
  ProcessingRecord,
  SaleRecord,
} from "@galaxy-farm/module-cattle";
import type { FeedPurchase, FeedType } from "@galaxy-farm/module-feed";

import {
  contactLedger,
  linkedHistory,
  type ContactLink,
  type ContactLinkKind,
} from "@/lib/contact-links";
import { TAG_LABELS } from "@/app/(admin)/admin/contacts/_components/contact-form";
import { useRecords } from "@/lib/local/use-records";

/**
 * One contact, and everything the farm has done with them (spec §5.1).
 *
 * The history is read here rather than on the list screen, and that is the
 * point of the component existing at all: seven live queries over records
 * nobody is looking at would run on a screen whose usual job is to find a
 * phone number. Mounted only when a card is opened, they cost nothing until
 * somebody asks.
 */

const KIND_LABELS: Readonly<Record<ContactLinkKind, string>> = {
  acquisition: "Bought from them",
  sale: "Sold to them",
  treatment: "Treatment",
  breeding: "Bred",
  processing: "Processing",
  cut_sale: "Cuts sold",
  feed_purchase: "Feed",
  candidate: "Listing",
};

const KIND_TONES: Readonly<Record<ContactLinkKind, "neutral" | "action" | "calm" | "identity">> = {
  acquisition: "action",
  sale: "calm",
  treatment: "identity",
  breeding: "identity",
  processing: "neutral",
  cut_sale: "calm",
  feed_purchase: "action",
  candidate: "neutral",
};

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ContactDetail({
  contact,
  propertyId,
}: {
  readonly contact: Contact;
  readonly propertyId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: acquisitions } = useRecords<AcquisitionRecord>("acquisitionRecords", query);
  const { records: sales } = useRecords<SaleRecord>("saleRecords", query);
  const { records: treatments } = useRecords<HealthRecord>("healthRecords", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: processing } = useRecords<ProcessingRecord>("processingRecords", query);
  const { records: feedPurchases } = useRecords<FeedPurchase>("feedPurchases", query);
  const { records: feedTypes } = useRecords<FeedType>("feedTypes", query);
  const { records: candidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);

  const links = linkedHistory(contact.id, {
    acquisitions,
    sales,
    treatments,
    breedings,
    processing,
    feedPurchases,
    candidates,
  });
  const ledger = contactLedger(links);

  const animalName = (id: Ulid | undefined) => {
    if (id === undefined) return undefined;
    const animal = animals.find((held) => held.id === id);
    return animal === undefined ? "an animal since deleted" : displayName(animal);
  };

  /**
   * A feed purchase names a feed, not an animal.
   *
   * Resolved here rather than in `linkedHistory`, which deliberately knows
   * nothing about what a record points at — it returns ids, and naming them is
   * the screen's job.
   */
  const feedName = (link: ContactLink) => {
    if (link.kind !== "feed_purchase") return undefined;
    const purchase = feedPurchases.find((held) => held.id === link.recordId);
    return feedTypes.find((type) => type.id === purchase?.feedTypeId)?.name ?? "a feed";
  };

  const columns: readonly Column<ContactLink>[] = [
    { key: "date", header: "Date", render: (link) => formatDate(link.date) },
    {
      key: "kind",
      header: "What",
      render: (link) => <Badge tone={KIND_TONES[link.kind]}>{KIND_LABELS[link.kind]}</Badge>,
    },
    {
      key: "subject",
      header: "Concerning",
      render: (link) =>
        animalName(link.animalId) ??
        (feedName(link) === undefined ? "—" : `${link.detail ?? ""} ${feedName(link)}`.trim()),
    },
    {
      key: "detail",
      header: "Detail",
      render: (link) => (link.kind === "feed_purchase" ? "—" : (link.detail ?? "—")),
    },
    {
      key: "amount",
      header: "Amount",
      render: (link) => {
        if (link.amount === undefined) return <span className="text-muted">not priced</span>;
        return (
          <span className={link.direction === "received" ? "text-calm" : undefined}>
            {link.direction === "paid" ? "−" : link.direction === "received" ? "+" : ""}
            {formatMoney(link.amount)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <DetailList
        items={[
          { label: "Company", value: contact.company ?? "—" },
          { label: "Address", value: contact.address ?? "—" },
          {
            label: "Phones",
            value:
              contact.phones.length === 0 ? (
                "—"
              ) : (
                <ul className="flex flex-col gap-1">
                  {contact.phones.map((phone) => (
                    <li key={`${phone.label}-${phone.number}`}>
                      <a className="text-action underline" href={`tel:${phone.number}`}>
                        {phone.number}
                      </a>
                      {phone.label === "" ? null : (
                        <span className="text-muted"> · {phone.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            label: "Emails",
            value:
              contact.emails.length === 0 ? (
                "—"
              ) : (
                <ul className="flex flex-col gap-1">
                  {contact.emails.map((email) => (
                    <li key={`${email.label}-${email.address}`}>
                      <a className="text-action underline" href={`mailto:${email.address}`}>
                        {email.address}
                      </a>
                      {email.label === "" ? null : (
                        <span className="text-muted"> · {email.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            label: "Tagged",
            value:
              contact.tags.length === 0 ? (
                "—"
              ) : (
                <span className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Pill key={tag} tone={tag === "emergency" ? "danger" : "neutral"}>
                      {TAG_LABELS[tag]}
                    </Pill>
                  ))}
                </span>
              ),
            wide: true,
          },
          ...(contact.notes === undefined
            ? []
            : [{ label: "Notes", value: contact.notes, wide: true }]),
        ]}
      />

      <Section
        title="History"
        description="Every record on the farm that names them. Nothing is typed here — it is what the rest of the app already knows."
      >
        {links.length === 0 ? (
          <EmptyState
            title="Nothing recorded with them yet"
            detail="Sales, treatments, breedings, processing and feed purchases show up here as soon as one names this contact."
          />
        ) : (
          <div className="flex flex-col gap-density">
            <StatRow>
              <Stat label="What we have paid them" value={formatMoney(ledger.paid)} />
              <Stat label="What they have paid us" value={formatMoney(ledger.received)} />
              <Stat
                label="Net"
                value={formatMoney(ledger.net)}
                emphasis
                hint={
                  ledger.unpriced === 0
                    ? undefined
                    : `${ledger.unpriced} record${ledger.unpriced === 1 ? "" : "s"} with no figure on it, so this is a floor`
                }
              />
            </StatRow>

            <Card>
              <DataTable
                caption={`Everything recorded with ${contact.name}`}
                columns={columns}
                rows={links}
                rowKey={(link) => `${link.kind}-${link.recordId}`}
              />
            </Card>
          </div>
        )}
      </Section>
    </div>
  );
}
