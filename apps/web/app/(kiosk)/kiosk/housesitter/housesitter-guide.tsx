"use client";

import type { ReactNode } from "react";

import { Callout, SafetyBadge, Tabs, type TabDefinition } from "@galaxy-farm/ui";
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
  type Trip,
} from "@galaxy-farm/module-housesitting";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import { petBriefings, petsOnFarm } from "@galaxy-farm/module-pets";

import { TripBanner } from "@/app/(kiosk)/kiosk/housesitter/_components/trip-banner";
import { TripTravel } from "@/app/(kiosk)/kiosk/housesitter/_components/trip-travel";
import {
  guideChores,
  guideEmergencyContacts,
  guideFeedingPlans,
  guideVets,
  guideZonesFrom,
} from "@/lib/guide-composition";
import { currentMedicinesFor, feedingLinesFor } from "@/lib/pet-care";

/**
 * The housesitter board (spec §4.4, §5.10).
 *
 * The same live composition the PDF and `/sitter` render, in this surface's own
 * dress. Nothing here is stored or cached — composed on every render, so the
 * board is current as somebody looks at it.
 *
 * **Tabs, because a housesitter does not scroll.** This board used to be the
 * day's chores followed by the whole guide as a stack of folds. Both halves of
 * that were wrong for the reader. A fold hides its contents behind a tap *and*
 * still costs a row, so the page grew past the screen as soon as the farm had
 * a few pens — and everything below the chores was reached by scrolling to a
 * closed row and then opening it. Two gestures, on a wall-mounted screen, by
 * somebody who is here for a week and will not go looking.
 *
 * So the panels sit behind one strip of large tabs and the page itself never
 * grows past the viewport: whatever is open replaces whatever was, and nothing
 * is ever more than one tap away. The chore board already sizes itself to one
 * screen (see `ChoreBoard`), and the rest is built to the same rule.
 *
 * **Two things are never behind a tap.** The do-not-handle list, because
 * somebody who reads nothing else has to have read it — the same reasoning
 * that leads `/sitter`'s page with it. And when the owners are back, because
 * that is the question the guide never answers and the one every sitter has.
 */

const includes = (guide: CareGuide, kind: GuideSectionKind) => guide.includes.includes(kind);

