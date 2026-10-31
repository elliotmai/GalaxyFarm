"use client";

import { useId, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  PageBody,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
  toOptions,
} from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  averageDailyGain,
  lifetimeGain,
  unadjusted205DayWeight,
  weightRecordSchema,
  weightsFor,
  weightIn,
  WEIGHT_CONTEXTS,
  type WeightContext,
  type WeightRecord,
} from "@galaxy-farm/module-cattle";

import {
  AddFab,
  Chip,
  ChipRow,
  facts,
  Row,
  Rows,
  ScreenHeader,
} from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { animalHref } from "@/lib/animal-slug";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Weights, and what they imply (spec §5.2, issue #20).
 *
 * "Birth weights are the reliable ones" — everything after that is a scale in
 * a chute and an animal that would rather not be on it. So every derived
 * figure here states what it assumes, and the 205-day weight is labelled
 * **unadjusted** wherever it appears: quoting an unadjusted weight to a buyer
 * as an adjusted one is a real problem, not a rounding difference.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function lb(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value)} lb`;
}

export function WeightsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: weights, loading } = useRecords<WeightRecord>("weightRecords", query);

  const api = useMutations<WeightRecord>(
    "weightRecords",
    "weightRecords",
    weightRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const [view, setView] = useState<"growth" | "log">("growth");
  const [adding, setAdding] = useState(false);

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  // One Animal model serves every species (§2), so the store hands this screen
  // the hens and the dogs alongside the herd. A weight is recorded against
  // cattle here, and the picker below says so.
  const cattle = useMemo(() => animals.filter((a) => a.species === "cattle"), [animals]);

  /** One row per animal that has ever been weighed, with what follows from it. */
  const growth = useMemo(() => {
    const weighed = [...new Set(weights.map((w) => w.animalId))];

    return weighed
      .map((animalId) => {
        const series = weightsFor(weights, animalId);
        const birth = weightIn(weights, animalId, "birth");
        const weaning = weightIn(weights, animalId, "weaning");
        const latest = series[series.length - 1];

        return {
          animalId,
          animal: byId.get(animalId),
          count: series.length,
          latest,
          birth,
          adg: lifetimeGain(weights, animalId),
          // Unadjusted, and said so everywhere it is shown. The age-of-dam and
          // sex adjustment factors are a future enhancement per §5.2.
          w205:
            birth === undefined || weaning === undefined
              ? undefined
              : unadjusted205DayWeight(birth, weaning),
          recent:
            series.length >= 2
              ? averageDailyGain(series[series.length - 2] as WeightRecord, latest as WeightRecord)
              : undefined,
        };
      })
      .sort(
        (left, right) => (right.latest?.date.getTime() ?? 0) - (left.latest?.date.getTime() ?? 0),
      );
  }, [weights, byId]);

  async function remove(record: WeightRecord) {
    const animal = byId.get(record.animalId);
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${record.weightLb} lb for ${animal === undefined ? "an animal" : displayName(animal)} on ${formatDate(record.date)}`,
      entity: "weight",
      // Every gain figure is derived from the series, so removing a point
      // silently moves them all. Saying which ones is the difference between a
      // considered delete and a surprised one.
      dependents: [
        { entity: "Average daily gain", label: "recomputed", effect: "deleted" as const },
        ...(record.context === "birth" || record.context === "weaning"
          ? [
              {
                entity: "205-day weight",
                label: "cannot be computed without it",
                effect: "deleted" as const,
              },
            ]
          : []),
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(record.id, "Removed from the weight log");
    show({ message: "Weight deleted", tone: "danger" });
  }

  const withBirth = growth.filter((row) => row.birth !== undefined).length;
  const bestAdg = growth.length === 0 ? undefined : Math.max(...growth.map((row) => row.adg ?? 0));
  const log = [...weights].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <PageBody>
      {/* Bottom clearance on a phone, so the floating button never covers a row. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <ScreenHeader
          title="Weights"
          facts={facts(
            `${growth.length} weighed`,
            withBirth > 0 && `${withBirth} with a birth weight`,
            bestAdg !== undefined && bestAdg > 0 && `best ${bestAdg.toFixed(2)} lb/d`,
          )}
          action={
            <span className="hidden sm:block">
              <Button variant="primary" aria-haspopup="dialog" onClick={() => setAdding(true)}>
                <span aria-hidden="true">+</span> Record weight
              </Button>
            </span>
          }
        />

        {/*
          Two real views of one log: how each animal is growing, which is what
          the screen is for, and the weighings themselves, which is where a
          mistyped one gets found and deleted.
        */}
        <ChipRow label="View">
          <Chip on={view === "growth"} onClick={() => setView("growth")}>
            By animal
          </Chip>
          <Chip on={view === "log"} onClick={() => setView("log")}>
            Every weight
            <span className="gf-numeric text-xs opacity-80">{weights.length}</span>
          </Chip>
        </ChipRow>

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : weights.length === 0 ? (
          <EmptyState
            title="Nothing weighed yet"
            detail="A birth weight is the one worth having."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Record a weight
              </Button>
            }
          />
        ) : view === "growth" ? (
          <Section
            title="How they are growing"
            description="Average daily gain is first weight to last, not an average of the intervals — the intervals are unevenly spaced. The 205-day weight is unadjusted."
          >
            <Rows label="Animals weighed">
              {growth.map((row) => (
                <Row
                  key={row.animalId}
                  title={row.animal === undefined ? "Unknown animal" : displayName(row.animal)}
                  href={row.animal === undefined ? undefined : animalHref(row.animal)}
                  line={facts(
                    `last ${formatDate(row.latest?.date)}`,
                    row.adg !== undefined && `${row.adg.toFixed(2)} lb/d lifetime`,
                    row.recent !== undefined && `${row.recent.toFixed(2)} since last`,
                    // Unadjusted, and said so everywhere it is shown.
                    row.w205 !== undefined && `205 d ${Math.round(row.w205)} lb unadj.`,
                  )}
                  chip={<Weight lb={row.latest?.weightLb} />}
                />
              ))}
            </Rows>
          </Section>
        ) : (
          <Rows label="Weight records">
            {log.map((record) => {
              const animal = byId.get(record.animalId);
              const name = animal === undefined ? "Unknown animal" : displayName(animal);
              return (
                <Row
                  key={record.id}
                  title={name}
                  href={animal === undefined ? undefined : animalHref(animal)}
                  line={facts(formatDate(record.date), record.context)}
                  notes={record.notes}
                  chip={<Weight lb={record.weightLb} />}
                  action={
                    <button
                      type="button"
                      onClick={() => void remove(record)}
                      aria-label={`Delete ${record.weightLb} lb for ${name} on ${formatDate(record.date)}`}
                      className="inline-flex min-h-target min-w-target items-center justify-center rounded-full text-muted hover:bg-raised hover:text-danger focus-visible:outline-2 focus-visible:outline-action"
                    >
                      <TrashIcon />
                    </button>
                  }
                />
              );
            })}
          </Rows>
        )}

        <AddFab onClick={() => setAdding(true)}>Record weight</AddFab>

        {adding ? <AddWeight cattle={cattle} api={api} onClose={() => setAdding(false)} /> : null}
      </div>
    </PageBody>
  );
}

