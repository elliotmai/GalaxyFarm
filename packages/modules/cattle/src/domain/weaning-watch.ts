import { ageInDays, displayName, isOnFarm, type Animal, type Ulid } from "@galaxy-farm/core";

import type { CattleProfile } from "./cattle-profile.js";

/**
 * When to wean (spec §6).
 *
 * §6 lists twenty-two default notification triggers and weaning was not among
 * them, so "wean" existed in this app only as a label on a weight and as the
 * 205-day figure computed from one. A calf could be weighed at weaning; nothing
 * ever said one was due.
 *
 * ## Why the age here is not 205 days
 *
 * 205 days is a *measurement* standard — the age every adjusted weaning weight
 * is projected to so that two calves born a month apart can be compared. It is
 * not a management instruction, and taking it as one would put this farm's
 * calves two months late.
 *
 * This is a show place, and show calves come off early: they need to be on feed,
 * halter-broke and gaining well before a show season fixed by a calendar
 * somebody else owns. The default is the middle of the range actually worked to,
 * and it is a setting because a club calf and a replacement heifer differ.
 *
 * ## Batches, not calves
 *
 * Calves born within a few weeks of each other are weaned together, in one
 * morning's work, so the watch groups them and stays quiet until the **youngest
 * in the group** is ready. Alerting per calf would raise the same job four
 * times over three weeks, and the first three raisings would all be answered by
 * doing nothing — which is exactly how an alert stops being read.
 *
 * That means the group is deliberately held past the oldest calf's own date.
 * Waiting a fortnight to wean a calf with its contemporaries costs nothing;
 * splitting a pen twice costs a morning and unsettles the ones left behind.
 *
 * ## Calves run with their dams until this happens
 *
 * Which is what makes weaning a *move* rather than a flag: the pair is standing
 * in one pen, and the job is to put the calves somewhere the dams are not.
 * `weanedOn` and the new assignment are written in the same action for that
 * reason — a calf marked weaned but still in with its dam is not weaned.
 *
 * ## The cow to separate it from is not always its dam
 *
 * On an embryo-transfer calf the recipient carried and raised it while the
 * pedigree names the donor, who may be in another state. On a grafted calf the
 * genetic dam may be dead. In both cases the pedigree dam is the wrong answer
 * to "which pen", and following it would send somebody to split a pair that is
 * not there.
 *
 * So the cow raising a calf is resolved in this order, most specific first:
 *
 * 1. `raisedById` on the profile — a graft, recorded because nothing else can
 *    know it. It happens after the birth, so no earlier record shows it.
 * 2. The dam on the **calving record** for this calf — the cow who actually
 *    calved. That is the recipient on an ET calf, which is why ET needs no
 *    field of its own.
 * 3. The pedigree dam, which is right for an ordinary calf and is the last
 *    resort for one whose calving was never recorded.
 *
 * When the two differ the watch carries both, because "off Dolly" is worth
 * seeing beside "out of Jenna" — one is the pen and the other is the papers.
 */

/**
 * Days old at which a show calf comes off.
 *
 * The middle of the 120–150 band. Deliberately well short of the 205-day
 * benchmark, for the reason above.
 */
export const DEFAULT_WEANING_AGE_DAYS = 135;

/** How far ahead the watch opens, so there is time to set the pens up. */
export const DEFAULT_WEANING_LEAD_DAYS = 14;

/**
 * How far apart two calves can be born and still come off together.
 *
 * Three weeks — roughly one heat cycle, which is the natural width of a calving
 * group when the cows were bred together. Measured against the *earliest* calf
 * in the batch rather than the previous one, so a run of calves born a
 * fortnight apart all season cannot chain into a single batch that never
 * becomes ready.
 */
export const DEFAULT_BATCH_WINDOW_DAYS = 21;

