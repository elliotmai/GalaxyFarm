import { z } from "zod";

import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * A polymorphic file link — registration papers, manuals, receipts, signed
 * forms, inspection reports (spec §5.1). The bytes live in R2; this is the
 * record that says what they are and what they belong to.
 */

export interface Attachment extends BaseRecord {
  /** Entity name, e.g. `Animal`, `Equipment`, `PurchaseCandidate`. */
  readonly ownerEntity: string;
  readonly ownerId: Ulid;
  readonly key: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly caption?: string | undefined;
  /**
   * False until the upload reaches R2. Records store the key immediately and
   * render a placeholder, so photographing a calf with no signal still works
   * (§4.2).
   */
  readonly uploaded: boolean;
}

export const attachmentSchema = baseRecordSchema.extend({
  ownerEntity: z.string().min(1).max(60),
  ownerId: ulidSchema,
  key: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  bytes: z.number().int().nonnegative(),
  caption: z.string().max(500).optional(),
  uploaded: z.boolean(),
}) as unknown as z.ZodType<Attachment>;

export function isImage(attachment: Pick<Attachment, "contentType">): boolean {
  return attachment.contentType.startsWith("image/");
}

/** Attachments still waiting on a connection — what the sync engine drains. */
export function pendingUploads(attachments: readonly Attachment[]): Attachment[] {
  return attachments.filter((attachment) => !attachment.uploaded);
}
