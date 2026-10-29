"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ComponentType } from "react";

import type { Animal, Ulid } from "@galaxy-farm/core";

import { useRecords } from "@/lib/local/use-records";

import { BreedingDetails } from "./breeding-details";
import { CalvingDetails } from "./calving-details";
import { EggsDetails } from "./eggs-details";
import { FeedingDetails } from "./feeding-details";
import {
  eligible,
  needsAnimals,
  partnerOf,
  returnTo,
  singleAnimal,
  startFrom,
  TILES,
  type LogKind,
  type LogStart,
  type Step,
} from "./log-kinds";
import { StepBody, type DetailsProps, type SavedSummary } from "./log-parts";
import { MoveDetails } from "./move-details";
import { NotePhotoDetails } from "./note-photo-details";
import { SuppliesDetails } from "./supplies-details";
import { TreatmentDetails } from "./treatment-details";
import { WeightDetails } from "./weight-details";
import { WhoStep } from "./who-step";

/**
 * ＋ Log — record something in four full-screen steps: what, who, details,
 * saved (spec §8: every frequent action two taps from its context).
 *
 * Other screens link straight into the middle of it:
 * `/admin/log?kind=treatment&animals=<id>,<id>` opens on the details with
 * those animals chosen, so "Treatment" on a cow's page is one tap from the
 * form, and `&from=<page>` is where Close and Done go back to. See `startFrom` in `log-kinds.ts` for the exact rules.
 *
 * Nothing here writes on its own. Each kind's form writes through the same
 * mutation path and schema as the screen that owns that record, so a weight
 * logged here and a weight logged on the weights screen are the same thing.
 *
 * On a phone it covers the whole screen, tab bar included — it is a task, not
 * a place — and on a desk it sits in a centred column.
 */

const DETAILS: Readonly<Record<LogKind, ComponentType<DetailsProps>>> = {
  treatment: TreatmentDetails,
  weight: WeightDetails,
  calving: CalvingDetails,
  heat: BreedingDetails,
  breeding: BreedingDetails,
  move: MoveDetails,
  photo: NotePhotoDetails,
  note: NotePhotoDetails,
  eggs: EggsDetails,
  feeding: FeedingDetails,
  supplies: SuppliesDetails,
};

export function LogFlow({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const params = useSearchParams();
  const { records: animals, loading } = useRecords<Animal>("animals", { propertyId });

  const asked = { kind: params.get("kind"), animals: params.get("animals") };
  const home = returnTo(params.get("from"));
  // Linked animals can only be checked against the herd once it has loaded,
  // so the flow waits for it rather than opening on the wrong step.
  const waiting = loading && (asked.animals ?? "") !== "";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-canvas md:relative md:inset-auto md:z-auto md:mx-auto md:w-full md:max-w-[560px] md:bg-transparent">
      {waiting ? (
        <Shell step={undefined} onBack={undefined} home={home}>
          <StepBody>
            <p className="text-muted">Looking…</p>
          </StepBody>
        </Shell>
      ) : (
        <Flow
          propertyId={propertyId}
          actorId={actorId}
          animals={animals}
          start={startFrom(asked, animals)}
          home={home}
        />
      )}
    </div>
  );
}

