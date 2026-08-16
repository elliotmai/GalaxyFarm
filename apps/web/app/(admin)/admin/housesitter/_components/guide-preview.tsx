"use client";

import { Button, EmptyState, SafetyBadge, Section } from "@galaxy-farm/ui";
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
 * The guide as somebody will read it (spec §5.10).
 *
 * One composition, three outputs — the PDF, `/sitter`, and kiosk Housesitter
 * Mode. This is the first of them, and it is the printed one: the print
 * stylesheet in `globals.css` drops the app's chrome and lays the document out
 * on paper, so "save as PDF" in the browser's print dialog is the PDF.
 *
 * Everything below is recomputed on render. Nothing is stored, nothing is
 * cached, and there is no "regenerate" button — that button existing at all
 * would mean the document could be out of date, which is the failure §5.10 is
 * written to prevent.
 */

const includes = (guide: CareGuide, kind: GuideSectionKind) => guide.includes.includes(kind);

export function GuidePreview({
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
}) {
  if (guide === undefined) {
    return (
      <EmptyState
        title="No guide to preview"
        detail="Start one on the previous tab and it appears here, already filled in."
      />
    );
  }

  const now = new Date();
  const composed = composeGuide(
    guide,
    includes(guide, "pens") ? guideZonesFrom(zones, assignments, animals, now) : [],
    sections,
    now,
  );
  const dangerous = doNotHandleList(composed);
  const chores = includes(guide, "chores") ? guideChores(templates, zones) : [];
  const feeding = includes(guide, "cattle_feeding")
    ? guideFeedingPlans(plans, feeds, animals, zones, assignments, now)
    : [];
  const emergency = includes(guide, "emergency_contacts") ? guideEmergencyContacts(contacts) : [];
  const vets = includes(guide, "vet") ? guideVets(contacts) : [];
  const pets = includes(guide, "pets")
    ? petBriefings(
        petsOnFarm(animals).map((pet) => ({
          pet,
          feeding: feedingLinesFor(pet.id, plans, feeds, animals).map((text) => ({ text })),
          medicines: currentMedicinesFor(pet.id, health, now),
        })),
      )
    : [];

  const printed = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Preview"
        description="What prints. Your browser's print dialog saves it as a PDF."
        actions={
          <Button variant="primary" onClick={() => globalThis.window?.print()}>
            Print or save as PDF
          </Button>
        }
      >
        <article data-print="guide" className="flex flex-col gap-6 rounded-density bg-panel p-6">
          <header className="flex flex-col gap-2 border-b border-edge pb-4">
            <h2 className="text-ink">{composed.title}</h2>
            <p className="text-sm text-muted">
              Composed {printed}. Everything below is read from the farm&rsquo;s own records — if
              something changed this morning, this says so.
            </p>
            {composed.intro === undefined ? null : (
              <p className="whitespace-pre-wrap text-density text-ink">{composed.intro}</p>
            )}
          </header>

          {dangerous.length === 0 ? null : (
            <section className="rounded-density border-2 border-danger p-4">
              <h3 className="text-danger">Do not handle these alone</h3>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-density text-ink">
                {dangerous.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          {emergency.length === 0 ? null : (
            <section>
              <h3 className="text-ink">Who to ring</h3>
              <ul className="mt-2 flex flex-col gap-1 text-density text-ink">
                {emergency.map((person) => (
                  <li key={person.id}>
                    <strong>{person.name}</strong>
                    {person.company === undefined ? null : (
                      <span className="text-muted"> · {person.company}</span>
                    )}{" "}
                    — {person.phone ?? <span className="text-danger">no number on file</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {vets.length === 0 ? null : (
            <section>
              <h3 className="text-ink">Vet</h3>
              <ul className="mt-2 flex flex-col gap-1 text-density text-ink">
                {vets.map((person) => (
                  <li key={person.id}>
                    <strong>{person.name}</strong>
                    {person.company === undefined ? null : (
                      <span className="text-muted"> · {person.company}</span>
                    )}{" "}
                    — {person.phone ?? "no number on file"}
                    {person.note === undefined ? null : (
                      <span className="text-muted"> · {person.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {composed.pens.length === 0 ? null : (
            <section className="flex flex-col gap-4">
              <h3 className="text-ink">Pens</h3>
              {composed.pens.map((pen) => (
                <div key={pen.zoneId} className="flex flex-col gap-2 border-l-2 border-edge pl-4">
                  <h4 className="flex flex-wrap items-center gap-2 text-ink">
                    <SafetyBadge level={pen.effectiveLevel} showLabel size="compact" />
                    {pen.zoneName}
                  </h4>

                  {pen.animals.length === 0 ? (
                    <p className="text-sm text-muted">Empty at the moment.</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-density text-ink">
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
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
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
            </section>
          )}

          {feeding.length === 0 ? null : (
            <section className="flex flex-col gap-3">
              <h3 className="text-ink">Feeding the cattle</h3>
              {feeding.map((plan) => (
                <div key={plan.id} className="flex flex-col gap-1 border-l-2 border-edge pl-4">
                  <h4 className="text-ink">
                    {plan.who}
                    <span className="font-body text-sm font-normal text-muted"> · {plan.name}</span>
                  </h4>
                  {plan.portion === undefined ? null : (
                    <p className="text-sm text-muted">{plan.portion}</p>
                  )}
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
                    {plan.lines.map((line, index) => (
                      <li key={`${plan.id}-${index}`}>{line}</li>
                    ))}
                  </ul>
                  {plan.notes === undefined ? null : (
                    <p className="whitespace-pre-wrap text-sm text-ink">{plan.notes}</p>
                  )}
                </div>
              ))}
            </section>
          )}

          {pets.length === 0 ? null : (
            <section className="flex flex-col gap-3">
              <h3 className="text-ink">The dogs and cats</h3>
              {pets.map((pet) => (
                <div key={pet.animalId} className="flex flex-col gap-1 border-l-2 border-edge pl-4">
                  <h4 className="flex flex-wrap items-center gap-2 text-ink">
                    <SafetyBadge level={pet.safetyLevel} showLabel size="compact" />
                    {pet.name}
                    <span className="font-body text-sm font-normal text-muted">{pet.species}</span>
                  </h4>
                  {pet.safetyNotes === undefined ? null : (
                    <p className="text-sm text-ink">{pet.safetyNotes}</p>
                  )}
                  {pet.instructions === undefined ? null : (
                    <p className="whitespace-pre-wrap text-sm text-ink">{pet.instructions}</p>
                  )}
                  {pet.feeding.length === 0 ? (
                    <p className="text-sm text-danger">
                      No ration written down — ask before feeding.
                    </p>
                  ) : (
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
                      {pet.feeding.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {pet.medicines.length === 0 ? null : (
                    <p className="text-sm text-ink">
                      <strong>On now:</strong> {pet.medicines.join("; ")}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          {chores.length === 0 ? null : (
            <section>
              <h3 className="text-ink">The routine</h3>
              <ul className="mt-2 flex flex-col gap-1 text-density text-ink">
                {chores.map((chore) => (
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
            </section>
          )}

          {composed.custom.map((section) => (
            <section key={section.id}>
              <h3 className="text-ink">{section.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-density text-ink">
                {section.bodyMarkdown}
              </p>
            </section>
          ))}

          <footer className="border-t border-edge pt-4 text-sm text-muted">
            Anything not covered here, ring the numbers above rather than guessing.
          </footer>
        </article>
      </Section>
    </div>
  );
}
