import type { Ulid } from "../types/ids.js";

/**
 * Resolved care instructions (spec §5.1).
 *
 * "Any animal's effective instructions = its own instructions + its current
 * zone's instructions + any group instructions, displayed merged on the Pen
 * Board and in the housesitter guide."
 *
 * A derivation, never a stored field. The whole point of writing an
 * instruction on a *zone* is that it applies to whoever is standing in it
 * today; copying it onto the animals would make moving one silently carry the
 * old pen's rules along with it.
 *
 * Each line keeps its provenance. That matters more than it looks: a helper
 * reading "gets a scoop of grain at night" needs to know whether that is true
 * of this calf or of everything in Pen B, and the housesitter guide is read by
 * someone with no way to ask.
 */

export type InstructionSource = "animal" | "zone" | "group";

export interface ResolvedInstruction {
  readonly source: InstructionSource;
  /** The animal's, zone's, or group's name, for the "why am I reading this" line. */
  readonly sourceName: string;
  readonly sourceId: Ulid;
  readonly text: string;
}

export interface InstructionSubject {
  readonly id: Ulid;
  readonly name: string;
  readonly customInstructions?: string | undefined;
}

export interface InstructionContext {
  readonly animal: InstructionSubject;
  /** Every zone the animal currently occupies — client calves hold two (§5.1). */
  readonly zones: readonly InstructionSubject[];
  readonly groups?: readonly InstructionSubject[];
}

/** Blank and whitespace-only instructions are absent, not empty lines. */
function meaningful(text: string | undefined): text is string {
  return text !== undefined && text.trim().length > 0;
}

/**
 * Merge the three levels, most specific first.
 *
 * Order is deliberate and matches the spec's own sentence. The animal's own
 * note leads because it is the exception — "this one kicks", "no grain, she
 * founders" — and an exception buried under three paragraphs of pen-level
 * routine is an exception nobody reads.
 */
export function resolveCareInstructions(context: InstructionContext): ResolvedInstruction[] {
  const lines: ResolvedInstruction[] = [];

  const push = (source: InstructionSource, subject: InstructionSubject): void => {
    if (!meaningful(subject.customInstructions)) return;
    lines.push({
      source,
      sourceName: subject.name,
      sourceId: subject.id,
      text: subject.customInstructions.trim(),
    });
  };

  push("animal", context.animal);
  for (const zone of context.zones) push("zone", zone);
  for (const group of context.groups ?? []) push("group", group);

  return lines;
}

/** Does this animal have anything at all a helper needs to read? */
export function hasInstructions(context: InstructionContext): boolean {
  return resolveCareInstructions(context).length > 0;
}

/**
 * The same merge for a whole zone — what a helper needs when they walk into a
 * pen rather than up to one animal.
 *
 * The zone's own instructions appear once, not once per occupant, and each
 * animal's own line is attributed to it by name.
 *
 * `groups` are the zones this one sits inside — an area, a barn — whose
 * instructions apply to everything in them. Optional because most pens are
 * their own group, and ordered between the pen and its occupants for the same
 * reason the animal's own note leads there: most specific first.
 */
export function resolveZoneInstructions(
  zone: InstructionSubject,
  occupants: readonly InstructionSubject[],
  groups: readonly InstructionSubject[] = [],
): ResolvedInstruction[] {
  const lines: ResolvedInstruction[] = [];

  if (meaningful(zone.customInstructions)) {
    lines.push({
      source: "zone",
      sourceName: zone.name,
      sourceId: zone.id,
      text: zone.customInstructions.trim(),
    });
  }

  for (const group of groups) {
    if (!meaningful(group.customInstructions)) continue;
    lines.push({
      source: "group",
      sourceName: group.name,
      sourceId: group.id,
      text: group.customInstructions.trim(),
    });
  }

  for (const animal of occupants) {
    if (!meaningful(animal.customInstructions)) continue;
    lines.push({
      source: "animal",
      sourceName: animal.name,
      sourceId: animal.id,
      text: animal.customInstructions.trim(),
    });
  }

  return lines;
}