export interface WeaningCandidate {
  readonly calfId: Ulid;
  readonly calfName: string;
  /**
   * The cow this calf is actually on — the pen to split.
   *
   * Not necessarily the pedigree dam: see the resolution order above.
   */
  readonly damId?: Ulid | undefined;
  /** The pedigree dam, when she is a different cow from the one raising it. */
  readonly geneticDamId?: Ulid | undefined;
  /** Why they differ, when they do — "recipient dam" or "grafted on". */
  readonly raisedByOther?: "recipient" | "grafted" | undefined;
  readonly bornOn: Date;
  readonly ageDays: number;
  /** The day this calf on its own reaches weaning age. */
  readonly readyOn: Date;
  /** Negative once its own day has passed. */
  readonly daysUntilReady: number;
}

export interface WeaningBatch {
  /** Oldest first, which is the order they are looked at in the pen. */
  readonly calves: readonly WeaningCandidate[];
  /** When the whole batch comes off — the youngest calf's day. */
  readonly readyOn: Date;
  readonly daysUntilReady: number;
  readonly overdue: boolean;
}

export interface WeaningWatchInput {
  readonly animals: readonly Animal[];
  /** Profiles carry `weanedOn` and `raisedById`. */
  readonly profiles: readonly Pick<CattleProfile, "animalId" | "weanedOn" | "dam" | "raisedById">[];
  /**
   * Calvings, so the cow who actually calved can be found.
   *
   * Optional only so an existing caller keeps working. Without them an ET
   * calf resolves to its donor, which is the wrong pen.
   */
  readonly calvings?: readonly { readonly damId: Ulid; readonly calfAnimalId?: Ulid | undefined }[];
  readonly asOf: Date;
  readonly weaningAgeDays?: number | undefined;
  readonly leadDays?: number | undefined;
  readonly batchWindowDays?: number | undefined;
}

const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * 86_400_000);

const daysApart = (left: Date, right: Date): number =>
  Math.abs(left.getTime() - right.getTime()) / 86_400_000;

/**
 * Every calf still on its dam, oldest first — whatever its age.
 *
 * Not filtered by how close it is to weaning, deliberately: a batch is held
 * until its youngest member is ready, so the calves that are *not* yet due are
 * exactly the ones that decide when the batch is.
 *
 * Four things keep a calf off this list, each a real state rather than an
 * oversight to paper over:
 *
 * - **Already weaned.** `weanedOn` is set and the job is done.
 * - **Not here.** Sold, dead, or otherwise off the place — §5.1's `isOnFarm`.
 * - **No birthday.** There is no honest countdown without one, and a guessed
 *   weaning date on a calf whose age nobody knows would be acted on.
 * - **Not cattle.** One Animal model serves every species (§2).
 */
export function weaningCandidates(input: WeaningWatchInput): WeaningCandidate[] {
  const weaningAge = input.weaningAgeDays ?? DEFAULT_WEANING_AGE_DAYS;
  const profileFor = new Map(input.profiles.map((profile) => [profile.animalId, profile]));

  const calvedBy = new Map<Ulid, Ulid>();
  for (const calving of input.calvings ?? []) {
    if (calving.calfAnimalId !== undefined) calvedBy.set(calving.calfAnimalId, calving.damId);
  }

  const found: WeaningCandidate[] = [];

  for (const animal of input.animals) {
    if (animal.species !== "cattle" || !isOnFarm(animal)) continue;

    const profile = profileFor.get(animal.id);
    if (profile?.weanedOn !== undefined) continue;

    const ageDays = ageInDays(animal, input.asOf);
    if (ageDays === undefined || animal.dob === undefined) continue;

    // The pedigree dam, which is only the right answer for an ordinary calf.
    const pedigreeDam =
      profile?.dam !== undefined && profile.dam.kind === "animal" ? profile.dam.id : undefined;
    const calvedByDam = calvedBy.get(animal.id);

    // Most specific first: a graft, then whoever actually calved, then papers.
    const raising = profile?.raisedById ?? calvedByDam ?? pedigreeDam;
    const differs = raising !== undefined && pedigreeDam !== undefined && raising !== pedigreeDam;

    found.push({
      calfId: animal.id,
      calfName: displayName(animal),
      ...(raising === undefined ? {} : { damId: raising }),
      ...(differs ? { geneticDamId: pedigreeDam } : {}),
      ...(differs
        ? { raisedByOther: profile?.raisedById !== undefined ? "grafted" : "recipient" }
        : {}),
      bornOn: animal.dob,
      ageDays,
      readyOn: addDays(animal.dob, weaningAge),
      daysUntilReady: weaningAge - ageDays,
    });
  }

  return found.sort((left, right) => left.bornOn.getTime() - right.bornOn.getTime());
}

