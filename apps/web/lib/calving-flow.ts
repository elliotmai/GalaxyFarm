"use client";

import { useCallback } from "react";

import {
  animalSchema,
  assignmentInSlot,
  encodeUlid,
  moveToZone,
  suggestedLevelAfterCalving,
  zoneAssignmentSchema,
  type Animal,
  type SafetyLevel,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  calfFromCalving,
  calvingRecordSchema,
  calvingRecorded,
  cattleProfileSchema,
  producedLiveCalf,
  serviceFor,
  weightRecordSchema,
  type BreedingRecord,
  type CalvingRecord,
  type CattleProfile,
  type ParentRef,
  type WeightRecord,
} from "@galaxy-farm/module-cattle";

import { publish } from "@/lib/events";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Recording a calving (spec §5.2, issue #13).
 *
 * One tap on a phone in a barn produces up to five records: the calving, the
 * calf, the calf's cattle profile with its pedigree already wired, the birth
 * weight as a `WeightRecord`, and the id written back so the flow cannot run
 * twice. Doing that as five separate things somebody remembers to do is how a
 * calf ends up in the herd with no dam and no sire, three months later, when
 * nobody can remember which bull it was.
 *
 * It lives in `apps/web` rather than in the cattle module because it composes
 * repositories, and §4.1 keeps the module pure. The *decisions* are all in the
 * module — `calfFromCalving` says what the calf is, `serviceFor` says which
 * breeding it came from — and what is here is only the order of the writes.
 *
 * **Order matters and is not arbitrary.** The calf is created before the
 * calving record is updated with its id, because the id is what makes the
 * second run a no-op. A crash between the two leaves a calving with no back
 * reference to a calf that does exist — visible on the screen as a blank Calf
 * column, and fixable. Writing the id first and crashing would leave a calving
 * pointing at an animal that was never created, which nothing can detect.
 */

export interface CalvingInput {
  readonly damId: Ulid;
  readonly date: Date;
  readonly calvingEase: 1 | 2 | 3 | 4 | 5;
  readonly vigour: "vigorous" | "slow" | "weak" | "stillborn";
  readonly calfSex?: "male" | "female" | "steer" | "unknown";
  readonly birthWeightLb?: number;
  readonly assisted: boolean;
  readonly assistDetail?: string;
  readonly notes?: string;
  /** What goes in the ear. `suggestedCalfTag` prefills the form field. */
  readonly calfTag: string;
}

export interface CalvingOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly calving?: CalvingRecord;
  readonly calf?: Animal;
  /** The dam's suggested level, when calving would raise it (§5.1). */
  readonly suggestedDamLevel?: SafetyLevel;
}

/**
 * The sire of the calf, resolved from the service rather than asked for.
 *
 * Returns undefined when the breeding recorded the sire as free text, which is
 * what the breeding screen does until the semen tank (#20) and the
 * `ExternalAnimal` picker (#16) exist. An unresolvable sire is left off the
 * pedigree rather than guessed — a wrong sire on a registration application is
 * a real problem, and an absent one is only an incomplete tree.
 */
export function sireOf(service: BreedingRecord | undefined): ParentRef | undefined {
  if (service === undefined) return undefined;
  if (service.bullId !== undefined) return { kind: "animal", id: service.bullId };
  if (service.sireExternalId !== undefined) return { kind: "external", id: service.sireExternalId };
  return undefined;
}

