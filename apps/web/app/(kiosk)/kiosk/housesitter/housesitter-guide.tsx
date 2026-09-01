"use client";

import type { ReactNode } from "react";

import { SafetyBadge } from "@galaxy-farm/ui";
import type {
  Animal,
  ChoreTemplate,
  Contact,
  FeedingPlan,
  Zone,
  ZoneAssignment,
} from "@galaxy-farm/core";
import {
  composeGuide,
  doNotHandleList,
  type CareGuide,
  type GuideSection,
  type GuideSectionKind,
} from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { petBriefings, petsOnFarm } from "@galaxy-farm/module-pets";

import {
  guideChores,
  guideEmergencyContacts,
  guideFeedingPlans,
  guideVets,
  guideZonesFrom,
} from "@/lib/guide-composition";
import { currentMedicinesFor, feedingLinesFor } from "@/lib/pet-care";

/**
 * The care guide on the kiosk board (spec §4.4, §5.10).
 *
 * The same composition the PDF and `/sitter` render, dressed for the surface
 * it is on. The admin's `GuidePreview` is a *print* preview — a paper layout
 * with a running head and a save-as-PDF button — and reusing it here put a
 * document about printing on a screen nobody prints from. This board is a
 * small tablet under the day's chores, so the guide folds instead: each part
 * is one tappable row that opens in place, and the whole guide costs the
 * screen a few rows until somebody needs it.
 *
 * The one part that never folds is the danger list. Somebody who reads
 * nothing else has to have read which animals not to handle alone — the same
 * reasoning that leads `/sitter`'s page with it.
 *
 * Nothing is stored and nothing is cached: composed on every render, so the
 * board is current as somebody looks at it (§5.10).
 */

const includes = (guide: CareGuide, kind: GuideSectionKind) => guide.includes.includes(kind);

function Fold({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="group border border-edge bg-panel">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{title}</span>
        <span className="text-xs font-normal text-muted">{hint}</span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-edge px-3 py-2 text-sm text-ink">
        {children}
      </div>
    </details>
  );
}