/**
 * The calving groups, whether or not they are ready.
 *
 * Each batch spans at most `batchWindowDays` from its earliest calf. Measured
 * from the earliest rather than from the previous calf on purpose: chaining
 * would let calves born a fortnight apart all season form one batch whose
 * youngest member keeps moving, and a batch that is never ready never weans.
 */
export function groupIntoBatches(
  candidates: readonly WeaningCandidate[],
  batchWindowDays: number = DEFAULT_BATCH_WINDOW_DAYS,
): WeaningCandidate[][] {
  const batches: WeaningCandidate[][] = [];

  for (const calf of candidates) {
    const current = batches[batches.length - 1];
    const anchor = current?.[0];

    if (current !== undefined && anchor !== undefined) {
      if (daysApart(calf.bornOn, anchor.bornOn) <= batchWindowDays) {
        current.push(calf);
        continue;
      }
    }
    batches.push([calf]);
  }

  return batches;
}

/**
 * Batches at or approaching weaning, nearest deadline first.
 *
 * A batch is ready when its **youngest** calf reaches weaning age, which is
 * what holds the older ones back until the whole pen can be split in one go.
 */
export function weaningBatches(input: WeaningWatchInput): WeaningBatch[] {
  const lead = input.leadDays ?? DEFAULT_WEANING_LEAD_DAYS;
  const candidates = weaningCandidates(input);

  return groupIntoBatches(candidates, input.batchWindowDays ?? DEFAULT_BATCH_WINDOW_DAYS)
    .map((calves) => {
      // The youngest is the last, since candidates are sorted oldest first.
      const youngest = calves[calves.length - 1] as WeaningCandidate;

      return {
        calves,
        readyOn: youngest.readyOn,
        daysUntilReady: youngest.daysUntilReady,
        overdue: youngest.daysUntilReady < 0,
      };
    })
    .filter((batch) => batch.daysUntilReady <= lead)
    .sort((left, right) => left.daysUntilReady - right.daysUntilReady);
}

/** Just the batches already past the day, which the dashboard leads with. */
export function overdueToWean(batches: readonly WeaningBatch[]): WeaningBatch[] {
  return batches.filter((batch) => batch.overdue);
}

/**
 * One line, phrased the way somebody planning the week's work would say it.
 *
 * The batch is named by its size and by the youngest calf's countdown, because
 * that is the date the work actually happens on. The oldest calf's age comes
 * with it so the spread is visible — a batch spanning three weeks is a
 * different morning from four calves born on the same day.
 */
export function describeBatch(batch: WeaningBatch): string {
  const head = batch.calves.length;
  const subject = head === 1 ? "1 calf" : `${head} calves`;

  const when = batch.overdue
    ? `${Math.abs(batch.daysUntilReady)} ${Math.abs(batch.daysUntilReady) === 1 ? "day" : "days"} past weaning age`
    : batch.daysUntilReady === 0
      ? "ready to wean today"
      : `ready to wean in ${batch.daysUntilReady} ${batch.daysUntilReady === 1 ? "day" : "days"}`;

  if (head === 1) return `${subject} — ${when}.`;

  const oldest = batch.calves[0] as WeaningCandidate;
  const youngest = batch.calves[head - 1] as WeaningCandidate;
  const spread = Math.round(daysApart(oldest.bornOn, youngest.bornOn));

  return `${subject}, born ${spread} ${spread === 1 ? "day" : "days"} apart — ${when} when the youngest is ready.`;
}
