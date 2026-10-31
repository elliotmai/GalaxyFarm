import type { Animal, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";
import {
  animalsUnderWithdrawal,
  awaitingCalving,
  boosterDue,
  isUnderWithdrawal,
  nextExpectedHeat,
  projectedDueDate,
  withdrawalEndDate,
  type BreedingRecord,
  type CalvingRecord,
  type ExternalAnimal,
  type HealthRecord,
  type HeatRecord,
  type WeightRecord,
} from "@galaxy-farm/module-cattle";
import type { Tone } from "@galaxy-farm/ui";

import { facts } from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { dueLabel } from "@/app/(admin)/admin/cattle/_components/herd-row";
import { animalTitle } from "@/lib/animal-slug";

/**
 * What is coming for one animal, and everything that has happened to her, as
 * plain rows (V2 Animal).
 *
 * The page used to split her past across Health, Weights and Breeding tabs,
 * which made "what happened to her last week" three taps and a guess. This is
 * one list, newest first, built from the same records those views read — no
 * record is written or stored here — so a shot logged in the chute is on it
 * the moment it is saved.
 */

export interface TimelineRow {
  readonly key: string;
  readonly date: Date;
  readonly title: string;
  readonly line: string;
  readonly chip?: { readonly tone: Tone; readonly label: string } | undefined;
}

export interface TimelineInputs {
  readonly animal: Animal;
  readonly animals: readonly Animal[];
  readonly outsiders: readonly ExternalAnimal[];
  readonly zones: readonly Zone[];
  readonly placements: readonly ZoneAssignment[];
  readonly health: readonly HealthRecord[];
  readonly weights: readonly WeightRecord[];
  readonly breedings: readonly BreedingRecord[];
  readonly calvings: readonly CalvingRecord[];
  readonly heats: readonly HeatRecord[];
  readonly now: Date;
}

export function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The bull, by whichever of the four ways the record names him. */
function sireOf(record: BreedingRecord, input: TimelineInputs): string | undefined {
  if (record.bullId !== undefined) {
    const bull = input.animals.find((entry) => entry.id === record.bullId);
    if (bull !== undefined) return animalTitle(bull);
  }
  if (record.sireExternalId !== undefined) {
    const outsider = input.outsiders.find((entry) => entry.id === record.sireExternalId);
    if (outsider !== undefined) return outsider.name;
  }
  const typed = record.sireName?.trim();
  return typed === undefined || typed === "" ? undefined : typed;
}

/**
 * The next few things to be ready for, soonest first.
 *
 * A withdrawal leads whatever its date, because it is the one that sends meat
 * somewhere it must not go. Boosters look a month out — long enough to order
 * the vaccine — and include any already missed.
 */
export function comingUp(input: TimelineInputs): TimelineRow[] {
  const { animal, now } = input;
  const rows: TimelineRow[] = [];

  const withdrawal = animalsUnderWithdrawal(input.health, now).find(
    (entry) => entry.animalId === animal.id,
  );
  if (withdrawal !== undefined) {
    rows.push({
      key: "withdrawal",
      date: withdrawal.clearsOn,
      title: `Withdrawal ends ${formatDate(withdrawal.clearsOn)}`,
      line: facts(
        withdrawal.product,
        `${withdrawal.daysRemaining} more day${withdrawal.daysRemaining === 1 ? "" : "s"}`,
        "not clear for sale or slaughter",
      ),
      chip: { tone: "danger", label: "Withdrawal" },
    });
  }

  const pending = awaitingCalving(input.breedings, input.calvings, now)
    .filter((record) => record.damId === animal.id)
    .sort((left, right) => projectedDueDate(left).getTime() - projectedDueDate(right).getTime());
  const service = pending[0];
  if (service !== undefined) {
    const due = projectedDueDate(service);
    const sire = sireOf(service, input);
    rows.push({
      key: `calving:${service.id}`,
      date: due,
      title: `Calving · ${formatDate(due)}`,
      line: facts(
        `${service.method === "natural" ? "Bred" : service.method} ${formatDate(service.date)}`,
        sire === undefined ? undefined : `to ${sire}`,
      ),
      chip: { tone: "action", label: dueLabel(due, now) },
    });
  }

  const hers = input.health.filter((record) => record.animalId === animal.id);
  for (const booster of boosterDue(hers, now, 30)) {
    rows.push({
      key: `booster:${booster.record.id}`,
      date: booster.dueOn,
      title: `${booster.record.product ?? capitalise(booster.record.type)} booster`,
      line: facts(
        `${booster.overdue ? "was due" : "due"} ${formatDate(booster.dueOn)}`,
        `first dose ${formatDate(booster.record.date)}`,
      ),
      chip: booster.overdue ? { tone: "danger", label: "Overdue" } : undefined,
    });
  }

  // The next heat only matters for a female who is not already in calf, and
  // only while the window is still ahead of her.
  if (animal.sex === "female" && service === undefined) {
    const heat = nextExpectedHeat(input.heats, animal.id);
    if (heat !== undefined && heat.to >= now) {
      rows.push({
        key: "heat",
        date: heat.expected,
        title: `Heat expected ${formatDate(heat.expected)}`,
        line: `Watch ${formatDate(heat.from)} to ${formatDate(heat.to)}`,
      });
    }
  }

  const [first, ...rest] = rows;
  if (first?.key === "withdrawal") {
    return [first, ...rest.sort((left, right) => left.date.getTime() - right.date.getTime())];
  }
  return rows.sort((left, right) => left.date.getTime() - right.date.getTime());
}

/** Everything on file about her, newest first. */
export function history(input: TimelineInputs): TimelineRow[] {
  const { animal, now } = input;
  const rows: TimelineRow[] = [];
  const zoneName = (id: Ulid) => input.zones.find((zone) => zone.id === id)?.name ?? "a pen";

  for (const record of input.health) {
    if (record.animalId !== animal.id) continue;
    const ends = withdrawalEndDate(record);
    const held = ends !== undefined && isUnderWithdrawal(record, now);
    rows.push({
      key: `health:${record.id}`,
      date: record.date,
      title: record.product ?? capitalise(record.type),
      line: facts(
        formatDate(record.date),
        record.product === undefined ? undefined : record.type,
        record.administeredBy,
        ends !== undefined && !held && "withdrawal cleared",
      ),
      chip:
        held && ends !== undefined
          ? { tone: "danger", label: `Until ${formatDate(ends)}` }
          : undefined,
    });
  }

  for (const record of input.weights) {
    if (record.animalId !== animal.id) continue;
    rows.push({
      key: `weight:${record.id}`,
      date: record.date,
      title: `Weighed ${Math.round(record.weightLb).toLocaleString()} lb`,
      line: facts(formatDate(record.date), record.context === "other" ? undefined : record.context),
    });
  }

  for (const record of input.breedings) {
    if (record.damId === animal.id) {
      const sire = sireOf(record, input);
      const result = record.pregCheck?.result;
      rows.push({
        key: `breeding:${record.id}`,
        date: record.date,
        title: `${record.method === "natural" ? "Bred" : record.method}${sire === undefined ? "" : ` to ${sire}`}`,
        line: facts(formatDate(record.date), `due ${formatDate(projectedDueDate(record))}`),
        chip:
          result === undefined
            ? undefined
            : {
                tone: result === "bred" ? "calm" : result === "open" ? "danger" : "action",
                label: result === "bred" ? "Confirmed" : capitalise(result),
              },
      });
    } else if (record.bullId === animal.id) {
      // His side of it: a bull's history is the cows he covered.
      const dam = input.animals.find((entry) => entry.id === record.damId);
      rows.push({
        key: `breeding:${record.id}`,
        date: record.date,
        title: `Bred ${dam === undefined ? "a cow" : animalTitle(dam)}`,
        line: facts(formatDate(record.date), record.method),
      });
    }
  }

  for (const record of input.calvings) {
    if (record.damId === animal.id) {
      const calf =
        record.calfSex === "female"
          ? "heifer calf"
          : record.calfSex === "male"
            ? "bull calf"
            : record.calfSex === "steer"
              ? "steer calf"
              : undefined;
      rows.push({
        key: `calving:${record.id}`,
        date: record.date,
        title: calf === undefined ? "Calved" : `Calved a ${calf}`,
        line: facts(
          formatDate(record.date),
          `ease ${record.calvingEase}`,
          record.birthWeightLb === undefined ? undefined : `${Math.round(record.birthWeightLb)} lb`,
        ),
        chip: record.assisted ? { tone: "action", label: "Assisted" } : undefined,
      });
    } else if (record.calfAnimalId === animal.id) {
      const dam = input.animals.find((entry) => entry.id === record.damId);
      rows.push({
        key: `born:${record.id}`,
        date: record.date,
        title: "Born",
        line: facts(
          formatDate(record.date),
          dam === undefined ? undefined : `out of ${animalTitle(dam)}`,
        ),
      });
    }
  }

  for (const record of input.heats) {
    if (record.animalId !== animal.id) continue;
    rows.push({
      key: `heat:${record.id}`,
      date: record.observedAt,
      title: `In heat · ${record.intensity}`,
      line: facts(formatDate(record.observedAt), record.observedBy),
    });
  }

  // Each assignment is a move: nothing is overwritten, so where she stood in
  // March is still on file and reads back as the day she went there.
  for (const record of input.placements) {
    if (record.animalId !== animal.id) continue;
    rows.push({
      key: `move:${record.id}`,
      date: record.periodFrom,
      title: `Moved to ${zoneName(record.zoneId)}`,
      line: facts(
        formatDate(record.periodFrom),
        record.periodTo === undefined ? "still there" : `until ${formatDate(record.periodTo)}`,
      ),
    });
  }

  return rows.sort((left, right) => right.date.getTime() - left.date.getTime());
}