function Flow({
  propertyId,
  actorId,
  animals,
  start,
  home,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly animals: readonly Animal[];
  readonly start: LogStart;
  /** The page the Log was opened from, which Close and Done return to. */
  readonly home: string;
}) {
  // The opening state is read once: the query says where to start, not where
  // to stay, and "Log something else" must not be pulled back to it.
  const [initial] = useState(start);
  const [step, setStep] = useState<Step>(initial.step);
  const [kind, setKind] = useState<LogKind | undefined>(initial.kind);
  const [selected, setSelected] = useState<readonly Ulid[]>(initial.animalIds);
  const [saved, setSaved] = useState<SavedSummary | undefined>();

  const byId = useMemo(() => new Map(animals.map((animal) => [animal.id, animal])), [animals]);
  const chosen = selected
    .map((id) => byId.get(id))
    .filter((animal): animal is Animal => animal !== undefined);

  function pick(next: LogKind) {
    setKind(next);
    // Keep whoever is already chosen and can take this kind — someone who
    // came from a cow's page and changed their mind about what to log still
    // means her.
    const keep = selected.filter((id) => {
      const animal = byId.get(id);
      return animal !== undefined && eligible(next, animal);
    });
    const kept = singleAnimal(next) ? keep.slice(0, 1) : keep;
    setSelected(kept);
    setStep(needsAnimals(next) ? 2 : 3);
  }

  function back() {
    if (step === 3 && kind !== undefined && needsAnimals(kind)) setStep(2);
    else setStep(1);
  }

  function again() {
    setSaved(undefined);
    setKind(undefined);
    setSelected(initial.animalIds);
    setStep(1);
  }

  const Details = kind === undefined ? undefined : DETAILS[kind];

  return (
    <Shell step={step} onBack={step === 2 || step === 3 ? back : undefined} home={home}>
      {step === 1 ? (
        <StepBody>
          <h1 className="text-ink">Log what?</h1>
          <ul className="grid grid-cols-2 gap-2.5">
            {TILES.map((tile) => (
              <li key={tile.kind} className="flex">
                <button
                  type="button"
                  onClick={() => pick(tile.kind)}
                  className="flex min-h-[92px] w-full flex-col items-start justify-between gap-2.5 rounded-density border border-rule bg-panel p-3.5 text-left font-semibold text-ink hover:border-edge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                >
                  {tile.label}
                  <span className="text-xs font-normal text-muted">{tile.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </StepBody>
      ) : null}

      {step === 2 && kind !== undefined ? (
        <WhoStep
          propertyId={propertyId}
          kind={kind}
          animals={animals}
          selected={selected}
          onSelected={setSelected}
          onNext={() => setStep(3)}
        />
      ) : null}

      {step === 3 && Details !== undefined && kind !== undefined ? (
        <Details
          // A fresh form for each kind, so heat's fields never leak into a breeding.
          key={kind}
          propertyId={propertyId}
          actorId={actorId}
          kind={kind}
          onKind={(next) => {
            if (next === partnerOf(kind)) setKind(next);
          }}
          animals={chosen}
          onSaved={(summary) => {
            setSaved(summary);
            setStep(4);
          }}
        />
      ) : null}

      {step === 4 && saved !== undefined ? (
        <Saved summary={saved} onAgain={again} home={home} />
      ) : null}
    </Shell>
  );
}

/** The bar across the top — Back, which step, Close — and the step below it. */
function Shell({
  step,
  onBack,
  home,
  children,
}: {
  readonly step: Step | undefined;
  readonly onBack: (() => void) | undefined;
  readonly home: string;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <header className="flex items-center justify-between px-2.5 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-0">
        {onBack === undefined ? (
          <span className="w-11" />
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-target items-center px-1.5 font-medium text-action focus-visible:outline-2 focus-visible:outline-action"
          >
            <span aria-hidden="true">‹&nbsp;</span>Back
          </button>
        )}
        <span className="text-sm font-medium text-muted">
          {step === undefined || step === 4 ? "" : `Step ${step} of 3`}
        </span>
        <Link
          href={home}
          className="inline-flex min-h-target items-center px-1.5 font-medium text-action focus-visible:outline-2 focus-visible:outline-action"
        >
          Close
        </Link>
      </header>
      {children}
    </>
  );
}

function Saved({
  summary,
  onAgain,
  home,
}: {
  readonly summary: SavedSummary;
  readonly onAgain: () => void;
  readonly home: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 overflow-y-auto px-6 py-10 text-center">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-calm/15 text-calm">
        <svg
          aria-hidden="true"
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5 9-10" />
        </svg>
      </span>
      {/* Announced, so a screen reader hears the save land. */}
      <div role="status" className="flex flex-col gap-2">
        <h1 className="text-ink">{summary.headline}</h1>
        {summary.detail === undefined || summary.detail === "" ? null : (
          <p className="text-muted">{summary.detail}</p>
        )}
      </div>
      {summary.followUp}
      <div className="mt-3 flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={onAgain}
          className="inline-flex min-h-14 w-full items-center justify-center rounded-density bg-action text-base font-semibold text-action-ink hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Log something else
        </button>
        <Link
          href={home}
          className="inline-flex min-h-[52px] w-full items-center justify-center rounded-density border border-edge bg-panel text-base font-semibold text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Done
        </Link>
      </div>
    </div>
  );
}
