import { z } from "zod";

import { ulidSchema, type Ulid } from "@galaxy-farm/core";

/**
 * Horses under consideration (spec §5.9, extending §5.1's PurchaseCandidate).
 *
 * §5.9's reasoning, kept because it explains why this exists years before the
 * module does: "Horses are the purchase furthest out and the one most worth
 * researching slowly, so the shopping surface is live long before the module
 * is."
 *
 * The rest of the horses module is stub routes and a live Roadmap. This is the
 * one part with real fields, because the comparison view needs something to
 * compare.
 */

export const TRAINING_LEVELS = [
  "unhandled",
  "halter_broke",
  "green_broke",
  "started",
  "solid",
  "finished",
] as const;
export type TrainingLevel = (typeof TRAINING_LEVELS)[number];

export const DISCIPLINES = [
  "ranch",
  "trail",
  "reining",
  "roping",
  "barrels",
  "english",
  "driving",
  "companion",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const SOUNDNESS_STATUSES = ["sound", "serviceably_sound", "unsound", "unknown"] as const;
export type SoundnessStatus = (typeof SOUNDNESS_STATUSES)[number];

/**
 * Sex, as a horse listing writes it.
 *
 * Not the kernel's `male | female | steer | unknown`: a listing says mare or
 * gelding, and the difference between a gelding and a stallion is the first
 * thing anyone asks. Exported as a list because the form needs to offer it and
 * a second copy typed into the screen would be the copy that goes stale.
 */
export const HORSE_SEXES = ["mare", "gelding", "stallion", "filly", "colt"] as const;
export type HorseSex = (typeof HORSE_SEXES)[number];

export interface HorseCandidateDetail {
  readonly candidateId: Ulid;
  readonly breed?: string | undefined;
  readonly sex: HorseSex;
  readonly ageYears?: number | undefined;
  /** Hands, the unit horses are actually measured in. 15.2 is 15 hands 2 in. */
  readonly heightHands?: number | undefined;
  readonly trainingLevel?: TrainingLevel | undefined;
  readonly disciplines: readonly Discipline[];
  readonly soundness: SoundnessStatus;
  readonly vetCheckDone: boolean;
  readonly vetCheckNotes?: string | undefined;
  readonly temperament?: string | undefined;
  readonly association?: string | undefined;
  readonly regNumber?: string | undefined;
}

/**
 * A hand is four inches, so the decimal runs .0 to .3.
 *
 * 15.4 hands is not a height — it is somebody typing centimetres or guessing.
 * Exported because the form checks it while the number is being typed and the
 * schema checks it on the way in: one rule with two callers, so the message on
 * the field and the reason the save was refused cannot drift apart.
 */
export function isHandsFraction(hands: number): boolean {
  return Math.round((hands % 1) * 10) <= 3;
}

export const horseCandidateSchema = z
  .object({
    candidateId: ulidSchema,
    breed: z.string().max(80).optional(),
    sex: z.enum(HORSE_SEXES),
    ageYears: z.number().min(0).max(45).optional(),
    heightHands: z
      .number()
      .min(8)
      .max(20)
      .refine(isHandsFraction, "Height in hands runs .0 to .3")
      .optional(),
    trainingLevel: z.enum(TRAINING_LEVELS).optional(),
    disciplines: z.array(z.enum(DISCIPLINES)),
    soundness: z.enum(SOUNDNESS_STATUSES),
    vetCheckDone: z.boolean(),
    vetCheckNotes: z.string().max(2000).optional(),
    temperament: z.string().max(1000).optional(),
    association: z.string().max(40).optional(),
    regNumber: z.string().max(60).optional(),
  })
  .refine((detail) => detail.vetCheckDone || detail.vetCheckNotes === undefined, {
    message: "Vet-check notes without a vet check",
    path: ["vetCheckDone"],
  }) as unknown as z.ZodType<HorseCandidateDetail>;

/** Hands and inches, the way it is said out loud: 15.2 → "15.2 hh". */
export function describeHeight(hands: number | undefined): string | undefined {
  if (hands === undefined) return undefined;
  const whole = Math.floor(hands);
  const inches = Math.round((hands - whole) * 10);
  return inches === 0 ? `${whole} hh` : `${whole}.${inches} hh`;
}

/**
 * What to ask about before travelling to see one.
 *
 * Same shape as the equipment concerns and for the same reason: a list, not a
 * score. §5.1's comparison view exists for a decision made away from the
 * screen.
 */
export function concerns(detail: HorseCandidateDetail): string[] {
  const found: string[] = [];

  if (detail.soundness === "unsound") found.push("Listed as unsound");
  if (detail.soundness === "unknown") found.push("Soundness not stated");
  if (!detail.vetCheckDone) found.push("No vet check yet");
  if (detail.sex === "stallion") found.push("Stallion — handling and facilities");
  if (detail.trainingLevel === "unhandled") found.push("Unhandled");

  return found;
}

/**
 * The horse in one line: "8 yo gelding · 15.2 hh · Quarter Horse · solid".
 *
 * What a listing is skimmed for, in the order it is skimmed. Absent facts are
 * left out rather than rendered as "unknown" four times over — a row of
 * unknowns says less than a short line, and most listings start sparse.
 */
export function describeHorse(detail: HorseCandidateDetail): string {
  const parts = [
    detail.ageYears === undefined ? detail.sex : `${detail.ageYears} yo ${detail.sex}`,
    describeHeight(detail.heightHands),
    detail.breed,
    detail.trainingLevel?.replace(/_/g, " "),
  ];

  return parts.filter((part): part is string => part !== undefined && part !== "").join(" · ");
}

/**
 * Whether a horse does the job you are shopping for.
 *
 * Three answers, not two. A listing that names no disciplines has not said no
 * — it has said nothing, and a filter that treats the two alike quietly hides
 * the horse you have not asked about yet. Same distinction `concerns` draws
 * between "unsound" and "soundness not stated", for the same reason.
 */
export type DisciplineFit = "listed" | "not_listed" | "unstated";

export function disciplineFit(detail: HorseCandidateDetail, wanted: Discipline): DisciplineFit {
  if (detail.disciplines.length === 0) return "unstated";
  return detail.disciplines.includes(wanted) ? "listed" : "not_listed";
}
