"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  CardGrid,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Select,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  CONTACT_TAGS,
  contactSchema,
  emergencyContacts,
  primaryPhone,
  type Contact,
  type ContactTag,
  type CrudError,
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
import type { FeedPurchase } from "@galaxy-farm/module-feed";

import { ContactDetail } from "@/app/(admin)/admin/contacts/_components/contact-detail";
import {
  BLANK_CONTACT,
  ContactForm,
  TAG_LABELS,
  contactFields,
  draftFrom,
  type ContactDraft,
} from "@/app/(admin)/admin/contacts/_components/contact-form";
import { referenceCount } from "@/lib/contact-links";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Contacts (spec §5.1, §7 `/admin/contacts`).
 *
 * One CRM for everyone the farm touches, tagged rather than split into
 * separate vet, buyer and vendor lists — §5.1 is explicit about why: the
 * hauler is often also the neighbour who buys a steer, and three tables lose
 * that connection the moment somebody is entered twice.
 *
 * Cards rather than a table. The question this screen answers is almost always
 * "what is the vet's number", which wants a name, a tag, and a tappable phone
 * number in one glance — not eleven columns of which nine are empty.
 */

/** Everything that points at a contact, for the delete dialog. */
function useReferences(propertyId: Ulid) {
  const query = { propertyId };
  return {
    acquisitions: useRecords<AcquisitionRecord>("acquisitionRecords", query).records,
    sales: useRecords<SaleRecord>("saleRecords", query).records,
    treatments: useRecords<HealthRecord>("healthRecords", query).records,
    breedings: useRecords<BreedingRecord>("breedingRecords", query).records,
    processing: useRecords<ProcessingRecord>("processingRecords", query).records,
    feedPurchases: useRecords<FeedPurchase>("feedPurchases", query).records,
    candidates: useRecords<PurchaseCandidate>("purchaseCandidates", query).records,
  };
}

