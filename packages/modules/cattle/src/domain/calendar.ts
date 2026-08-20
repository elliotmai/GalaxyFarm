import {
  displayName,
  MS_PER_DAY,
  projectedId,
  type Animal,
  type CalendarEntry,
  type PurchaseCandidate,
  type Ulid,
} from "@galaxy-farm/core";

import {
  calvingWindow,
  pregCheckDue,
  projectedDueDate,
  serviceGroups,
  type BreedingRecord,
  type CalvingLike,
  type PregCheckMethod,
} from "./breeding-record.js";
import type { CalvingWatchCard } from "./calving-watch.js";
import { withdrawalEndDate, type HealthRecord } from "./health-record.js";
import type { MedInventory } from "./med-inventory.js";
import { projectProtocol, type SyncProtocol } from "./sync-protocol.js";

/**
 * What cattle puts on the unified calendar (spec §6, §4.5).
 *
 * The calendar is a read model, and this is the cattle half of it: every dated
 * thing §6 names under cattle, derived from the records that already hold the
 * dates. Nothing here is stored. Correcting the breeding date moves the
 * calving window, the preg check, and every step of the protocol that bred
 * her, because there is no second copy of any of it to go stale.
 *
 * §4.1 is why this lives here rather than in `core`: the kernel merges the
 * rows and windows them, and it never learns what a withdrawal period is.
 * Everything below is handed over as `CalendarEntry`, which is the only shape
 * the two sides agree on.
 *
 * The `source` on each row is the store the record lives in, so tapping
 * "Andromeda — calving window opens" lands on the breeding record rather than
 * on a dead end.
 */

const BREEDING_RECORDS = "breedingRecords";
const HEALTH_RECORDS = "healthRecords";
const MED_INVENTORY = "medInventory";
const PURCHASE_CANDIDATES = "purchaseCandidates";

/** A candidate that has already been bought, passed on, or lost is not a deadline. */
const SETTLED_CANDIDATE_STATUSES = ["purchased", "passed", "gone"];

export interface CattleCalendarInput {
  /** Only for the names on the rows — an unnamed animal still gets its dates. */
  readonly animals?: ReadonlyArray<Pick<Animal, "id" | "name" | "tagNumber">>;
  readonly breedings?: readonly BreedingRecord[];
  /**
   * What has already been answered.
   *
   * A calving closes the attempt it came of, and without them the calendar
   * keeps a fortnight of watch dates for a cow with a calf at side.
   */
  readonly calvings?: readonly CalvingLike[];
  readonly protocols?: readonly SyncProtocol[];
  readonly health?: readonly HealthRecord[];
  readonly meds?: readonly MedInventory[];
  readonly candidates?: readonly PurchaseCandidate[];
  /**
   * Cards from §6's weather-driven watch, when the caller holds a forecast.
   *
   * Not derived here, because the watch is a cow *and* a front coming through,
   * and this module cannot see the weather — `calvingWatch` builds the cards
   * for whoever can.
   */
  readonly watch?: readonly CalvingWatchCard[];
}

export interface CattleCalendarOptions {
  readonly defaultGestationDays?: number;
  readonly windowDays?: number;
  /** Which check the preg-check row is dated from; §5.2's default is ultrasound. */
  readonly pregCheckMethod?: PregCheckMethod;
}

/** Every cattle row, unordered — `projectEvents` sorts and windows them. */
export function cattleCalendarEntries(
  input: CattleCalendarInput,
  options: CattleCalendarOptions = {},
): CalendarEntry[] {
  const names = animalNames(input.animals ?? []);
  const name = (id: Ulid): string => names.get(id) ?? "Unnamed";

  return [
    ...breedingEntries(input.breedings ?? [], input.calvings ?? [], name, options),
    ...protocolEntries(input.breedings ?? [], input.protocols ?? [], name),
    ...watchEntries(input.watch ?? [], name),
    ...healthEntries(input.health ?? [], name),
    ...medEntries(input.meds ?? []),
    ...candidateEntries(input.candidates ?? []),
  ];
}

function animalNames(
  animals: ReadonlyArray<Pick<Animal, "id" | "name" | "tagNumber">>,
): Map<Ulid, string> {
  return new Map(animals.map((animal) => [animal.id, displayName(animal)]));
}

