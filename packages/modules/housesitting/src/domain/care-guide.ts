import { z } from "zod";

import {
  baseRecordSchema,
  effectiveSafetyLevel,
  resolveZoneInstructions,
  safetyLabel,
  ulidSchema,
  type BaseRecord,
  type ResolvedInstruction,
  type SafetyLabelOverrides,
  type SafetyLevel,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The care guide (spec §5.10).
 *
 * "A composed document: auto-sections pulled *live* … + custom sections you
 * write. Three outputs from the same source: print-perfect PDF, `/sitter`
 * limited login, and kiosk Housesitter Mode. Update a feeding plan anywhere and
 * every format is already current."
 *
 * So the composition is a function over live records, and only the hand-written
 * sections are stored. A guide that was generated once and saved would be
 * wrong the first time an animal moved pens — which is the week it is most
 * likely to be read.
 */

export const GUIDE_SECTION_KINDS = [
  "pens",
  "chores",
  "emergency_contacts",
  "vet",
  "equipment_quirks",
  "pets",
  "custom",
] as const;
export type GuideSectionKind = (typeof GUIDE_SECTION_KINDS)[number];

/** A section somebody wrote by hand; the rest are derived. */
export interface GuideSection extends BaseRecord {
  readonly careGuideId: Ulid;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly order: number;
}

export const guideSectionSchema = baseRecordSchema.extend({
  careGuideId: ulidSchema,
  title: z.string().min(1, "A section needs a heading").max(160),
  bodyMarkdown: z.string().min(1, "An empty section is worse than none"),
  order: z.number().int().min(0),
}) as unknown as z.ZodType<GuideSection>;

export interface CareGuide extends BaseRecord {
  readonly title: string;
  readonly intro?: string | undefined;
  /** Which auto-sections to include, in order. */
  readonly includes: readonly GuideSectionKind[];
  readonly active: boolean;
}

export const careGuideSchema = baseRecordSchema.extend({
  title: z.string().min(1).max(160),
  intro: z.string().max(5000).optional(),
  includes: z.array(z.enum(GUIDE_SECTION_KINDS)),
  active: z.boolean(),
}) as unknown as z.ZodType<CareGuide>;

export interface GuideAnimal {
  readonly id: Ulid;
  readonly name: string;
  readonly safetyLevel: SafetyLevel;
  readonly safetyNotes?: string | undefined;
  readonly customInstructions?: string | undefined;
}

export interface GuideZone {
  readonly id: Ulid;
  readonly name: string;
  readonly baselineSafetyLevel: SafetyLevel;
  readonly customInstructions?: string | undefined;
  readonly occupants: readonly GuideAnimal[];
}

export interface ComposedPenSection {
  readonly zoneId: Ulid;
  readonly zoneName: string;
  /** max(zone baseline, worst occupant) — §5.1, and it leads the section. */
  readonly effectiveLevel: SafetyLevel;
  readonly effectiveLabel: string;
  readonly animals: readonly GuideAnimal[];
  readonly instructions: readonly ResolvedInstruction[];
  /** Levels 4 and 5. §5.10 asks the guide to say what a helper may not touch. */
  readonly doNotHandle: readonly string[];
}

export interface ComposedGuide {
  readonly title: string;
  readonly intro?: string | undefined;
  readonly generatedAt: Date;
  readonly pens: readonly ComposedPenSection[];
  readonly custom: readonly GuideSection[];
}

/**
 * Build the guide from live records.
 *
 * Every pen section leads with its effective safety level, because §5.10 asks
 * for exactly that and because the person reading this has no way to ask a
 * follow-up question. The "do not handle" list is named animals rather than a
 * level, since "level 4" means nothing to somebody feeding chickens as a
 * favour.
 */
export function composeGuide(
  guide: Pick<CareGuide, "title" | "intro">,
  zones: readonly GuideZone[],
  custom: readonly GuideSection[],
  generatedAt: Date,
  labels?: SafetyLabelOverrides,
): ComposedGuide {
  const pens = zones.map((zone) => {
    const level = effectiveSafetyLevel(
      zone.baselineSafetyLevel,
      zone.occupants.map((animal) => animal.safetyLevel),
    );

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      effectiveLevel: level,
      effectiveLabel: safetyLabel(level, labels),
      animals: zone.occupants,
      instructions: resolveZoneInstructions(zone, zone.occupants),
      doNotHandle: zone.occupants
        .filter((animal) => animal.safetyLevel >= 4)
        .map((animal) =>
          animal.safetyNotes === undefined ? animal.name : `${animal.name} — ${animal.safetyNotes}`,
        ),
    };
  });

  return {
    title: guide.title,
    intro: guide.intro,
    generatedAt,
    // Worst pens first. Somebody skimming this on a phone at the gate should
    // meet the thing that can hurt them before the thing that cannot.
    pens: [...pens].sort((left, right) => right.effectiveLevel - left.effectiveLevel),
    custom: [...custom].sort((left, right) => left.order - right.order),
  };
}

/** Everything on the place a helper must not approach unaccompanied. */
export function doNotHandleList(composed: ComposedGuide): string[] {
  return composed.pens.flatMap((pen) => pen.doNotHandle);
}