/** A panel's own heading. The tab names it too, but a screen reader lands here. */
function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="sr-only">{title}</h2>
      {children}
    </section>
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
  trip,
  today,
  choresLeft,
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
  /** Whoever is away now, or leaving soonest. Absent when nobody is going anywhere. */
  readonly trip: Trip | undefined;
  /** The day's chores. Passed in rather than composed here — one board, two surfaces. */
  readonly today: ReactNode;
  readonly choresLeft: number;
  readonly now: Date;
}) {
  const composed =
    guide === undefined
      ? undefined
      : composeGuide(
          guide,
          includes(guide, "pens") ? guideZonesFrom(zones, assignments, animals, now) : [],
          sections,
          now,
        );

  const dangerous = composed === undefined ? [] : doNotHandleList(composed);
  const emergency =
    guide !== undefined && includes(guide, "emergency_contacts")
      ? guideEmergencyContacts(contacts)
      : [];
  const vets = guide !== undefined && includes(guide, "vet") ? guideVets(contacts) : [];
  const people = [...emergency, ...vets];
  const routine =
    guide !== undefined && includes(guide, "chores") ? guideChores(templates, zones) : [];
  const feeding =
    guide !== undefined && includes(guide, "cattle_feeding")
      ? guideFeedingPlans(plans, feeds, animals, zones, assignments, now)
      : [];
  const pets =
    guide !== undefined && includes(guide, "pets")
      ? petBriefings(
          petsOnFarm(animals).map((pet) => ({
            pet,
            feeding: feedingLinesFor(pet.id, plans, feeds, animals).map((text) => ({ text })),
            medicines: currentMedicinesFor(pet.id, health, now),
          })),
        )
      : [];

  const pens = composed?.pens ?? [];
  const custom = composed?.custom ?? [];
  const intro = composed?.intro;

  const tabs: TabDefinition[] = [
    { id: "today", label: "Today", ...(choresLeft > 0 ? { adornment: choresLeft } : {}) },
  ];
  if (pens.length > 0 || pets.length > 0) {
    tabs.push({ id: "animals", label: "Animals", adornment: pens.length + pets.length });
  }
  if (feeding.length > 0) tabs.push({ id: "feeding", label: "Feeding", adornment: feeding.length });
  if (people.length > 0)
    tabs.push({ id: "contacts", label: "Who to ring", adornment: people.length });
  if (trip !== undefined) tabs.push({ id: "travel", label: "Travel" });
  if (intro !== undefined || custom.length > 0 || routine.length > 0) {
    tabs.push({ id: "notes", label: "Notes" });
  }

  return (
    <div className="flex flex-col gap-density">
      {trip === undefined ? null : <TripBanner trip={trip} now={now} />}

      {dangerous.length === 0 ? null : (
        <Callout tone="danger" title="Do not handle these alone">
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            {dangerous.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Tabs tabs={tabs} label="The housesitter board">
        {(active) => {
          if (active === "today") return <Panel title="Today">{today}</Panel>;

          if (active === "animals") {
            return (
              <Panel title="The animals">
                {pens.map((pen) => (
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
                              ({instruction.source === "zone" ? "this pen" : instruction.sourceName}
                              )
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}

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
              </Panel>
            );
          }

          if (active === "feeding") {
            return (
              <Panel title="Feeding the cattle">
                {feeding.map((plan) => (
                  <div key={plan.id} className="border-l-2 border-edge pl-3">
                    <p className="font-medium">
                      {plan.who}
                      <span className="font-normal text-muted"> · {plan.name}</span>
                    </p>
                    {plan.portion === undefined ? null : (
                      <p className="text-muted">{plan.portion}</p>
                    )}
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
              </Panel>
            );
          }

          if (active === "contacts") {
            return (
              <Panel title="Who to ring">
                <ul className="flex flex-col gap-2">
                  {people.map((person) => (
                    <li
                      key={`${person.id}-${person.name}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border border-edge bg-panel p-density"
                    >
                      <span className="min-w-0">
                        <strong className="text-density">{person.name}</strong>
                        {person.company === undefined ? null : (
                          <span className="text-muted"> · {person.company}</span>
                        )}
                        {person.note === undefined ? null : (
                          <span className="block text-sm text-muted">{person.note}</span>
                        )}
                      </span>
                      {person.phone === undefined ? (
                        <span className="text-danger">no number on file</span>
                      ) : (
                        <a
                          className="gf-numeric text-density font-semibold text-action"
                          href={`tel:${person.phone}`}
                        >
                          {person.phone}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          }

          if (active === "travel" && trip !== undefined) {
            return (
              <Panel title="Travel">
                <TripTravel trip={trip} />
                {trip.notes === undefined ? null : (
                  <p className="whitespace-pre-wrap text-muted">{trip.notes}</p>
                )}
              </Panel>
            );
          }

          if (active === "notes") {
            return (
              <Panel title="Notes">
                {intro === undefined ? null : <p className="whitespace-pre-wrap">{intro}</p>}

                {custom.map((section) => (
                  <div key={section.id} className="flex flex-col gap-1">
                    <h3 className="font-medium text-ink">{section.title}</h3>
                    <p className="whitespace-pre-wrap">{section.bodyMarkdown}</p>
                  </div>
                ))}

                {routine.length === 0 ? null : (
                  <div className="flex flex-col gap-1">
                    <h3 className="font-medium text-ink">The routine, beyond today&rsquo;s list</h3>
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
                  </div>
                )}
              </Panel>
            );
          }

          return null;
        }}
      </Tabs>

      {guide === undefined ? (
        <p className="text-sm text-muted">
          No care guide has been written yet. Start one under Housesitter in the admin app and its
          sections appear here by themselves.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Anything not covered here, ring the numbers under Who to ring rather than guessing.
        </p>
      )}
    </div>
  );
}