/**
 * The calving window and the pregnancy check.
 *
 * Dated from the service that still stands, which is the whole of the rule
 * here. Three services produce one due date, not three: a cow that came back
 * open and was bred again is carrying to the last one, and projecting the
 * earlier ones puts windows on the calendar for pregnancies that never
 * happened. An attempt she has already calved to produces nothing at all.
 *
 * A breeding that came back open produces neither: she is not carrying, so
 * there is no window to watch and no check left to do. §5.2's own
 * `pregCheckDue` already says so for the check; the window follows the same
 * reading, because a fortnight of watch dates for a cow known to be open is
 * exactly the noise that gets a calendar switched off.
 */
function breedingEntries(
  breedings: readonly BreedingRecord[],
  calvings: readonly CalvingLike[],
  name: (id: Ulid) => string,
  options: CattleCalendarOptions,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  const standing = serviceGroups(breedings, calvings)
    .filter((group) => group.calving === undefined)
    .map((group) => group.standing);

  for (const record of standing) {
    if (record.pregCheck?.result === "open") continue;

    const window = calvingWindow(record, options);
    const due = projectedDueDate(record, options.defaultGestationDays);
    entries.push({
      id: projectedId("calving_window", BREEDING_RECORDS, record.id),
      kind: "calving_window",
      module: "cattle",
      title: `${name(record.damId)} — calving window`,
      detail: `Due ${due.toDateString()}`,
      at: window.from,
      endAt: window.to,
      allDay: true,
      source: { entity: BREEDING_RECORDS, id: record.id },
    });

    const check = pregCheckDue(record, options.pregCheckMethod ?? "ultrasound");
    if (check !== undefined) {
      entries.push({
        id: projectedId("preg_check_due", BREEDING_RECORDS, record.id),
        kind: "preg_check_due",
        module: "cattle",
        title: `${name(record.damId)} — preg check due`,
        at: check,
        allDay: true,
        source: { entity: BREEDING_RECORDS, id: record.id },
      });
    }
  }

  return entries;
}

/**
 * Sync-protocol steps, laid over the breeding they belong to.
 *
 * A protocol is a template of day offsets and holds no dates of its own, so
 * the run has to be anchored to something stored. That anchor is the breeding
 * record: §5.2 has the timed-AI step pre-fill the breeding date, so the
 * breeding *is* the day the protocol says to breed, and every other step is
 * that day less its own offset. Move the breeding date and all ten steps move
 * with it — which is the criterion #20 sets, and the reason no start date is
 * kept anywhere for the two to disagree about.
 *
 * A protocol with no breed step has nothing to anchor to, so the breeding date
 * is read as day 0 instead. That is the honest reading of a protocol that
 * never names the day it breeds her.
 */
function protocolEntries(
  breedings: readonly BreedingRecord[],
  protocols: readonly SyncProtocol[],
  name: (id: Ulid) => string,
): CalendarEntry[] {
  const byId = new Map(protocols.map((protocol) => [protocol.id, protocol]));
  const entries: CalendarEntry[] = [];

  for (const record of breedings) {
    if (record.syncProtocolId === undefined) continue;
    const protocol = byId.get(record.syncProtocolId);
    if (protocol === undefined) continue;

    const startedOn = protocolStart(protocol, record.date);

    projectProtocol(protocol, record.damId, startedOn).forEach((step, index) => {
      entries.push({
        // The steps share one breeding record, so the record's id alone would
        // give ten rows one identity. The position in the projected order is
        // the discriminator: stable while the protocol is, and re-derived
        // rather than remembered, which is what keeps re-projection idempotent.
        id: `${projectedId("breeding_protocol_step", BREEDING_RECORDS, record.id)}:${index}`,
        kind: "breeding_protocol_step",
        module: "cattle",
        title: `${name(record.damId)} — ${step.step.label}`,
        detail: `${protocol.name}, day ${step.step.dayOffset}`,
        at: step.at,
        allDay: step.step.hourOffset === undefined,
        source: { entity: BREEDING_RECORDS, id: record.id },
      });
    });
  }

  return entries;
}

/** Day 0, worked back from the day she was bred. */
function protocolStart(protocol: SyncProtocol, bredOn: Date): Date {
  const breed = protocol.steps.find((step) => step.action === "breed");
  if (breed === undefined) return bredOn;

  return new Date(
    bredOn.getTime() - (breed.dayOffset * MS_PER_DAY + (breed.hourOffset ?? 0) * 3_600_000),
  );
}

