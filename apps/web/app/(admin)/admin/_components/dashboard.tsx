"use client";

import Link from "next/link";

import {
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  SafetyBadge,
  SkeletonScreen,
  StatRow,
  Tile,
} from "@galaxy-farm/ui";
import {
  coversToFit,
  effectiveSafetyLevel,
  freezeCheckTargets,
  type Animal,
  type FreezeCheckTarget,
  type SafetyLevel,
  type Ulid,
  type WaterSource,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { penAssignments } from "@galaxy-farm/module-pets";

import {
  CalvingWatchDetail,
  damName,
  useCalvingWatch,
  type CalvingWatch,
} from "@/app/(admin)/admin/_components/calving-watch-card";
import {
  ChoresChecklist,
  useChoreSheet,
  type ChoreSheet,
} from "@/app/(admin)/admin/_components/chores-card";
import { NeedsYou, type Need } from "@/app/(admin)/admin/_components/needs-you";
import {
  WeaningPanel,
  useWeaningWatch,
  type WeaningWatch,
} from "@/app/(admin)/admin/_components/weaning-card";
import { useRecords } from "@/lib/local/use-records";

/**
 * The admin dashboard — "Today".
 *
 * Status by exception. The screen leads with what needs somebody — a cow in
 * her window, calves to wean, a cover off a tank, a chore gone overdue — and
 * everything that is fine collapses into one green line instead of a card
 * apiece saying so. A dashboard where every card always has something on it
 * is one people stop reading.
 *
 * Everything here is derived from records rather than entered — the pen board
 * from assignments, the effective safety level from the animals standing in a
 * zone, the freeze list from which tanks lack heaters. §2: derive, don't
 * duplicate.
 *
 * Reads come from the device's store, so this renders at the same speed with
 * no signal as with five bars.
 */

export function Dashboard({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: zones, loading: zonesLoading } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: water } = useRecords<WaterSource>("waterSources", query);

  if (zonesLoading) {
    // The layout is known long before the records are, so draw it. A line of
    // grey text told the reader nothing about what was coming and let the page
    // jump the moment it did — this holds the geometry the rows will land in.
    return <SkeletonScreen title="Today" stats={0} rows={5} />;
  }

  if (zones.length === 0) {
    // The heading stays put through every state. A page whose `h1` only exists
    // once its data arrives has none when it is empty — which is the state a
    // new install spends its first week in.
    return (
      <PageBody>
        <PageHeader title="Today" />
        <EmptyState
          title="Nothing here yet"
          detail="Run pnpm db:seed to load the property, or add a zone to get started."
        />
      </PageBody>
    );
  }

  return (
    <Today
      propertyId={propertyId}
      actorId={actorId}
      zones={zones}
      animals={animals}
      assignments={assignments}
      water={water}
    />
  );
}

/** "Rosie, Pearl and 2 more" — a line, not a roll call. */
function names(list: readonly string[], max = 2): string {
  if (list.length <= max) return list.join(" · ");
  return `${list.slice(0, max).join(" · ")} +${list.length - max} more`;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Calving, weaning and tank covers" — the things that were checked and are fine. */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function calvingNeed(watch: CalvingWatch): Need | undefined {
  if (watch.cards.length === 0) return undefined;

  const first = watch.cards[0];
  const title =
    watch.cards.length === 1 && first !== undefined
      ? `${damName(watch, first)} due to calve`
      : `${watch.cards.length} due to calve`;
  // The weather leads when it matters — it is the reason to look tonight — and
  // only its headline, not the whole sentence after the dash.
  const signals = [
    ...new Set(
      watch.cards
        .filter((card) => card.urgent)
        .flatMap((card) => card.signals.map((signal) => signal.detail.split(" — ")[0] ?? "")),
    ),
  ].filter(Boolean);
  const who = watch.cards.map(
    (card) => `${damName(watch, card)} day ${card.dayOfGestation}, due ${shortDate(card.dueOn)}`,
  );

  return {
    key: "calving",
    urgency: watch.urgent ? "urgent" : "soon",
    title,
    line: [...signals, names(who, 1)].join(" · "),
    action: watch.urgent ? "Watch tonight" : "Calving watch",
    detail: <CalvingWatchDetail watch={watch} />,
  };
}

function weaningNeed(watch: WeaningWatch, propertyId: Ulid, actorId: Ulid): Need | undefined {
  if (watch.batches.length === 0) return undefined;

  const calves = watch.batches.flatMap((batch) => batch.calves);
  const first = watch.batches[0];
  const when =
    watch.late.length > 0
      ? "past the day"
      : first === undefined
        ? ""
        : first.ready
          ? `ready now, off by ${shortDate(first.mustGoBy)}`
          : `ready ${shortDate(first.readyOn)}`;

  return {
    key: "weaning",
    urgency: watch.late.length > 0 ? "urgent" : "soon",
    title: `${calves.length} ${calves.length === 1 ? "calf" : "calves"} to wean`,
    line: [names(calves.map((calf) => calf.calfName)), when].filter(Boolean).join(" · "),
    action: "Wean",
    detail: <WeaningPanel propertyId={propertyId} actorId={actorId} watch={watch} />,
  };
}