export function HousesitterGuide({
  guide,
  sections,
  zones,
  assignments,
  animals,
  contacts,
  templates,
  plans,
  feeds,
  health,
  now,
}: {
  readonly guide: CareGuide | undefined;
  readonly sections: readonly GuideSection[];
  readonly zones: readonly Zone[];
  readonly assignments: readonly ZoneAssignment[];
  readonly animals: readonly Animal[];
  readonly contacts: readonly Contact[];
  readonly templates: readonly ChoreTemplate[];
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly health: readonly HealthRecord[];
  readonly now: Date;
}) {
  if (guide === undefined) {
    return (
      <p className="text-sm text-muted">
        No care guide has been written yet. Start one under Housesitter in the admin app and it
        appears here by itself.
      </p>
    );
  }

  const composed = composeGuide(
    guide,
    includes(guide, "pens") ? guideZonesFrom(zones, assignments, animals, now) : [],
    sections,
    now,
  );
  const dangerous = doNotHandleList(composed);
  const emergency = includes(guide, "emergency_contacts") ? guideEmergencyContacts(contacts) : [];
  const vets = includes(guide, "vet") ? guideVets(contacts) : [];
  const people = [...emergency, ...vets];
  const routine = includes(guide, "chores") ? guideChores(templates, zones) : [];
  const feeding = includes(guide, "cattle_feeding")
    ? guideFeedingPlans(plans, feeds, animals, zones, assignments, now)
    : [];
  const pets = includes(guide, "pets")
    ? petBriefings(
        petsOnFarm(animals).map((pet) => ({
          pet,
          feeding: feedingLinesFor(pet.id, plans, feeds, animals).map((text) => ({ text })),
          medicines: currentMedicinesFor(pet.id, health, now),
        })),
      )
    : [];

  return (
    <div className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink">{composed.title}</h2>
        <span className="text-xs text-muted">read live from the farm&rsquo;s records</span>
      </header>

      {dangerous.length === 0 ? null : (
        <div className="border-2 border-danger p-2">
          <p className="text-sm font-medium text-danger">Do not handle these alone</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm text-ink">
            {dangerous.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {composed.intro === undefined ? null : (
        <Fold title="Before anything else" hint="">
          <p className="whitespace-pre-wrap">{composed.intro}</p>
        </Fold>
      )}

      {people.length === 0 ? null : (
        <Fold title="Who to ring" hint={`${people.length}`}>
          <ul className="flex flex-col gap-1">
            {people.map((person) => (
              <li key={`${person.id}-${person.name}`}>
                <strong>{person.name}</strong>
                {person.company === undefined ? null : (
                  <span className="text-muted"> · {person.company}</span>
                )}{" "}
                — {person.phone ?? <span className="text-danger">no number on file</span>}
                {person.note === undefined ? null : (
                  <span className="text-muted"> · {person.note}</span>
                )}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {composed.pens.length === 0 ? null : (
        <Fold title="The pens" hint={`${composed.pens.length}`}>
          {composed.pens.map((pen) => (
            <div key={pen.zoneId} className="border-l-2 border-edge pl-3">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <SafetyBadge level={pen.effectiveLevel} showLabel size="compact" />
                {pen.zoneName}
              </p>
              {pen.animals.length === 0 ? (
                <p className="text-muted">Empty at the moment.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {pen.animals.map((animal) => (
                    <li key={animal.id}>
                      {animal.name}
                      {animal.safetyNotes === undefined ? null : (
                        <span className="text-muted"> — {animal.safetyNotes}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {pen.instructions.length === 0 ? null : (
                <ul className="flex list-disc flex-col gap-0.5 pl-5">
                  {pen.instructions.map((instruction, index) => (
                    <li key={`${instruction.sourceId}-${index}`}>
                      {instruction.text}{" "}
                      <span className="text-muted">
                        ({instruction.source === "zone" ? "this pen" : instruction.sourceName})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Fold>
      )}

      {feeding.length === 0 ? null : (
        <Fold title="Feeding the cattle" hint={`${feeding.length} plans`}>
          {feeding.map((plan) => (
            <div key={plan.id} className="border-l-2 border-edge pl-3">
              <p className="font-medium">
                {plan.who}
                <span className="font-normal text-muted"> · {plan.name}</span>
              </p>
              {plan.portion === undefined ? null : <p className="text-muted">{plan.portion}</p>}
              <ul className="flex list-disc flex-col gap-0.5 pl-5">
                {plan.lines.map((line, index) => (
                  <li key={`${plan.id}-${index}`}>{line}</li>
                ))}
              </ul>
              {plan.notes === undefined ? null : (
                <p className="whitespace-pre-wrap">{plan.notes}</p>
              )}
            </div>
          ))}
        </Fold>
      )}

      {pets.length === 0 ? null : (
        <Fold title="The dogs and cats" hint={`${pets.length}`}>
          {pets.map((pet) => (
            <div key={pet.animalId} className="border-l-2 border-edge pl-3">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <SafetyBadge level={pet.safetyLevel} showLabel size="compact" />
                {pet.name}
                <span className="font-normal text-muted">{pet.species}</span>
              </p>
              {pet.safetyNotes === undefined ? null : <p>{pet.safetyNotes}</p>}
              {pet.instructions === undefined ? null : (
                <p className="whitespace-pre-wrap">{pet.instructions}</p>
              )}
              {pet.feeding.length === 0 ? (
                <p className="text-danger">No ration written down — ask before feeding.</p>
              ) : (
                <ul className="flex list-disc flex-col gap-0.5 pl-5">
                  {pet.feeding.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {pet.medicines.length === 0 ? null : (
                <p>
                  <strong>On now:</strong> {pet.medicines.join("; ")}
                </p>
              )}
            </div>
          ))}
        </Fold>
      )}

      {routine.length === 0 ? null : (
        <Fold title="The routine" hint="beyond today's list">
          <ul className="flex flex-col gap-0.5">
            {routine.map((chore) => (
              <li key={chore.id}>
                <strong>{chore.when}</strong> — {chore.title}
                {chore.zoneName === undefined ? null : (
                  <span className="text-muted"> ({chore.zoneName})</span>
                )}
                {chore.detail === undefined ? null : (
                  <span className="text-muted"> · {chore.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {composed.custom.map((section) => (
        <Fold key={section.id} title={section.title} hint="">
          <p className="whitespace-pre-wrap">{section.bodyMarkdown}</p>
        </Fold>
      ))}

      <p className="text-xs text-muted">
        Anything not covered here, ring the numbers above rather than guessing.
      </p>
    </div>
  );
}