/** §6's watch card, on the day the forecast says to be up for it. */
function watchEntries(
  watch: readonly CalvingWatchCard[],
  name: (id: Ulid) => string,
): CalendarEntry[] {
  return watch
    .filter((card) => card.signals.length > 0)
    .map((card) => {
      const first = card.signals.reduce((earliest, signal) =>
        signal.at < earliest.at ? signal : earliest,
      );
      return {
        id: projectedId("calving_watch", BREEDING_RECORDS, card.breedingRecordId),
        kind: "calving_watch" as const,
        module: "cattle" as const,
        title: `${name(card.damId)} — calving watch, day ${card.dayOfGestation}`,
        detail: card.signals.map((signal) => signal.detail).join(" + "),
        at: first.at,
        allDay: false,
        source: { entity: BREEDING_RECORDS, id: card.breedingRecordId },
      };
    });
}

/**
 * The withdrawal clock and the second shot.
 *
 * The withdrawal row is the one with a legal edge on it (§5.2): an animal
 * cannot enter the food chain before it. It is projected for every treatment
 * that carries a withdrawal, not only the ones still running, because a
 * clearance date in the past is what somebody looking back at March needs to
 * see when they ask why an animal was held.
 */
function healthEntries(
  health: readonly HealthRecord[],
  name: (id: Ulid) => string,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const record of health) {
    const clears = withdrawalEndDate(record);
    if (clears !== undefined) {
      entries.push({
        id: projectedId("withdrawal_end", HEALTH_RECORDS, record.id),
        kind: "withdrawal_end",
        module: "cattle",
        title: `${name(record.animalId)} — clear of ${record.product ?? "treatment"}`,
        detail: `${record.withdrawalDays as number} day withdrawal`,
        at: clears,
        allDay: true,
        source: { entity: HEALTH_RECORDS, id: record.id },
      });
    }

    if (record.boosterDueOn !== undefined) {
      entries.push({
        id: projectedId("booster_due", HEALTH_RECORDS, record.id),
        kind: "booster_due",
        module: "cattle",
        title: `${name(record.animalId)} — booster due`,
        detail: record.product,
        at: record.boosterDueOn,
        allDay: true,
        source: { entity: HEALTH_RECORDS, id: record.id },
      });
    }
  }

  return entries;
}

/** What is going out of date in the fridge. */
function medEntries(meds: readonly MedInventory[]): CalendarEntry[] {
  return meds
    .filter((item) => item.expiresOn !== undefined)
    .map((item) => ({
      id: projectedId("med_expiration", MED_INVENTORY, item.id),
      kind: "med_expiration" as const,
      module: "cattle" as const,
      title: `${item.product} expires`,
      detail: item.lotNumber === undefined ? undefined : `Lot ${item.lotNumber}`,
      at: item.expiresOn as Date,
      allDay: true,
      source: { entity: MED_INVENTORY, id: item.id },
    }));
}

/**
 * Sale barns and auction lots.
 *
 * "Auction lots are a deadline, not a browse" — §5.2's own words for why this
 * belongs on the calendar at all. The date is `expiresAt`, which the kernel
 * documents as the listing expiry *or* the sale date, and the lot number rides
 * along in `domainDetail` where the cattle half of a candidate lives.
 */
function candidateEntries(candidates: readonly PurchaseCandidate[]): CalendarEntry[] {
  return candidates
    .filter((candidate) => candidate.domain === "cattle")
    .filter((candidate) => !SETTLED_CANDIDATE_STATUSES.includes(candidate.status))
    .filter((candidate) => candidate.expiresAt !== undefined)
    .map((candidate) => {
      const lot = candidate.domainDetail?.["lotNumber"];
      return {
        id: projectedId("candidate_sale_date", PURCHASE_CANDIDATES, candidate.id),
        kind: "candidate_sale_date" as const,
        module: "cattle" as const,
        title: `${candidate.title} — sale date`,
        detail: typeof lot === "string" && lot !== "" ? `Lot ${lot}` : candidate.location,
        at: candidate.expiresAt as Date,
        allDay: true,
        source: { entity: PURCHASE_CANDIDATES, id: candidate.id },
      };
    });
}
