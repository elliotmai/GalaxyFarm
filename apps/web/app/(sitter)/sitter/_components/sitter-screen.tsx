import type { ReactNode } from "react";

import { Callout, EmptyState, SafetyBadge } from "@galaxy-farm/ui";
import type { ChoreEntry, Ulid } from "@galaxy-farm/core";
import { composeGuide, doNotHandleList } from "@galaxy-farm/module-housesitting";
import { petBriefings, petsOnFarm } from "@galaxy-farm/module-pets";

import { SitterChores } from "@/app/(sitter)/sitter/_components/sitter-chores";
import {
  guideChores,
  guideEmergencyContacts,
  guideFeedingPlans,
  guideVets,
  guideZonesFrom,
  type GuideContact,
} from "@/lib/guide-composition";
import type { PeopleNames } from "@/lib/people-names";
import { currentMedicinesFor, feedingLinesFor } from "@/lib/pet-care";
import { guideIncludes, type SitterView } from "@/lib/sitter-store";

/**
 * The care guide as a helper reads it (spec §5.10).
 *
 * The same composition the admin preview and the printed PDF use, laid out
 * for a phone held in one hand at feeding time. The order is the order a
 * sitter needs things in, not the order the guide was written in:
 *
 * - **The dangerous animals lead the page**, above everything else, rather
 *   than sitting in their pen's section. Somebody reading the top of a phone
 *   screen and no further has to have read that part.
 * - **Today's jobs come next**, ticked in place — the one write a housesitter
 *   has, and the reason they opened the page this morning.
 * - **Help is one tap away from anywhere.** A bar pinned to the foot of the
 *   screen rings the first emergency number, and the full list sits straight
 *   under the jobs. Scrolling to the bottom of a guide to find the vet's
 *   number is not something to ask of somebody holding a calf.
 * - **The reference folds.** Pens, rations, pets and the routine are read
 *   once and looked up after, so each is one line with a count until opened.
 */

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

const formatDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The page's own column: phone-width measure, a 16px gutter, clear of the call bar. */
function Column({
  children,
  callBar,
}: {
  readonly children: ReactNode;
  readonly callBar: boolean;
}) {
  return (
    <main
      className={[
        "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-5",
        callBar ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))]" : "pb-10",
      ].join(" ")}
    >
      {children}
    </main>
  );
}

function Header({ farmName, title, day }: { farmName: string; title: string; day?: Date }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{farmName}</p>
      <h1 className="text-ink">{title}</h1>
      {day === undefined ? null : <p className="text-sm text-muted">{formatDay(day)}</p>}
    </header>
  );
}

/** A small uppercase label over a list — the admin's section heading. */
function Label({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <h2 id={id} className="font-body text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </h2>
  );
}

const LIST =
  "flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel";

/**
 * Reference, folded to one line with a count.
 *
 * A `details` rather than a client toggle: this page renders on the server,
 * and a fold that needs JavaScript to open is a fold that stays shut on the
 * slow phone a guest is most likely to be holding.
 */