export function useRecordCalving(
  propertyId: Ulid,
  actorId: Ulid,
): (
  input: CalvingInput,
  context: {
    readonly dam: Animal | undefined;
    readonly breedings: readonly BreedingRecord[];
  },
) => Promise<CalvingOutcome> {
  const calvings = useMutations<CalvingRecord>(
    "calvingRecords",
    "calvingRecords",
    calvingRecordSchema,
    propertyId,
    actorId,
  );
  const animals = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const profiles = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const placements = useMutations<ZoneAssignment>(
    "zoneAssignments",
    "zoneAssignments",
    zoneAssignmentSchema,
    propertyId,
    actorId,
  );
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", { propertyId });
  const { records: zones } = useRecords<Zone>("zones", { propertyId });

  const weights = useMutations<WeightRecord>(
    "weightRecords",
    "weightRecords",
    weightRecordSchema,
    propertyId,
    actorId,
  );

  return useCallback(
    async (input, context) => {
      const service = serviceFor(context.breedings, input.damId, input.date);

      const created = await calvings.create({
        damId: input.damId,
        ...(service === undefined ? {} : { breedingRecordId: service.id }),
        date: input.date,
        calvingEase: input.calvingEase,
        vigour: input.vigour,
        ...(input.calfSex === undefined ? {} : { calfSex: input.calfSex }),
        ...(input.birthWeightLb === undefined ? {} : { birthWeightLb: input.birthWeightLb }),
        assisted: input.assisted,
        ...(input.assistDetail === undefined ? {} : { assistDetail: input.assistDetail }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      } as never);

      if (!created.ok) {
        return {
          ok: false,
          message:
            created.error.kind === "validation"
              ? (created.error.issues[0]?.message ?? "That is not valid")
              : "Could not save the calving",
        };
      }

      const calving = created.value;
      const live = producedLiveCalf(calving);

      // A stillbirth is recorded and no animal is created. It still matters to
      // the dam's history and to any decision about keeping her.
      if (!live) {
        await publish(calvingRecorded(calving, { liveCalf: false }));
        return {
          ok: true,
          message: "Calving recorded",
          calving,
          ...(context.dam === undefined
            ? {}
            : { suggestedDamLevel: suggestedLevelAfterCalving(context.dam.safetyLevel) }),
        };
      }

      const sire = sireOf(service);
      const draft = calfFromCalving(
        calving,
        {
          ...(sire?.kind === "animal" ? { animalId: sire.id } : {}),
          ...(sire?.kind === "external" ? { externalId: sire.id } : {}),
        },
        {
          propertyId,
          // The calf belongs to whoever the dam belongs to. A client's cow
          // calves a client's calf, and §5.6's boarding invoices depend on
          // that being right from the moment it hits the ground.
          ownership: context.dam?.ownership === "client" ? "client" : "own",
          ...(context.dam?.ownerId === undefined ? {} : { ownerId: context.dam.ownerId }),
          tagNumber: input.calfTag,
        },
      );

      if (draft === undefined) {
        return { ok: true, message: "Calving recorded", calving };
      }

      const calf = await animals.create(draft.animal as never);
      if (!calf.ok) {
        // The calving is saved and the calf is not. Say so plainly rather than
        // reporting success — a silent half-write here is a calf that exists
        // on paper and not in the app.
        return {
          ok: false,
          message: "Calving saved, but the calf could not be created. Add it from the herd.",
          calving,
        };
      }

      // A calf runs with its dam, so it is born into her pen rather than
      // nowhere. Without this every calf arrives unplaced, missing from the
      // Pen Board on the one morning somebody most wants to find it — and
      // "everything on the place stands somewhere outdoors" would be a rule
      // this app broke itself, every calving.
      const indoorZoneIds = new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id));
      const damPen = assignmentInSlot(assignments, input.damId, "outside", indoorZoneIds);
      const pen = zones.find((zone) => zone.id === damPen?.zoneId);

      if (pen !== undefined) {
        const { opened } = moveToZone(
          assignments,
          {
            id: encodeUlid(calving.date.getTime() + 1) as Ulid,
            propertyId,
            createdAt: calving.date,
            updatedAt: calving.date,
            animalId: calf.value.id,
            zoneId: pen.id,
            indoor: pen.indoor,
            // Dated to the calving, not to when the form was filled in. A calf
            // entered three days later was still in that pen for three days.
            at: calving.date,
          },
          indoorZoneIds,
        );
        if (opened !== undefined) await placements.create(opened);
      }

      await profiles.create({
        animalId: calf.value.id,
        breedComposition: [],
        registrations: [],
        dam: { kind: "animal", id: input.damId },
        ...(sire === undefined ? {} : { sire }),
      } as never);

      // §5.2: the birth weight is a WeightRecord in the `birth` context, not a
      // loose field, so the growth chart and the 205-day figure read one series.
      if (draft.birthWeightLb !== undefined) {
        await weights.create({
          animalId: calf.value.id,
          date: calving.date,
          weightLb: draft.birthWeightLb,
          context: "birth",
        } as never);
      }

      // Last, and deliberately: this is what makes a second run a no-op.
      const linked = await calvings.update(calving.id, {
        calfAnimalId: calf.value.id,
      } as Partial<CalvingRecord>);

      const final = linked.ok ? linked.value : { ...calving, calfAnimalId: calf.value.id };
      await publish(calvingRecorded(final, { liveCalf: true }));

      return {
        ok: true,
        message: `Calved. ${input.calfTag} is in the herd.`,
        calving: final,
        calf: calf.value,
        ...(context.dam === undefined
          ? {}
          : { suggestedDamLevel: suggestedLevelAfterCalving(context.dam.safetyLevel) }),
      };
    },
    [calvings, animals, profiles, weights, propertyId],
  );
}
