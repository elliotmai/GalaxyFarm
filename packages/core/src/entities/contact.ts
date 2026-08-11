import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * One CRM for everyone the farm touches (spec §5.1).
 *
 * Deliberately a single entity with tags rather than separate Vet, Buyer, and
 * Vendor tables — the hauler is often also the neighbour who buys a steer, and
 * splitting that person into three records loses the connection.
 */

export const CONTACT_TAGS = [
  "vet",
  "ai_tech",
  "customer",
  "buyer",
  "seller",
  "feed_vendor",
  "supply_vendor",
  "processor",
  "hauler",
  "emergency",
  "friend_family",
] as const;
export type ContactTag = (typeof CONTACT_TAGS)[number];

export interface PhoneNumber {
  readonly label: string;
  readonly number: string;
}

export interface EmailAddress {
  readonly label: string;
  readonly address: string;
}

export interface Contact extends BaseRecord {
  readonly name: string;
  readonly company?: string | undefined;
  readonly tags: readonly ContactTag[];
  readonly phones: readonly PhoneNumber[];
  readonly emails: readonly EmailAddress[];
  readonly address?: string | undefined;
  readonly notes?: string | undefined;
}

export const contactSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A contact needs a name").max(120),
  company: z.string().max(120).optional(),
  tags: z.array(z.enum(CONTACT_TAGS)),
  phones: z.array(z.object({ label: z.string().max(40), number: z.string().min(3).max(40) })),
  emails: z.array(z.object({ label: z.string().max(40), address: z.string().email() })),
  address: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<Contact>;

/**
 * The emergency-tagged subset auto-populates the housesitter guide (§5.1), so
 * nobody retypes the vet's number into a document that then goes stale.
 */
export function emergencyContacts(contacts: readonly Contact[]): Contact[] {
  return contacts.filter((contact) => contact.tags.includes("emergency"));
}

export function hasTag(contact: Pick<Contact, "tags">, tag: ContactTag): boolean {
  return contact.tags.includes(tag);
}

export function primaryPhone(contact: Pick<Contact, "phones">): string | undefined {
  return contact.phones[0]?.number;
}
