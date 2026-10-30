"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  addCalendarDays,
  endOfDay,
  isOnFarm,
  startOfDay,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { animalsUnderWithdrawal, type HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedingPlan } from "@galaxy-farm/core";
import { outstandingPetCare } from "@galaxy-farm/module-pets";
import {
  layRate,
  lossesIn,
  totalBirdsOn,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import type { QuickAction } from "@/app/(admin)/admin/animals/_components/animals-screen";
import { useCalvingWatch } from "@/app/(admin)/admin/_components/calving-watch-card";
import { useWeaningWatch } from "@/app/(admin)/admin/_components/weaning-card";
import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { useRecords } from "@/lib/local/use-records";
import { careRecordsFor } from "@/lib/pet-care";

/**
 * What each species' page says first, and the jobs it offers (decision 45).
 *
 * The list under it is the same shape for every species; this is what makes
 * the page that species' own. The cattle page leads with calving, weaning and
 * withdrawals; the chickens with today's eggs and losses; the horses with
 * where they are turned out and who needs care to handle; the dogs and cats
 * with the medicine and shots coming due. Each fact is a door: tapping it goes
 * where the thing is dealt with.
 *
 * Read from the same records and the same domain rules the species' own
 * screens and Today use, so a number here never disagrees with one there.
 */

/** One fact: a number, what it counts, and — when there is somewhere to go — a link. */
function Fact({
  value,
  label,
  href,
  tone = "neutral",
}: {
  readonly value: ReactNode;
  readonly label: string;
  readonly href?: string;
  readonly tone?: "neutral" | "attention";
}) {
  const body = (
    <>
      <span
        className={`gf-numeric text-xl font-semibold leading-tight ${tone === "attention" ? "text-danger" : "text-ink"}`}
      >
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </>
  );
  const box =
    "flex min-h-[64px] flex-col justify-center gap-0.5 rounded-density border border-rule bg-panel px-3 py-2";
  return href === undefined ? (
    <div className={box}>{body}</div>
  ) : (
    <Link
      href={href}
      className={`${box} hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action`}
    >
      {body}
    </Link>
  );
}

function Glance({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {children}
    </section>
  );
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ── Cattle ──────────────────────────────────────────────────────────────────

export const CATTLE_ACTIONS: readonly QuickAction[] = [
  { label: "Treat", glyph: "✚", href: logHref({ kind: "treatment", from: "/admin/cattle" }) },
  { label: "Weigh", glyph: "⚖", href: logHref({ kind: "weight", from: "/admin/cattle" }) },
  { label: "Move", glyph: "→", href: logHref({ kind: "move", from: "/admin/cattle" }) },
  { label: "Heat", glyph: "♡", href: logHref({ kind: "heat", from: "/admin/cattle" }) },
];

export function CattleGlance({ propertyId }: { readonly propertyId: Ulid }) {
  const calving = useCalvingWatch(propertyId);
  const weaning = useWeaningWatch(propertyId);
  const { records: health } = useRecords<HealthRecord>("healthRecords", { propertyId });
  const withheld = new Set(animalsUnderWithdrawal(health, new Date()).map((e) => e.animalId)).size;
  const calves = weaning.batches.flatMap((batch) => batch.calves).length;
  const next = calving.cards[0];

  return (
    <Glance label="Cattle at a glance">
      <Fact
        value={calving.cards.length}
        label={next === undefined ? "due to calve" : `due to calve · next ${shortDate(next.dueOn)}`}
        href="/admin/cattle/calving"
        tone={calving.urgent ? "attention" : "neutral"}
      />
      <Fact
        value={calves}
        label={calves === 1 ? "calf to wean" : "calves to wean"}
        href="/admin"
        tone={weaning.late.length > 0 ? "attention" : "neutral"}
      />
      <Fact
        value={withheld}
        label="under withdrawal"
        href="/admin/cattle/health"
        tone={withheld > 0 ? "attention" : "neutral"}
      />
      <Fact value="Plan" label="the next matings" href="/admin/breeding" />
    </Glance>
  );
}

// ── Horses ──────────────────────────────────────────────────────────────────

export const HORSE_ACTIONS: readonly QuickAction[] = [
  { label: "Move", glyph: "→", href: logHref({ kind: "move", from: "/admin/horses" }) },
  { label: "Note", glyph: "✎", href: logHref({ kind: "note", from: "/admin/horses" }) },
  { label: "Feeding", glyph: "●", href: logHref({ kind: "feeding", from: "/admin/horses" }) },
  { label: "Pens", glyph: "▦", href: "/admin/horses/pens" },
];

export function HorsesGlance({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);

  const horses = animals.filter((animal) => animal.species === "horse" && isOnFarm(animal));
  const ids = new Set(horses.map((horse) => horse.id));
  const outdoor = new Set(zones.filter((zone) => !zone.indoor).map((zone) => zone.id));
  const turnedOut = new Set(
    assignments
      .filter((a) => a.periodTo === undefined && ids.has(a.animalId) && outdoor.has(a.zoneId))
      .map((a) => a.animalId),
  ).size;
  const careful = horses.filter((horse) => horse.safetyLevel >= 4).length;

  return (
    <Glance label="Horses at a glance">
      <Fact value={horses.length} label={horses.length === 1 ? "horse here" : "horses here"} />
      <Fact value={turnedOut} label="turned out" href="/admin/horses/pens" />
      <Fact
        value={horses.length - turnedOut}
        label="with no turnout recorded"
        tone={horses.length - turnedOut > 0 ? "attention" : "neutral"}
      />
      <Fact
        value={careful}
        label="to handle with care"
        tone={careful > 0 ? "attention" : "neutral"}
      />
    </Glance>
  );
}

// ── Chickens ────────────────────────────────────────────────────────────────

export const CHICKEN_ACTIONS: readonly QuickAction[] = [
  { label: "Eggs", glyph: "◯", href: logHref({ kind: "eggs", from: "/admin/chickens/flock" }) },
  { label: "Headcount", glyph: "±", href: "/admin/chickens/headcount" },
  {
    label: "Feeding",
    glyph: "●",
    href: logHref({ kind: "feeding", from: "/admin/chickens/flock" }),
  },
  { label: "Trends", glyph: "↗", href: "/admin/chickens/eggs?tab=trends" },
];

export function ChickensGlance({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: flocks } = useRecords<Flock>("flocks", query);
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  const { records: logs } = useRecords<EggLog>("eggLogs", query);

  // Whole days, as the flock screens count them: a headcount or a basket is
  // dated, not timed.
  const today = endOfDay(new Date());
  const week = { from: startOfDay(addCalendarDays(today, -6)), to: today };
  const month = { from: startOfDay(addCalendarDays(today, -29)), to: today };
  const birds = totalBirdsOn(flocks, adjustments, today);
  const eggsToday = logs
    .filter((log) => log.collectedOn >= startOfDay(today) && log.collectedOn <= today)
    .reduce((total, log) => total + log.total, 0);
  const eggsWeek = logs
    .filter((log) => log.collectedOn >= week.from && log.collectedOn <= week.to)
    .reduce((total, log) => total + log.total, 0);
  const rate = layRate(logs, birds, week);
  const lost = flocks
    .filter((flock) => flock.active)
    .reduce((total, flock) => {
      const byReason = lossesIn(flock.id, adjustments, month);
      return (
        total +
        (byReason.get("died") ?? 0) +
        (byReason.get("predator") ?? 0) +
        (byReason.get("culled") ?? 0)
      );
    }, 0);

  return (
    <Glance label="Chickens at a glance">
      <Fact value={eggsToday} label="eggs today" href="/admin/chickens/eggs" />
      <Fact
        value={eggsWeek}
        label={
          rate === undefined ? "eggs this week" : `this week · ${rate.toFixed(2)} a bird a day`
        }
        href="/admin/chickens/eggs?tab=trends"
      />
      <Fact value={birds} label="birds" href="/admin/chickens/headcount" />
      <Fact
        value={lost}
        label="lost in 30 days"
        href="/admin/chickens/headcount"
        tone={lost > 0 ? "attention" : "neutral"}
      />
    </Glance>
  );
}

// ── Dogs and cats ───────────────────────────────────────────────────────────

export function petActions(species: "dog" | "cat"): readonly QuickAction[] {
  const from = species === "dog" ? "/admin/pets/dogs" : "/admin/pets/cats";
  return [
    { label: "Medicine", glyph: "✚", href: "/admin/pets?tab=health" },
    { label: "Feeding", glyph: "●", href: logHref({ kind: "feeding", from }) },
    { label: "Note", glyph: "✎", href: logHref({ kind: "note", from }) },
    { label: "Rations", glyph: "▤", href: "/admin/pets?tab=feeding" },
  ];
}

export function PetsGlance({
  propertyId,
  species,
}: {
  readonly propertyId: Ulid;
  readonly species: "dog" | "cat";
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);

  const pets = animals.filter((animal) => animal.species === species && isOnFarm(animal));
  const ids = new Set(pets.map((pet) => pet.id));
  const needs = outstandingPetCare(
    careRecordsFor(health.filter((record) => ids.has(record.animalId))),
    new Date(),
  );
  const overdue = needs.filter((need) => need.status === "overdue").length;
  const soon = needs.length - overdue;
  const fed = new Set(
    plans
      .filter((plan) => plan.active)
      .flatMap((plan) => [plan.targetId, ...(plan.alsoFeeds ?? [])])
      .filter((id): id is Ulid => id !== undefined && ids.has(id as Ulid)),
  ).size;
  const word = species === "dog" ? "dog" : "cat";

  return (
    <Glance label={`${species === "dog" ? "Dogs" : "Cats"} at a glance`}>
      <Fact value={pets.length} label={pets.length === 1 ? `${word} here` : `${word}s here`} />
      <Fact
        value={overdue}
        label="shots or medicine overdue"
        href="/admin/pets?tab=health"
        tone={overdue > 0 ? "attention" : "neutral"}
      />
      <Fact value={soon} label="due in two weeks" href="/admin/pets?tab=health" />
      <Fact
        value={pets.length - fed}
        label="with no ration written"
        href="/admin/pets?tab=feeding"
        tone={pets.length - fed > 0 ? "attention" : "neutral"}
      />
    </Glance>
  );
}