function coversNeed(toFit: readonly FreezeCheckTarget[]): Need | undefined {
  if (toFit.length === 0) return undefined;

  return {
    key: "covers",
    // Before dark rather than this minute, so soon and not urgent.
    urgency: "soon",
    title: `${toFit.length} tank cover${toFit.length === 1 ? "" : "s"} to put on`,
    line: `${names(toFit.map((target) => target.waterSource.name))} · before dark`,
    action: "Show tanks",
    detail: <TankList targets={toFit} />,
  };
}

function choresNeed(chores: ChoreSheet): Need | undefined {
  const late = chores.sheet.filter((entry) => entry.completedAt === undefined && entry.overdue);
  if (late.length === 0) return undefined;

  return {
    key: "chores",
    urgency: "urgent",
    title: `${late.length} chore${late.length === 1 ? "" : "s"} overdue`,
    line: names(late.map((entry) => entry.title)),
    action: "Open chores",
    href: "/admin/chores",
  };
}

function Today({
  propertyId,
  actorId,
  zones,
  animals,
  assignments,
  water,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly assignments: readonly ZoneAssignment[];
  readonly water: readonly WaterSource[];
}) {
  const calving = useCalvingWatch(propertyId);
  const weaning = useWeaningWatch(propertyId);
  const chores = useChoreSheet(propertyId, actorId);

  // Pens hold stock, not pets (§5.8). A dog with a placement behind him — a
  // mis-drag on the property map writes one — must not put a pen "in use" or
  // hand it his handling level on the board below.
  const placements = penAssignments(assignments, animals);
  const inUse = new Set(placements.filter((a) => a.periodTo === undefined).map((a) => a.zoneId))
    .size;

  // One check per tank, not per zone: four tanks serve eight zones here, and a
  // per-zone list sends somebody to the same trough three times.
  const toFit = coversToFit(
    freezeCheckTargets(
      water,
      zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        waterSourceIds: zone.waterSourceIds,
        active: zone.active,
      })),
    ),
  );

  // Ordered by the clock rather than by domain: a calving is a night's work
  // decided by the weather, weaning a week's work decided by a date. Urgent
  // rows rise above soon ones whichever they are.
  const candidates = [
    calvingNeed(calving),
    weaningNeed(weaning, propertyId, actorId),
    choresNeed(chores),
    coversNeed(toFit),
  ].filter((need): need is Need => need !== undefined);
  const needs = [
    ...candidates.filter((need) => need.urgency === "urgent"),
    ...candidates.filter((need) => need.urgency === "soon"),
  ];

  // What was looked at and found fine. Chores are left out: they have their
  // own list beside this one, which already says how the day is going.
  const fine = [
    calving.cards.length === 0 ? "calving" : undefined,
    weaning.batches.length === 0 ? "weaning" : undefined,
    toFit.length === 0 ? "tank covers" : undefined,
  ].filter((part): part is string => part !== undefined);
  const clear = fine.length === 0 ? undefined : `${listed(fine)}: nothing due.`;
  const allClear = clear === undefined ? undefined : clear.charAt(0).toUpperCase() + clear.slice(1);

  const date = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const count =
    needs.length === 0
      ? "nothing needs you"
      : `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you`;

  return (
    <PageBody>
      <PageHeader title="Today" subtitle={`${date} · ${count}`} />

      {/*
        Side by side on a laptop, Needs you the wider; stacked on a phone, Needs
        you first. Flex-wrap rather than a breakpoint grid, so the pair breaks
        onto two rows wherever the column gets too narrow for both — a side
        panel open beside it included.
      */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[3_1_420px]">
          <NeedsYou needs={needs} allClear={allClear} />
        </div>
        <div className="min-w-0 flex-[2_1_320px]">
          <ChoresChecklist chores={chores} />
        </div>
      </div>

      <AroundThePlace zones={zones} animals={animals} placements={placements} inUse={inUse} />
    </PageBody>
  );
}

/**
 * Standing facts, below the things to do.
 *
 * Not exceptions, so they sit last and quiet: the counts somebody repeats on
 * the phone, and the pen board folded shut until it is wanted.
 */
function AroundThePlace({
  zones,
  animals,
  placements,
  inUse,
}: {
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly placements: readonly ZoneAssignment[];
  readonly inUse: number;
}) {
  return (
    <section aria-labelledby="today-place" className="flex flex-col gap-2.5">
      <h2 id="today-place" className="text-xs font-semibold uppercase tracking-wide text-muted">
        Around the place
      </h2>

      <StatRow>
        {/*
          Cattle, not every animal on the place. One Animal model serves every
          species (§2), so the unfiltered list is the herd plus the flock, the
          dogs and the horses — and a tile labelled "Cattle" that counts the
          hens is wrong in the quietest possible way.
        */}
        <Tile
          label="Cattle"
          value={animals.filter((a) => a.species === "cattle" && a.status === "active").length}
          tone="identity"
        />
        <Tile
          label="Pens in use"
          value={inUse}
          hint={`of ${zones.filter((z) => z.active).length} active`}
        />
        <Tile label="Zones resting" value={zones.filter((z) => z.resting).length} tone="calm" />
      </StatRow>

      <PenBoard zones={zones} animals={animals} assignments={placements} />
    </section>
  );
}

