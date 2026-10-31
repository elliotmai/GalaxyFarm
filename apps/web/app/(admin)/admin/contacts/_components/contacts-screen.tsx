"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Select,
  TextInput,
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
 * A list of rows rather than cards or a table. The question this screen
 * answers is almost always "what is the vet's number", which wants a name, one
 * line, and a phone button in one glance — not eleven columns of which nine are
 * empty, nor a card of labelled pairs per person. Everything else about them,
 * including edit and delete, is in the panel the row opens.
 */

/**
 * The tags people actually filter by, as chips. The rest are one Filters
 * press away — eleven chips in a row is a second list to scan before the first.
 */
const CHIP_TAGS: readonly ContactTag[] = ["vet", "emergency", "ai_tech", "hauler", "buyer"];

/** The filter value for "nobody has tagged them yet". */
const UNTAGGED = "untagged";

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shown = contacts
    .filter((contact) =>
      tagFilter === ""
        ? true
        : tagFilter === UNTAGGED
          ? contact.tags.length === 0
          : contact.tags.includes(tagFilter as ContactTag),
    )
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

  /** What the list is narrowed to, in words — said above the list whenever it is. */
  const filterLabel =
    tagFilter === ""
      ? undefined
      : tagFilter === UNTAGGED
        ? "Untagged"
        : TAG_LABELS[tagFilter as ContactTag];
  const narrowed = filterLabel !== undefined || needle !== "";

  function clearFilters() {
    setTagFilter("");
    setSearch("");
  }

  /** The one muted line under a name: who they are with, what they are, how to reach them. */
  function lineFor(contact: Contact): string {
    return [
      contact.company,
      // Emergency is the row's chip, so it is not said twice.
      contact.tags
        .filter((tag) => tag !== "emergency")
        .map((tag) => TAG_LABELS[tag])
        .join(", "),
      primaryPhone(contact),
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" · ");
  }

  const chips = [
    { key: "", label: "All" },
    ...CHIP_TAGS.map((tag) => ({ key: tag as string, label: TAG_LABELS[tag] })),
    // Only offered while somebody is untagged: a chip that always finds no one
    // is a control that teaches people to ignore the row.
    ...(untagged.length === 0 ? [] : [{ key: UNTAGGED, label: `Untagged ${untagged.length}` }]),
  ];

  return (
    // Bottom clearance on a phone, so the floating add button never sits on
    // the last row.
    <div className="pb-20 sm:pb-0">
      <PageBody>
        <PageHeader
          title="Contacts"
          subtitle={`${contacts.length} ${contacts.length === 1 ? "person" : "people"} · ${vets.length} ${vets.length === 1 ? "vet" : "vets"} · ${emergency.length} emergency`}
          actions={
            // Hidden on a phone by a wrapper, not a class on the button: the
            // button's own `inline-flex` wins over a `hidden` passed in.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={startAdd}>
                <span aria-hidden="true">+</span> Add contact
              </Button>
            </span>
          }
        />

        {/*
          The two gaps worth saying, one line each, and only when they are
          true. The housesitter guide takes its emergency numbers from this
          list, so an empty Emergency tag is an empty section in the one place
          nobody can afford to be looking for a number.
        */}
        {contacts.length === 0 ? null : (
          <>
            {emergency.length > 0 ? null : (
              <p className="text-sm text-danger">
                No emergency contact — the housesitter guide has no numbers to call.
              </p>
            )}
            {vets.length > 0 ? null : <p className="text-sm text-danger">No vet on the list.</p>}
          </>
        )}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              label="Search"
              hideLabel
              type="search"
              placeholder="Name, company, number"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
            Filters
          </Button>
        </div>

        {/* One row that scrolls sideways on a phone, because a row that wraps
            pushes the list down. Pressing the chip already on clears it. */}
        <div
          role="group"
          aria-label="Filter by tag"
          className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
        >
          {chips.map((chip) => {
            const on = tagFilter === chip.key;
            return (
              <button
                key={chip.key === "" ? "all" : chip.key}
                type="button"
                aria-pressed={on}
                onClick={() => setTagFilter(on ? "" : chip.key)}
                className={[
                  "inline-flex min-h-target shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-sm",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                  on
                    ? "bg-action/15 font-semibold text-action"
                    : "font-medium text-muted hover:bg-raised hover:text-ink",
                ].join(" ")}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* A narrowed list that does not say so is a vet who seems not to exist. */}
        {!narrowed ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
            <span>
              Showing {shown.length} of {contacts.length}
            </span>
            {filterLabel === undefined ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{filterLabel}</span>
              </>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </p>
        )}

        {loading ? (
          <p className="text-muted">Loading contacts…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            title={contacts.length === 0 ? "Nobody yet" : "Nobody matches"}
            detail={
              contacts.length === 0
                ? "The vet, the AI tech, the feed store, the hauler. Everything else in the app points at this list."
                : undefined
            }
            action={
              contacts.length === 0 ? (
                <Button variant="primary" onClick={startAdd}>
                  Add the first one
                </Button>
              ) : (
                <Button onClick={clearFilters}>Clear filters</Button>
              )
            }
          />
        ) : (
          <ul
            aria-label="Contacts"
            className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
          >
            {shown.map((contact) => {
              const phone = primaryPhone(contact);
              const line = lineFor(contact);
              return (
                <li key={contact.id} className="flex items-center bg-panel">
                  {/* The whole row opens them: the name alone is too small a
                      target for a thumb in a glove. */}
                  <button
                    type="button"
                    onClick={() => setOpened(contact)}
                    className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-semibold">{contact.name}</span>
                      {line === "" ? null : (
                        <span className="truncate text-sm text-muted">{line}</span>
                      )}
                    </span>
                    {contact.tags.includes("emergency") ? (
                      <Pill tone="danger">Emergency</Pill>
                    ) : contact.tags.length === 0 ? (
                      <Pill tone="action">Untagged</Pill>
                    ) : null}
                  </button>
                  {/* Beside the row rather than inside it — a link nested in a
                      button is two targets the browser has to guess between.
                      Calling is the job this screen exists for. */}
                  {phone === undefined ? (
                    <span aria-hidden="true" className="mr-1 min-w-target" />
                  ) : (
                    <a
                      href={`tel:${phone}`}
                      aria-label={`Call ${contact.name}`}
                      className="mr-1 inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-action"
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                      </svg>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>

      {/* On a phone the add button floats where a thumb already is, clear of
          the tab bar. A plain button: its shape and shadow are its own. */}
      <button
        type="button"
        onClick={startAdd}
        className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        Add contact
      </button>

      {filtersOpen ? (
        <Modal
          title="Filters"
          placement="side"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <Button variant="primary" onClick={() => setFiltersOpen(false)}>
                Show {shown.length}
              </Button>
              {tagFilter === "" ? null : (
                <Button variant="ghost" onClick={() => setTagFilter("")}>
                  Clear filters
                </Button>
              )}
            </>
          }
        >
          <Select
            label="Tag"
            value={tagFilter}
            options={[
              { value: "", label: "Every tag" },
              ...CONTACT_TAGS.map((tag) => ({ value: tag, label: TAG_LABELS[tag] })),
              { value: UNTAGGED, label: "Untagged" },
            ]}
            onChange={(event) => setTagFilter(event.target.value)}
          />
        </Modal>
      ) : null}

      {draft === undefined ? null : (
        <Modal
          placement="side"
          title={editing === undefined ? "Add a contact" : `Editing ${editing.name}`}
          onClose={closeForm}
          footer={
            <>
              <Button variant="primary" busy={busy} onClick={() => void save()}>
                {editing === undefined ? "Add them" : "Save changes"}
              </Button>
              <Button onClick={closeForm}>Cancel</Button>
              {editing === undefined ? null : (
                // The form closes first, so the typed confirmation is the only
                // dialog on screen rather than a second one stacked on this.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const contact = editing;
                    closeForm();
                    void remove(contact);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <ContactForm draft={draft} errors={errors} onChange={setDraft} />
        </Modal>
      )}

      {current === undefined ? null : (
        <Modal
          key={current.id}
          placement="side"
          title={current.name}
          description={current.company}
          onClose={() => setOpened(undefined)}
          footer={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setOpened(undefined);
                  startEdit(current);
                }}
              >
                Edit
              </Button>
              <Button onClick={() => setOpened(undefined)}>Close</Button>
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  // Closed first, so the confirmation is not stacked on it.
                  setOpened(undefined);
                  void remove(current);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <ContactDetail contact={current} propertyId={propertyId} />
        </Modal>
      )}
    </div>
  );
}
