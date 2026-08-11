import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The business scaffold (spec §5.7): full schema and rules now, UI in Phase 5.
 *
 * Schemas land years before the screens because the entities they describe are
 * referenced by things that are not Phase 5. A ProgramEnrollment is the clearest
 * case — §5.7 decouples the training programme from ownership, so your own show
 * calves run through the identical pipeline, and the roster is your real
 * capacity picture whether or not a customer ever books.
 */

export const BOOKING_STATUSES = ["requested", "approved", "declined", "withdrawn"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PROGRAM_PACKAGES = [
  "halter_breaking",
  "hair_growing",
  "showing_service",
  "clipping",
  "hauling",
] as const;
export type ProgramPackage = (typeof PROGRAM_PACKAGES)[number];

/** §12 decision 15: every enrolled calf has a halter colour, and it is black. */
export const DEFAULT_HALTER_COLOR = "#000000";

export interface Customer extends BaseRecord {
  readonly contactId: Ulid;
  readonly userId?: Ulid | undefined;
  readonly quickBooksCustomerId?: string | undefined;
  readonly active: boolean;
}

export const customerSchema = baseRecordSchema.extend({
  contactId: ulidSchema,
  userId: ulidSchema.optional(),
  quickBooksCustomerId: z.string().max(60).optional(),
  active: z.boolean(),
}) as unknown as z.ZodType<Customer>;

export interface BookingRequest extends BaseRecord {
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone?: string | undefined;
  readonly calfDob?: Date | undefined;
  readonly calfSex: "male" | "female" | "steer" | "unknown";
  readonly calfBreed?: string | undefined;
  readonly weaned: boolean;
  readonly hasVisibleId: boolean;
  readonly requestedDropOff: Date;
  readonly packages: readonly ProgramPackage[];
  readonly status: BookingStatus;
  readonly decidedOn?: Date | undefined;
  readonly declineReason?: string | undefined;
  readonly notes?: string | undefined;
}

export const bookingRequestSchema = baseRecordSchema
  .extend({
    customerName: z.string().min(1, "A booking needs a name").max(160),
    customerEmail: z.string().email(),
    customerPhone: z.string().max(40).optional(),
    calfDob: z.coerce.date().optional(),
    calfSex: z.enum(["male", "female", "steer", "unknown"]),
    calfBreed: z.string().max(120).optional(),
    weaned: z.boolean(),
    hasVisibleId: z.boolean(),
    requestedDropOff: z.coerce.date(),
    packages: z.array(z.enum(PROGRAM_PACKAGES)),
    status: z.enum(BOOKING_STATUSES),
    decidedOn: z.coerce.date().optional(),
    declineReason: z.string().max(2000).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((request) => request.status !== "declined" || request.declineReason !== undefined, {
    // A decline with no reason is one the customer cannot act on, and one
    // nobody can explain a year later.
    message: "Say why it was declined",
    path: ["declineReason"],
  }) as unknown as z.ZodType<BookingRequest>;

export interface PackageRate {
  readonly package: ProgramPackage;
  readonly price: Money;
}

export interface BoardingAgreement extends BaseRecord {
  readonly customerId: Ulid;
  readonly dailyBoardRate: Money;
  readonly feedRate?: Money | undefined;
  readonly packages: readonly PackageRate[];
  readonly startDate: Date;
  readonly estPickupDate?: Date | undefined;
  readonly liabilityFormId?: Ulid | undefined;
  readonly status: "draft" | "active" | "completed" | "terminated";
  readonly terminatedOn?: Date | undefined;
  readonly terminationReason?: string | undefined;
}

export const packageSchema = z.object({
  package: z.enum(PROGRAM_PACKAGES),
  price: moneySchema,
});

export const boardingAgreementSchema = baseRecordSchema
  .extend({
    customerId: ulidSchema,
    dailyBoardRate: moneySchema,
    feedRate: moneySchema.optional(),
    packages: z.array(packageSchema),
    startDate: z.coerce.date(),
    estPickupDate: z.coerce.date().optional(),
    liabilityFormId: ulidSchema.optional(),
    status: z.enum(["draft", "active", "completed", "terminated"]),
    terminatedOn: z.coerce.date().optional(),
    terminationReason: z.string().max(2000).optional(),
  })
  .refine(
    (agreement) => agreement.status !== "terminated" || agreement.terminationReason !== undefined,
    // §5.7's behaviour clause is "a manual action with documented incident
    // log". An undocumented termination is the one nobody can stand behind.
    { message: "A termination has to be documented", path: ["terminationReason"] },
  ) as unknown as z.ZodType<BoardingAgreement>;

export interface ProgramEnrollment extends BaseRecord {
  readonly animalId: Ulid;
  /** Absent for your own calves, which is the whole point of §12 decision 11. */
  readonly customerId?: Ulid | undefined;
  readonly agreementId?: Ulid | undefined;
  readonly halterColor: string;
  readonly startDate: Date;
  readonly targetEndDate?: Date | undefined;
  readonly insideZoneId?: Ulid | undefined;
  readonly outsideZoneId?: Ulid | undefined;
  readonly feedingPlanId?: Ulid | undefined;
  readonly packages: readonly ProgramPackage[];
  readonly dropOffDate?: Date | undefined;
  readonly estPickupDate?: Date | undefined;
  readonly ownerNotes?: string | undefined;
  readonly active: boolean;
}

export const programEnrollmentSchema = baseRecordSchema
  .extend({
    animalId: ulidSchema,
    customerId: ulidSchema.optional(),
    agreementId: ulidSchema.optional(),
    halterColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, "A halter colour is a hex colour")
      .default(DEFAULT_HALTER_COLOR),
    startDate: z.coerce.date(),
    targetEndDate: z.coerce.date().optional(),
    insideZoneId: ulidSchema.optional(),
    outsideZoneId: ulidSchema.optional(),
    feedingPlanId: ulidSchema.optional(),
    packages: z.array(z.enum(PROGRAM_PACKAGES)),
    dropOffDate: z.coerce.date().optional(),
    estPickupDate: z.coerce.date().optional(),
    ownerNotes: z.string().max(5000).optional(),
    active: z.boolean(),
  })
  .refine(
    (enrollment) => enrollment.agreementId === undefined || enrollment.customerId !== undefined,
    {
      // An agreement with no customer is a contract with nobody.
      message: "An agreement belongs to a customer",
      path: ["customerId"],
    },
  ) as unknown as z.ZodType<ProgramEnrollment>;

/** §5.7's milestone flags, which are what a customer sees for their animal. */
export const MILESTONES = ["haltered", "leads", "sets_up", "washed_blown", "loads"] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface TrainingLog extends BaseRecord {
  readonly enrollmentId: Ulid;
  readonly loggedOn: Date;
  readonly activity: string;
  readonly minutes?: number | undefined;
  readonly milestonesAchieved: readonly Milestone[];
  readonly notes?: string | undefined;
  /** Own-calf progress stays internal (§5.7). */
  readonly visibleToOwner: boolean;
}

export const trainingLogSchema = baseRecordSchema.extend({
  enrollmentId: ulidSchema,
  loggedOn: z.coerce.date(),
  activity: z.string().min(1, "Say what was worked on").max(160),
  minutes: z.number().int().positive().max(600).optional(),
  milestonesAchieved: z.array(z.enum(MILESTONES)),
  notes: z.string().max(5000).optional(),
  visibleToOwner: z.boolean(),
}) as unknown as z.ZodType<TrainingLog>;

/** When each milestone was first reached, which is what the customer view shows. */
export function milestoneStateOf(
  logs: readonly TrainingLog[],
  enrollmentId: Ulid,
): Map<Milestone, Date> {
  const achieved = new Map<Milestone, Date>();

  for (const log of logs) {
    if (log.enrollmentId !== enrollmentId) continue;
    for (const milestone of log.milestonesAchieved) {
      const existing = achieved.get(milestone);
      // First time it was reached, not the most recent mention of it.
      if (existing === undefined || log.loggedOn < existing) achieved.set(milestone, log.loggedOn);
    }
  }

  return achieved;
}

export interface ShowEntry extends BaseRecord {
  readonly enrollmentId: Ulid;
  readonly showName: string;
  readonly showDate: Date;
  readonly location?: string | undefined;
  /** Triggers approval and the extra fee (§5.7). */
  readonly requestUsToShow: boolean;
  readonly approved?: boolean | undefined;
  readonly notes?: string | undefined;
}

export const showEntrySchema = baseRecordSchema.extend({
  enrollmentId: ulidSchema,
  showName: z.string().min(1).max(160),
  showDate: z.coerce.date(),
  location: z.string().max(200).optional(),
  requestUsToShow: z.boolean(),
  approved: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<ShowEntry>;

export interface LiabilityForm extends BaseRecord {
  readonly version: number;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly effectiveFrom: Date;
  readonly active: boolean;
}

export const liabilityFormSchema = baseRecordSchema.extend({
  version: z.number().int().positive(),
  title: z.string().min(1).max(200),
  bodyMarkdown: z.string().min(1, "A form needs text"),
  effectiveFrom: z.coerce.date(),
  active: z.boolean(),
}) as unknown as z.ZodType<LiabilityForm>;

export const signatureSchema = z.object({
  typedName: z.string().min(1, "Sign your name").max(160),
  signedAt: z.coerce.date(),
  ipAddress: z.string().max(60).optional(),
  drawnSignatureKey: z.string().optional(),
});

/**
 * A signed form, frozen.
 *
 * On §4.5's immutable-legal-record exception list: create and read only,
 * never edited, never deleted. Corrections happen by superseding signature.
 * The business name is stored as it read at signing (§5.1's one deliberate
 * exception to BrandingConfig), because that is what the person agreed to.
 */
export interface SignedSnapshot extends BaseRecord {
  readonly liabilityFormId: Ulid;
  readonly formVersion: number;
  readonly customerId: Ulid;
  readonly businessNameAtSigning: string;
  readonly signature: z.infer<typeof signatureSchema>;
  /** R2 key for the immutable PDF. */
  readonly pdfKey?: string | undefined;
}

export const signedSnapshotSchema = baseRecordSchema.extend({
  liabilityFormId: ulidSchema,
  formVersion: z.number().int().positive(),
  customerId: ulidSchema,
  businessNameAtSigning: z.string().min(1).max(160),
  signature: signatureSchema,
  pdfKey: z.string().optional(),
}) as unknown as z.ZodType<SignedSnapshot>;

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  /** What produced the line: board, feed, supplies, a package, a fee. */
  readonly kind: "board" | "feed" | "supplies" | "package" | "showing" | "damages" | "other";
}

export interface Invoice extends BaseRecord {
  readonly customerId: Ulid;
  readonly agreementId?: Ulid | undefined;
  readonly issuedOn: Date;
  readonly dueOn?: Date | undefined;
  readonly lines: readonly InvoiceLine[];
  readonly status: InvoiceStatus;
  readonly externalId?: string | undefined;
  readonly voidReason?: string | undefined;
}

export const invoiceLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitAmount: moneySchema,
  kind: z.enum(["board", "feed", "supplies", "package", "showing", "damages", "other"]),
});

export const invoiceSchema = baseRecordSchema
  .extend({
    customerId: ulidSchema,
    agreementId: ulidSchema.optional(),
    issuedOn: z.coerce.date(),
    dueOn: z.coerce.date().optional(),
    lines: z.array(invoiceLineSchema),
    status: z.enum(INVOICE_STATUSES),
    externalId: z.string().max(60).optional(),
    voidReason: z.string().max(2000).optional(),
  })
  .refine((invoice) => invoice.status !== "void" || invoice.voidReason !== undefined, {
    // §4.5 governs voiding an invoice the same way it governs a delete: it is
    // irreversible and has to say why.
    message: "Voiding an invoice needs a reason",
    path: ["voidReason"],
  }) as unknown as z.ZodType<Invoice>;

export function invoiceTotal(invoice: Pick<Invoice, "lines">): Money {
  return {
    cents: invoice.lines.reduce(
      (total, line) => total + Math.round(line.unitAmount.cents * line.quantity),
      0,
    ),
  };
}

/** Board days between drop-off and pickup, counted inclusively of the first day. */
export function boardDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
