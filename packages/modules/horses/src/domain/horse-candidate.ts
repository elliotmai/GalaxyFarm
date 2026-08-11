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

export interface HorseCandidateDetail {
  readonly candidateId: Ulid;
  readonly breed?: string | undefined;
  readonly sex: "mare" | "gelding" | "stallion" | "filly" | "colt";
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

export const horseCandidateSchema = z
  .object({
    candidateId: ulidSchema,
    breed: z.string().max(80).optional(),
    sex: z.enum(["mare", "gelding", "stallion", "filly", "colt"]),
    ageYears: z.number().min(0).max(45).optional(),
    heightHands: z
      .number()
      .min(8)
      .max(20)
      .refine(
        (hands) => Math.round((hands % 1) * 10) <= 3,
        // 15.4 hands is not a height. A hand is four inches, so the decimal
        // runs 0 to 3 and anything above it is somebody typing centimetres.
        "Height in hands runs .0 to .3",
      )
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
