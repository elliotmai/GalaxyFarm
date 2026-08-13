"use client";

import { Button, Checkbox, TextArea, TextInput } from "@galaxy-farm/ui";
import { CONTACT_TAGS, type Contact, type ContactTag } from "@galaxy-farm/core";

/**
 * The one form, used to add and to correct (spec §4.5 clause 1).
 *
 * Shared rather than written twice: an edit form that has drifted from the
 * create form is how a field ends up enterable and uncorrectable, which is the
 * exact shape of §4.5's "no record that can only be fixed by opening a SQL
 * client".
 *
 * Phones and emails are lists because people have more than one and the labels
 * matter — "cell", "office", "the barn phone that nobody answers". A single
 * text box holding "555-1234 / 555-9876 (office)" is a field no screen can dial
 * and no report can group.
 */

export const TAG_LABELS: Readonly<Record<ContactTag, string>> = {
  vet: "Vet",
  ai_tech: "AI tech",
  customer: "Customer",
  buyer: "Buyer",
  seller: "Seller",
  feed_vendor: "Feed vendor",
  supply_vendor: "Supply vendor",
  processor: "Processor",
  hauler: "Hauler",
  emergency: "Emergency",
  friend_family: "Friend / family",
};

export interface LabelledValue {
  readonly label: string;
  readonly value: string;
}

export interface ContactDraft {
  readonly name: string;
  readonly company: string;
  readonly tags: readonly ContactTag[];
  readonly phones: readonly LabelledValue[];
  readonly emails: readonly LabelledValue[];
  readonly address: string;
  readonly notes: string;
}

export const BLANK_CONTACT: ContactDraft = {
  name: "",
  company: "",
  tags: [],
  phones: [{ label: "Cell", value: "" }],
  emails: [],
  address: "",
  notes: "",
};

export function draftFrom(contact: Contact): ContactDraft {
  return {
    name: contact.name,
    company: contact.company ?? "",
    tags: contact.tags,
    phones: contact.phones.map((phone) => ({ label: phone.label, value: phone.number })),
    emails: contact.emails.map((email) => ({ label: email.label, value: email.address })),
    address: contact.address ?? "",
    notes: contact.notes ?? "",
  };
}

/**
 * The draft, as the schema wants it.
 *
 * Rows left blank are dropped rather than saved empty — a person adds a second
 * phone row, thinks better of it, and saves; storing `{label: "", number: ""}`
 * would put a nameless blank line on their card forever.
 *
 * Cleared text fields travel as an explicit `undefined` rather than being left
 * out. On an edit, a field the patch never mentions keeps its old value, so a
 * company somebody deleted would come straight back.
 */
export function contactFields(draft: ContactDraft) {
  const text = (value: string) => (value.trim() === "" ? undefined : value.trim());

  return {
    name: draft.name.trim(),
    company: text(draft.company),
    tags: [...draft.tags],
    phones: draft.phones
      .filter((phone) => phone.value.trim() !== "")
      .map((phone) => ({ label: phone.label.trim(), number: phone.value.trim() })),
    emails: draft.emails
      .filter((email) => email.value.trim() !== "")
      .map((email) => ({ label: email.label.trim(), address: email.value.trim() })),
    address: text(draft.address),
    notes: text(draft.notes),
  };
}

export function ContactForm({
  draft,
  errors,
  onChange,
}: {
  readonly draft: ContactDraft;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (next: ContactDraft) => void;
}) {
  const toggleTag = (tag: ContactTag) =>
    onChange({
      ...draft,
      tags: draft.tags.includes(tag)
        ? draft.tags.filter((held) => held !== tag)
        : [...draft.tags, tag],
    });

  return (
    <div className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
        <TextInput
          label="Name"
          required
          value={draft.name}
          error={errors["name"]}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <TextInput
          label="Company"
          hint="The practice, the feed store, the sale barn."
          value={draft.company}
          error={errors["company"]}
          onChange={(event) => onChange({ ...draft, company: event.target.value })}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">What they are to the farm</legend>
        <p className="text-sm text-muted">
          More than one is normal. Anyone tagged <em>Emergency</em> is picked up by the housesitter
          guide automatically.
        </p>
        <div className="grid grid-cols-2 gap-x-density sm:grid-cols-3 lg:grid-cols-4">
          {CONTACT_TAGS.map((tag) => (
            <Checkbox
              key={tag}
              label={TAG_LABELS[tag]}
              checked={draft.tags.includes(tag)}
              onChange={() => toggleTag(tag)}
            />
          ))}
        </div>
        {errors["tags"] === undefined ? null : (
          <p className="text-sm text-danger">{errors["tags"]}</p>
        )}
      </fieldset>

      <RowEditor
        legend="Phone numbers"
        addLabel="Add a number"
        valueLabel="Number"
        valueType="tel"
        defaultRowLabel="Other"
        rows={draft.phones}
        error={errors["phones"]}
        onChange={(phones) => onChange({ ...draft, phones })}
      />

      <RowEditor
        legend="Email addresses"
        addLabel="Add an address"
        valueLabel="Address"
        valueType="email"
        defaultRowLabel="Email"
        rows={draft.emails}
        error={errors["emails"]}
        onChange={(emails) => onChange({ ...draft, emails })}
      />

      <TextInput
        label="Address"
        value={draft.address}
        error={errors["address"]}
        onChange={(event) => onChange({ ...draft, address: event.target.value })}
      />

      <TextArea
        label="Notes"
        rows={3}
        hint="Whatever you would otherwise have to remember. Gate codes, who to ask for, what they charge."
        value={draft.notes}
        error={errors["notes"]}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
      />
    </div>
  );
}

/**
 * A list of labelled values, added to and taken away from in place.
 *
 * Removing a row asks nothing. §4.5 clause 3 covers deletions somebody cannot
 * walk back, and this one is not saved until the form is — making it ask twice
 * would teach people to click through the dialogs that matter.
 */
function RowEditor({
  legend,
  addLabel,
  valueLabel,
  valueType,
  defaultRowLabel,
  rows,
  error,
  onChange,
}: {
  readonly legend: string;
  readonly addLabel: string;
  readonly valueLabel: string;
  readonly valueType: "tel" | "email";
  readonly defaultRowLabel: string;
  readonly rows: readonly LabelledValue[];
  readonly error?: string | undefined;
  readonly onChange: (next: LabelledValue[]) => void;
}) {
  const update = (index: number, patch: Partial<LabelledValue>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">{legend}</legend>

      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr]">
            <TextInput
              label="Label"
              hideLabel
              placeholder="Cell, office, after hours"
              value={row.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <TextInput
              label={valueLabel}
              hideLabel
              type={valueType}
              placeholder={valueLabel}
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />
          </div>
          <Button
            variant="ghost"
            type="button"
            aria-label={`Remove this ${valueLabel.toLowerCase()}`}
            // crud-guard: allow-unconfirmed — a row out of an unsaved form
            onClick={() => onChange(rows.filter((_, at) => at !== index))}
          >
            ×
          </Button>
        </div>
      ))}

      {error === undefined ? null : <p className="text-sm text-danger">{error}</p>}

      <div>
        <Button
          type="button"
          onClick={() => onChange([...rows, { label: defaultRowLabel, value: "" }])}
        >
          {addLabel}
        </Button>
      </div>
    </fieldset>
  );
}