interface PenRow {
  readonly zone: Zone;
  readonly occupants: readonly Animal[];
  readonly safety: SafetyLevel;
}

/**
 * Who is where, and how careful to be.
 *
 * Cards rather than a table (§8). A table is the right shape for comparing
 * forty rows on one number; this is nine pens where the question is "what is
 * in this one and do I need to be careful", which is three facts about each
 * and no comparison at all. The accent edge carries the safety level, so a pen
 * holding a fresh cow is findable by colour before anybody reads a word.
 *
 * The safety shown is the *effective* level — the higher of the zone's own
 * baseline and whatever is standing in it. A quiet pen holding a fresh cow is
 * not a quiet pen, and a board that showed the baseline would say it was.
 */
function PenBoard({
  zones,
  animals,
  assignments,
}: {
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly assignments: readonly ZoneAssignment[];
}) {
  const byId = new Map(animals.map((animal) => [animal.id, animal]));

  const rows: PenRow[] = zones
    // An area is not a place — it is North, holding four pens — so it must not
    // sit on the board as an empty card among them. Same reason
    // `working_facility` exists: the board is what is standing where, and a
    // row nothing can stand in is a row that trains people to skim it.
    .filter((zone) => zone.active && zone.type !== "area")
    .map((zone) => {
      // The open assignment is the current one — a closed period is history,
      // and history is never overwritten (§5.1).
      const occupants = assignments
        .filter((a) => a.zoneId === zone.id && a.periodTo === undefined)
        .map((a) => byId.get(a.animalId))
        .filter((animal): animal is Animal => animal !== undefined);

      return {
        zone,
        occupants,
        safety: effectiveSafetyLevel(
          zone.baselineSafetyLevel,
          occupants.map((animal) => animal.safetyLevel),
        ),
      };
    });

  const occupied = rows.filter((row) => row.occupants.length > 0);

  return (
    // Folded by default. It answers "where is everything", which is asked a
    // few times a week; the rows above answer what is asked every morning.
    <details className="group rounded-density border border-rule bg-panel">
      <summary className="flex min-h-target cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="text-muted transition-transform group-open:rotate-90"
          >
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Pen board
        </span>
        <span className="flex gap-1.5">
          <Pill tone="action" dot>
            {occupied.length} in use
          </Pill>
          <Pill>{rows.length - occupied.length} empty</Pill>
        </span>
      </summary>

      <div className="border-t border-rule p-density">
        <CardGrid columns={3}>
          {rows.map((row) => {
            const raised = row.safety > row.zone.baselineSafetyLevel;

            return (
              <RecordCard
                key={row.zone.id}
                title={row.zone.name}
                subtitle={row.zone.resting ? "Resting" : row.zone.indoor ? "Indoor" : undefined}
                // Level 3 and up is the point at which somebody should not walk
                // in without thinking, so that is where the card turns.
                tone={row.safety >= 4 ? "danger" : row.safety >= 3 ? "identity" : "calm"}
                actions={
                  <SafetyBadge
                    level={row.safety}
                    size="compact"
                    {...(raised
                      ? { raisedBy: row.occupants.map((a) => a.name ?? "an occupant").join(", ") }
                      : {})}
                  />
                }
                meta={
                  row.occupants.length === 0 ? (
                    <Pill>Empty</Pill>
                  ) : (
                    row.occupants.map((animal) => (
                      <Pill key={animal.id} tone={animal.safetyLevel >= 3 ? "danger" : "neutral"}>
                        {animal.name ?? animal.tagNumber ?? "Untagged"}
                      </Pill>
                    ))
                  )
                }
              />
            );
          })}
        </CardGrid>
      </div>
    </details>
  );
}

/**
 * The tanks with a cover to put on, opened from their "Needs you" row.
 *
 * Only the covers, because they are the only part anybody can act on ahead of
 * time: no tank here is heated, so "no heater" is a constant, and a constant
 * on a to-do list is furniture.
 */
function TankList({ targets }: { readonly targets: readonly FreezeCheckTarget[] }) {
  return (
    <div className="flex flex-col gap-density">
      <ul className="flex flex-col gap-2">
        {targets.map((target) => (
          <li key={target.waterSource.id} className="flex flex-col gap-0.5">
            <span className="text-density text-ink">{target.waterSource.name}</span>
            <span className="text-sm text-muted">
              Serves {target.zones.map((zone) => zone.name).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      <Link href="/admin/pastures" className="text-sm text-action underline underline-offset-2">
        Manage the tanks
      </Link>
    </div>
  );
}
