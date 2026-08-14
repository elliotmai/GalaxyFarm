import { Callout, EmptyState, PageBody, PageHeader, SafetyBadge, Section } from "@galaxy-farm/ui";
import type { ChoreEntry } from "@galaxy-farm/core";
import { composeGuide, doNotHandleList } from "@galaxy-farm/module-housesitting";
import { petBriefings, petsOnFarm } from "@galaxy-farm/module-pets";

import { SitterChores } from "@/app/(sitter)/sitter/_components/sitter-chores";
import {
  guideChores,
  guideEmergencyContacts,
  guideVets,
  guideZonesFrom,
} from "@/lib/guide-composition";
import { currentMedicinesFor, feedingLinesFor } from "@/lib/pet-care";
import { guideIncludes, type SitterView } from "@/lib/sitter-store";

/**
 * The care guide as a helper reads it (spec §5.10).
 *
 * The same composition the admin preview and the printed PDF use, rendered on
 * a light surface for a phone held in a kitchen. Two things are different from
 * the printed copy, and both are because the reader is here rather than
 * holding paper:
 *
 * - **The chores can be ticked.** It is the one write a housesitter has.
 * - **The dangerous animals lead the page**, above everything else, rather
 *   than sitting in their pen's section. Somebody reading the top of a phone
 *   screen and no further has to have read that part.
 */

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const formatDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function SitterScreen({
  farmName,
  view,
  chores,
  day,
  mayTick,
  closed,
  unavailable,
}: {
  readonly farmName: string;
  readonly view: SitterView;
  readonly chores: readonly ChoreEntry[];
  readonly day: Date;
  readonly mayTick: boolean;
  /** Set when the visit window is why the page is empty. */
  readonly closed?: { readonly from: Date; readonly to: Date } | undefined;
  readonly unavailable?: string | undefined;
}) {
  if (closed !== undefined) {
    return (
      <PageBody>
        <PageHeader eyebrow={farmName} title="Care guide" />
        <Callout tone="danger" title="This visit is over">
          <p>
            Your access ran from {formatDate(closed.from)} to {formatDate(closed.to)}. Outside those
            dates the guide is not shown — it changes as the farm changes, and an out-of-date copy
            is worse than none.
          </p>
          <p className="mt-2">
            If you are still helping out, ask for the dates to be extended and this page will come
            back on its own.
          </p>
        </Callout>
      </PageBody>
    );
  }

  const { guide } = view;
  const now = day;

  const composed = composeGuide(
    guide ?? { title: "Care guide" },
    guideIncludes(guide, "pens")
      ? guideZonesFrom(view.zones, view.assignments, view.animals, now)
      : [],
    view.sections,
    now,
  );
  const dangerous = doNotHandleList(composed);
  const emergency = guideIncludes(guide, "emergency_contacts")
    ? guideEmergencyContacts(view.contacts)
    : [];
  const vets = guideIncludes(guide, "vet") ? guideVets(view.contacts) : [];
  const routine = guideIncludes(guide, "chores") ? guideChores(view.templates, view.zones) : [];
  const pets = guideIncludes(guide, "pets")
    ? petBriefings(
        petsOnFarm(view.animals).map((pet) => ({
          pet,
          feeding: feedingLinesFor(pet.id, view.plans, view.feeds, view.animals).map((text) => ({
            text,
          })),
          medicines: currentMedicinesFor(pet.id, view.petHealth, now),
        })),
      )
    : [];

  return (
    <PageBody>
      <PageHeader
        eyebrow={farmName}
        title={composed.title}
        subtitle={formatDay(day)}
        meta="Everything here is read from the farm's own records, so it is current as you look at it."
      />

      {unavailable === undefined ? null : (
        <Callout tone="danger" title="Could not load the guide">
          {unavailable}
        </Callout>
      )}

      {guide === undefined && unavailable === undefined ? (
        <EmptyState
          title="No guide has been written yet"
          detail="Ask whoever asked you to help. Until there is one, this page has nothing to tell you — which is better than telling you something nobody checked."
        />
      ) : null}

      {dangerous.length === 0 ? null : (
        <Callout tone="danger" title="Do not handle these on your own">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {dangerous.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Callout>
      )}

      {composed.intro === undefined ? null : (
        <Section title="Before anything else">
          <p className="whitespace-pre-wrap text-density text-ink">{composed.intro}</p>
        </Section>
      )}

      <SitterChores entries={chores} day={day} zones={view.zones} mayTick={mayTick} />

      {emergency.length === 0 && vets.length === 0 ? null : (
        <Section
          title="Who to ring"
          description="Tap a number to call it. If something is wrong and you are not sure, ring rather than wait."
        >
          <ul className="flex flex-col gap-density">
            {[...emergency, ...vets].map((person) => (
              <li key={`${person.id}-${person.name}`} className="flex flex-col">
                <span className="text-density font-medium text-ink">
                  {person.name}
                  {person.company === undefined ? null : (
                    <span className="font-normal text-muted"> · {person.company}</span>
                  )}
                </span>
                {person.phone === undefined ? (
                  <span className="text-sm text-danger">No number on file</span>
                ) : (
                  <a className="text-density text-action underline" href={`tel:${person.phone}`}>
                    {person.phone}
                  </a>
                )}
                {person.note === undefined ? null : (
                  <span className="text-sm text-muted">{person.note}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {composed.pens.length === 0 ? null : (
        <Section
          title="The pens"
          description="Worst first. The badge is the pen's level or its most difficult occupant's, whichever is higher."
        >
          <div className="flex flex-col gap-density">
            {composed.pens.map((pen) => (
              <div key={pen.zoneId} className="border-l-2 border-edge pl-4">
                <h3 className="flex flex-wrap items-center gap-2 text-ink">
                  <SafetyBadge level={pen.effectiveLevel} showLabel size="compact" />
                  {pen.zoneName}
                </h3>

                {pen.animals.length === 0 ? (
                  <p className="text-sm text-muted">Empty at the moment.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1 text-density text-ink">
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
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
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
          </div>
        </Section>
      )}

      {pets.length === 0 ? null : (
        <Section title="The dogs and cats">
          <div className="flex flex-col gap-density">
            {pets.map((pet) => (
              <div key={pet.animalId} className="border-l-2 border-edge pl-4">
                <h3 className="flex flex-wrap items-center gap-2 text-ink">
                  <SafetyBadge level={pet.safetyLevel} showLabel size="compact" />
                  {pet.name}
                  <span className="font-body text-sm font-normal text-muted">{pet.species}</span>
                </h3>
                {pet.safetyNotes === undefined ? null : (
                  <p className="text-sm text-ink">{pet.safetyNotes}</p>
                )}
                {pet.instructions === undefined ? null : (
                  <p className="whitespace-pre-wrap text-sm text-ink">{pet.instructions}</p>
                )}
                {pet.feeding.length === 0 ? (
                  <p className="text-sm text-danger">
                    No ration written down — ask before feeding rather than guessing.
                  </p>
                ) : (
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
                    {pet.feeding.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {pet.medicines.length === 0 ? null : (
                  <p className="mt-1 text-sm text-ink">
                    <strong>On now:</strong> {pet.medicines.join("; ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {routine.length === 0 ? null : (
        <Section
          title="The routine"
          description="The standing arrangement, for the days beyond today's list."
        >
          <ul className="flex flex-col gap-1 text-density text-ink">
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
        </Section>
      )}

      {composed.custom.map((section) => (
        <Section key={section.id} title={section.title}>
          <p className="whitespace-pre-wrap text-density text-ink">{section.bodyMarkdown}</p>
        </Section>
      ))}

      <p className="text-sm text-muted">
        Anything not covered here, ring rather than guess. Thank you for looking after the place.
      </p>
    </PageBody>
  );
}