function Fold({
  title,
  fact,
  children,
}: {
  readonly title: string;
  readonly fact?: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="group rounded-density border border-rule bg-panel">
      <summary className="flex min-h-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 font-semibold text-ink">
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 text-muted transition-transform group-open:rotate-90"
          >
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="min-w-0">{title}</span>
        </span>
        {fact === undefined ? null : <span className="shrink-0 text-sm text-muted">{fact}</span>}
      </summary>
      <div className="flex flex-col gap-3 border-t border-rule px-4 py-3">{children}</div>
    </details>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path
        d="M6.6 3.5h2.6l1.4 4-2 1.3a12 12 0 006.6 6.6l1.3-2 4 1.4v2.6a2 2 0 01-2.2 2A17 17 0 014.6 5.7a2 2 0 012-2.2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The number to ring, pinned to the foot of the screen.
 *
 * The first emergency contact with a number — `guideEmergencyContacts` already
 * puts those first — and a jump to the rest. Fixed rather than at the top of
 * the page so it is under the thumb whatever has been scrolled to.
 */
function CallBar({ first }: { readonly first: GuideContact & { readonly phone: string } }) {
  return (
    <nav
      aria-label="Get help"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-panel px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <a
          href={`tel:${first.phone}`}
          className="flex min-h-target min-w-0 flex-1 items-center justify-center gap-2 rounded-density bg-action px-4 font-semibold text-action-ink"
        >
          <PhoneIcon />
          <span className="truncate">Call {first.name}</span>
        </a>
        <a
          href="#who-to-ring"
          className="flex min-h-target shrink-0 items-center rounded-density border border-edge px-4 font-semibold text-ink hover:bg-raised"
        >
          All numbers
        </a>
      </div>
    </nav>
  );
}

export function SitterScreen({
  farmName,
  view,
  chores,
  day,
  mayTick,
  actorId,
  names,
  closed,
  unavailable,
}: {
  readonly farmName: string;
  readonly view: SitterView;
  readonly chores: readonly ChoreEntry[];
  readonly day: Date;
  readonly mayTick: boolean;
  /** The sitter, so their own ticks read "Done by you". */
  readonly actorId?: Ulid | undefined;
  /** Who ticked what, resolved on the server; never rejects. */
  readonly names?: Promise<PeopleNames> | undefined;
  /** Set when the visit window is why the page is empty. */
  readonly closed?: { readonly from: Date; readonly to: Date } | undefined;
  readonly unavailable?: string | undefined;
}) {
  if (closed !== undefined) {
    return (
      <Column callBar={false}>
        <Header farmName={farmName} title="Care guide" />
        <Callout tone="danger" title="This visit is over">
          <p>
            Your access ran {formatDate(closed.from)} to {formatDate(closed.to)}. An out-of-date
            guide is worse than none, so it is not shown outside those dates.
          </p>
          <p className="mt-2">Still helping out? Ask for the dates to be extended.</p>
        </Callout>
      </Column>
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
  const people = [...emergency, ...vets];
  const first = people.find(
    (person): person is GuideContact & { readonly phone: string } => person.phone !== undefined,
  );
  const routine = guideIncludes(guide, "chores") ? guideChores(view.templates, view.zones) : [];
  const feeding = guideIncludes(guide, "cattle_feeding")
    ? guideFeedingPlans(view.plans, view.feeds, view.animals, view.zones, view.assignments, now)
    : [];
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
  const head = composed.pens.reduce((sum, pen) => sum + pen.animals.length, 0);

  return (
    <Column callBar={first !== undefined}>
      <Header farmName={farmName} title={composed.title} day={day} />

      {unavailable === undefined ? null : (
        <Callout tone="danger" title="Could not load the guide">
          {unavailable}
        </Callout>
      )}

      {guide === undefined && unavailable === undefined ? (
        <EmptyState
          title="No guide written yet"
          detail="Ask whoever asked you to help — nothing here is better than something nobody checked."
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

      <SitterChores
        entries={chores}
        day={day}
        zones={view.zones}
        mayTick={mayTick}
        actorId={actorId}
        names={names}
      />

      {people.length === 0 ? null : (
        <section aria-labelledby="who-to-ring" className="flex scroll-mt-4 flex-col gap-2.5">
          <Label id="who-to-ring">Who to ring</Label>
          <ul className={LIST}>
            {people.map((person) => (
              <li
                key={`${person.id}-${person.name}`}
                className="flex min-h-[64px] items-center gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-semibold text-ink">
                    {person.name}
                    {person.company === undefined ? null : (
                      <span className="font-normal text-muted"> · {person.company}</span>
                    )}
                  </span>
                  {person.note === undefined ? null : (
                    <span className="text-sm text-muted">{person.note}</span>
                  )}
                </span>
                {person.phone === undefined ? (
                  <span className="shrink-0 text-sm text-danger">No number</span>
                ) : (
                  <a
                    href={`tel:${person.phone}`}
                    className="flex min-h-target shrink-0 items-center gap-1.5 rounded-density border border-action px-3 text-sm font-semibold text-action [font-variant-numeric:tabular-nums]"
                  >
                    <PhoneIcon />
                    {person.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {composed.intro === undefined && composed.custom.length === 0 ? null : (
        <section aria-labelledby="good-to-know" className="flex flex-col gap-2.5">
          <Label id="good-to-know">Good to know</Label>
          {composed.intro === undefined ? null : (
            <p className="whitespace-pre-wrap rounded-density border border-rule bg-panel px-4 py-3 text-density text-ink">
              {composed.intro}
            </p>
          )}
          {composed.custom.map((section) => (
            <Fold key={section.id} title={section.title}>
              <p className="whitespace-pre-wrap text-density text-ink">{section.bodyMarkdown}</p>
            </Fold>
          ))}
        </section>
      )}

      {composed.pens.length === 0 &&
      feeding.length === 0 &&
      pets.length === 0 &&
      routine.length === 0 ? null : (
        <section aria-labelledby="the-animals" className="flex flex-col gap-2.5">
          <Label id="the-animals">The animals</Label>

          {composed.pens.length === 0 ? null : (
            <Fold title="The pens" fact={`${composed.pens.length} pens · ${head} head`}>
              {/* Worst first: the badge is the pen's level or its most
                  difficult occupant's, whichever is higher. */}
              {composed.pens.map((pen) => (
                <div key={pen.zoneId} className="flex flex-col gap-1">
                  <h3 className="flex flex-wrap items-center gap-2 text-density text-ink">
                    <SafetyBadge level={pen.effectiveLevel} showLabel size="compact" />
                    {pen.zoneName}
                  </h3>
                  {pen.animals.length === 0 ? (
                    <p className="text-sm text-muted">Empty</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5 text-density text-ink">
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
            </Fold>
          )}

          {feeding.length === 0 ? null : (
            <Fold title="Feeding the cattle" fact={`${feeding.length}`}>
              {/* The one hint kept: some amounts are each, some are between
                  them, and scooping the wrong one is a real mistake. */}
              <p className="text-sm text-muted">
                Read the line under each heading before you scoop.
              </p>
              {feeding.map((plan) => (
                <div key={plan.id} className="flex flex-col gap-1">
                  <h3 className="text-density text-ink">
                    {plan.who}
                    <span className="font-body text-sm font-normal text-muted"> · {plan.name}</span>
                  </h3>
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
            </Fold>
          )}

          {pets.length === 0 ? null : (
            <Fold title="The dogs and cats" fact={`${pets.length}`}>
              {pets.map((pet) => (
                <div key={pet.animalId} className="flex flex-col gap-1">
                  <h3 className="flex flex-wrap items-center gap-2 text-density text-ink">
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
                    <p className="text-sm text-danger">No ration written down — ask first.</p>
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
            </Fold>
          )}

          {routine.length === 0 ? null : (
            <Fold title="The routine" fact="beyond today">
              <ul className="flex flex-col gap-1.5 text-density text-ink">
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
        </section>
      )}

      <p className="text-sm text-muted">Not covered here? Ring rather than guess. Thank you.</p>

      {first === undefined ? null : <CallBar first={first} />}
    </Column>
  );
}