export function ContactsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: contacts, loading } = useRecords<Contact>("contacts", { propertyId });
  const references = useReferences(propertyId);

  const mutations = useMutations<Contact>(
    "contacts",
    "contacts",
    contactSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [draft, setDraft] = useState<ContactDraft | undefined>();
  const [editing, setEditing] = useState<Contact | undefined>();
  const [opened, setOpened] = useState<Contact | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const needle = search.trim().toLowerCase();
  const shown = contacts
    .filter((contact) => tagFilter === "" || contact.tags.includes(tagFilter as ContactTag))
    .filter(
      (contact) =>
        needle === "" ||
        contact.name.toLowerCase().includes(needle) ||
        (contact.company ?? "").toLowerCase().includes(needle) ||
        contact.phones.some((phone) => phone.number.toLowerCase().includes(needle)) ||
        contact.emails.some((email) => email.address.toLowerCase().includes(needle)),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const emergency = emergencyContacts(contacts);
  const vets = contacts.filter((contact) => contact.tags.includes("vet"));
  const untagged = contacts.filter((contact) => contact.tags.length === 0);

  /**
   * The record the modal is showing, re-read from the live list.
   *
   * `opened` is a snapshot taken when the card was tapped. Editing writes a new
   * record, and a modal still holding the old one would show the previous phone
   * number under a toast saying it was saved.
   */
  const current = opened === undefined ? undefined : contacts.find((held) => held.id === opened.id);

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  function startAdd() {
    setEditing(undefined);
    setDraft(BLANK_CONTACT);
    setErrors({});
  }

  function startEdit(contact: Contact) {
    setEditing(contact);
    setDraft(draftFrom(contact));
    setErrors({});
  }

  function closeForm() {
    setDraft(undefined);
    setEditing(undefined);
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});
    setBusy(true);

    try {
      const fields = contactFields(draft);
      const result =
        editing === undefined
          ? await mutations.create(fields as never)
          : await mutations.update(editing.id, fields as Partial<Contact>);

      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({
        message: editing === undefined ? `${fields.name} added` : `${fields.name} saved`,
        tone: "success",
      });
      closeForm();
    } finally {
      setBusy(false);
    }
  }

  async function remove(contact: Contact) {
    const references_ = referenceCount(contact.id, references);

    const confirmed = await confirmDelete({
      // A contact is an aggregate root and the thing sales, treatments and
      // purchases point at by id (§4.5 clause 3).
      tier: "typed",
      recordName: contact.name,
      entity: "contact",
      // Nothing cascades: a sale whose buyer was deleted is still a sale, and
      // it keeps its price. What it loses is the name on the other side.
      dependents:
        references_ === 0
          ? []
          : [
              {
                entity: "Record",
                label: `${references_} record${references_ === 1 ? "" : "s"} naming them`,
                effect: "detached" as const,
              },
            ],
      consequence: contact.tags.includes("emergency")
        ? "They are an emergency contact, so they come off the housesitter guide too. Restorable from Trash."
        : "Restorable from Trash for 30 days.",
    });
    if (!confirmed) return;

    const result = await mutations.remove(contact.id);
    if (!result.ok) {
      show({ message: "Could not delete that contact", tone: "danger" });
      return;
    }

    if (opened?.id === contact.id) setOpened(undefined);
    show({
      message: `${contact.name} deleted`,
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(contact.id) },
    });
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="People & places"
        title="Contacts"
        subtitle="Vets, techs, haulers, buyers, vendors and neighbours — one list, tagged by what they are to the farm."
        actions={
          <Button variant="primary" onClick={startAdd}>
            Add somebody
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Contacts" value={contacts.length} tone="identity" />
        <Tile
          label="Vets"
          value={vets.length}
          tone={vets.length === 0 ? "danger" : "neutral"}
          hint={vets.length === 0 ? "Nobody to call" : undefined}
        />
        <Tile
          label="Emergency"
          value={emergency.length}
          tone={emergency.length === 0 ? "danger" : "calm"}
          emphasis={emergency.length === 0}
          hint="On the housesitter guide"
        />
        <Tile
          label="Untagged"
          value={untagged.length}
          tone={untagged.length > 0 ? "action" : "neutral"}
          hint={untagged.length > 0 ? "No filter will find them" : "All filed"}
        />
      </div>

      {emergency.length > 0 || contacts.length === 0 ? null : (
        <Callout tone="danger" title="No emergency contact">
          The housesitter guide takes its emergency numbers from this list. Until somebody here is
          tagged <em>Emergency</em>, that section of the guide is empty — which is the one section
          nobody can afford to be looking for.
        </Callout>
      )}

      <Section
        title="Everyone"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <TextInput
              label="Search"
              hideLabel
              type="search"
              placeholder="Name, company, number"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              label="Tag"
              hideLabel
              value={tagFilter}
              options={[
                { value: "", label: "Every tag" },
                ...CONTACT_TAGS.map((tag) => ({ value: tag, label: TAG_LABELS[tag] })),
              ]}
              onChange={(event) => setTagFilter(event.target.value)}
            />
          </div>
        }
      >
        {loading ? (
          <p className="text-muted">Loading contacts…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            title={contacts.length === 0 ? "Nobody yet" : "Nobody matches"}
            detail={
              contacts.length === 0
                ? "The vet, the AI tech, the feed store, the hauler, the neighbour who takes half a steer. Everything else in the app points at this list by name."
                : "Try a different tag, or clear the search."
            }
            {...(contacts.length === 0
              ? { action: <Button onClick={startAdd}>Add the first one</Button> }
              : {})}
          />
        ) : (
          <CardGrid columns={3}>
            {shown.map((contact) => (
              <RecordCard
                key={contact.id}
                title={contact.name}
                subtitle={contact.company}
                tone={contact.tags.includes("emergency") ? "danger" : "neutral"}
                meta={
                  contact.tags.length === 0 ? (
                    <Pill tone="action">untagged</Pill>
                  ) : (
                    contact.tags.map((tag) => (
                      <Pill key={tag} tone={tag === "emergency" ? "danger" : "neutral"}>
                        {TAG_LABELS[tag]}
                      </Pill>
                    ))
                  )
                }
                actions={
                  <span className="flex gap-1">
                    <Button variant="ghost" onClick={() => setOpened(contact)}>
                      Open
                    </Button>
                    <Button variant="ghost" onClick={() => startEdit(contact)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(contact)}>
                      Delete
                    </Button>
                  </span>
                }
              >
                <ul className="flex flex-col gap-1 text-sm">
                  <li>
                    {primaryPhone(contact) === undefined ? (
                      <span className="text-muted">No number</span>
                    ) : (
                      <a className="text-action underline" href={`tel:${primaryPhone(contact)}`}>
                        {primaryPhone(contact)}
                      </a>
                    )}
                  </li>
                  {contact.emails[0] === undefined ? null : (
                    <li>
                      <a
                        className="text-action underline"
                        href={`mailto:${contact.emails[0].address}`}
                      >
                        {contact.emails[0].address}
                      </a>
                    </li>
                  )}
                  {contact.notes === undefined ? null : (
                    <li className="line-clamp-2 text-muted">{contact.notes}</li>
                  )}
                </ul>
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>

      {draft === undefined ? null : (
        <Modal
          size="wide"
          title={editing === undefined ? "Add somebody" : `Editing ${editing.name}`}
          description="One record per person, however many ways the farm deals with them."
          onClose={closeForm}
          footer={
            <div className="flex gap-2">
              <Button variant="primary" busy={busy} onClick={() => void save()}>
                {editing === undefined ? "Add them" : "Save changes"}
              </Button>
              <Button onClick={closeForm}>Cancel</Button>
            </div>
          }
        >
          <ContactForm draft={draft} errors={errors} onChange={setDraft} />
        </Modal>
      )}

      {current === undefined ? null : (
        <Modal
          key={current.id}
          size="wide"
          title={current.name}
          description={current.company ?? "Everything the farm has recorded with them."}
          onClose={() => setOpened(undefined)}
          footer={
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setOpened(undefined);
                  startEdit(current);
                }}
              >
                Edit
              </Button>
              <Button onClick={() => setOpened(undefined)}>Close</Button>
            </div>
          }
        >
          <ContactDetail contact={current} propertyId={propertyId} />
        </Modal>
      )}
    </PageBody>
  );
}