/** The figure a weight row is about, set in the numeric face so a column of them lines up. */
function Weight({ lb: value }: { readonly lb: number | undefined }) {
  return <span className="gf-numeric font-semibold text-ink">{lb(value)}</span>;
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

/**
 * The form, in a side panel (a bottom sheet on a phone).
 *
 * It stays open after a weight is saved, with the animal and the context kept
 * and the weight cleared: weighing goes down a line of calves in a chute, and
 * the next one is the same form again.
 */
function AddWeight({
  cattle,
  api,
  onClose,
}: {
  /** The herd, already narrowed to cattle — never the whole menagerie. */
  readonly cattle: readonly Animal[];
  readonly api: ReturnType<typeof useMutations<WeightRecord>>;
  readonly onClose: () => void;
}) {
  const { show } = useToast();
  // The save button is in the panel's footer and names this form, so Enter in
  // the weight field and the button are the same submit.
  const formId = useId();
  const [animalId, setAnimalId] = useState("");
  const [weight, setWeight] = useState("");
  const [context, setContext] = useState<WeightContext>("other");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (animalId === "") {
      setError("Choose the animal");
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        animalId: animalId as Ulid,
        date: new Date(`${date}T12:00:00`),
        weightLb: Number(weight),
        context,
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      setWeight("");
      setNotes("");
      show({ message: "Weight recorded", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title="Record a weight"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            Record weight
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <Select
          label="Animal"
          value={animalId}
          onChange={(event) => setAnimalId(event.target.value)}
          placeholder="Choose an animal"
          options={cattle
            .filter((entry) => entry.status === "active")
            .map((entry) => ({ value: entry.id, label: displayName(entry) }))}
          required
        />
        <TextInput
          label="Weight (lb)"
          type="number"
          inputMode="decimal"
          numeric
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          required
        />
        <Select
          label="Context"
          hint="Birth, weaning and yearling feed a figure."
          value={context}
          onChange={(event) => setContext(event.target.value as WeightContext)}
          options={toOptions(WEIGHT_CONTEXTS)}
        />
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
