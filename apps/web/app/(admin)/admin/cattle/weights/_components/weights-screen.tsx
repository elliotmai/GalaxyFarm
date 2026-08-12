"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Meter,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Select,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
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

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

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

  const columns: readonly Column<WeightRecord>[] = [
    {
      key: "animal",
      header: "Animal",
      primary: true,
      render: (record) => {
        const animal = byId.get(record.animalId);
        return animal === undefined ? (
          <span className="text-muted">Unknown</span>
        ) : (
          <Link
            href={animalHref(animal)}
            className="font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
          >
            {displayName(animal)}
          </Link>
        );
      },
    },
    { key: "date", header: "Date", render: (record) => formatDate(record.date) },
    { key: "weight", header: "Weight", numeric: true, render: (record) => lb(record.weightLb) },
    {
      key: "context",
      header: "Context",
      render: (record) => (
        <Pill tone={record.context === "birth" ? "identity" : "neutral"}>{record.context}</Pill>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (record) => (
        <Button variant="ghost" onClick={() => void remove(record)}>
          Delete
        </Button>
      ),
    },
  ];

  const withBirth = growth.filter((row) => row.birth !== undefined).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Weights"
        subtitle="Birth weights are the reliable ones. Every figure below says what it assumes, and the 205-day weight is unadjusted."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Weights taken" value={weights.length} />
        <Tile label="Animals weighed" value={growth.length} tone="identity" />
        <Tile label="With a birth weight" value={withBirth} tone="calm" hint="The reliable ones" />
        <Tile
          label="Best lifetime ADG"
          value={
            growth.length === 0
              ? "—"
              : `${Math.max(...growth.map((row) => row.adg ?? 0)).toFixed(2)} lb/d`
          }
        />
      </div>

      <Section title="Record a weight">
        <AddWeight animals={animals} api={api} />
      </Section>

      {growth.length === 0 ? null : (
        <Section
          title="How they are growing"
          description="Average daily gain is first weight to last, not an average of the intervals — the intervals are unevenly spaced."
        >
          <div className="grid grid-cols-1 gap-density md:grid-cols-2 xl:grid-cols-3">
            {growth.map((row) => (
              <RecordCard
                key={row.animalId}
                tone={row.adg !== undefined && row.adg >= 2 ? "calm" : "neutral"}
                title={
                  row.animal === undefined ? (
                    "Unknown animal"
                  ) : (
                    <Link
                      href={animalHref(row.animal)}
                      className="underline decoration-edge underline-offset-4 hover:decoration-action"
                    >
                      {displayName(row.animal)}
                    </Link>
                  )
                }
                subtitle={`${row.count} weight${row.count === 1 ? "" : "s"} · last ${formatDate(row.latest?.date)}`}
                actions={<Pill tone="action">{lb(row.latest?.weightLb)}</Pill>}
                meta={
                  <>
                    {row.adg === undefined ? null : (
                      <Pill tone="calm">{row.adg.toFixed(2)} lb/d lifetime</Pill>
                    )}
                    {row.recent === undefined ? null : (
                      <Pill>{row.recent.toFixed(2)} lb/d since last</Pill>
                    )}
                    {row.w205 === undefined ? null : (
                      <Pill tone="identity">{Math.round(row.w205)} lb at 205 d, unadjusted</Pill>
                    )}
                  </>
                }
              >
                {/*
                  A show calf is aimed at a target weight on a date. Until that
                  target is a field, the bar reads against the heaviest animal
                  on the place — which is at least a real comparison rather
                  than an invented goal.
                */}
                <Meter
                  value={
                    (row.latest?.weightLb ?? 0) /
                    Math.max(...growth.map((other) => other.latest?.weightLb ?? 1))
                  }
                  tone="action"
                  label="Against the heaviest here"
                  detail={lb(row.latest?.weightLb)}
                />
              </RecordCard>
            ))}
          </div>
        </Section>
      )}

      <Section title="Every weight">
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="Weight records"
              columns={columns}
              rows={[...weights].sort((a, b) => b.date.getTime() - a.date.getTime())}
              rowKey={(record) => record.id}
              empty={
                <EmptyState
                  title="Nothing weighed yet"
                  detail="A birth weight is the one worth having. Everything after it is a scale in a chute and an animal that would rather not be on it."
                />
              }
            />
          </Card>
        )}
      </Section>
    </PageBody>
  );
}

function AddWeight({
  animals,
  api,
}: {
  readonly animals: readonly Animal[];
  readonly api: ReturnType<typeof useMutations<WeightRecord>>;
}) {
  const { show } = useToast();
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
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Animal"
          value={animalId}
          onChange={(event) => setAnimalId(event.target.value)}
          placeholder="Choose an animal"
          options={animals
            .filter((entry) => entry.status === "active")
            .map((entry) => ({ value: entry.id, label: displayName(entry) }))}
          required
        />
        <TextInput
          label="Weight (lb)"
          type="number"
          inputMode="decimal"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          required
        />
        <Select
          label="Context"
          hint="Birth, weaning and yearling are the ones that feed a figure."
          value={context}
          onChange={(event) => setContext(event.target.value as WeightContext)}
          options={WEIGHT_CONTEXTS.map((value) => ({ value, label: value }))}
        />
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" busy={busy}>
        Record weight
      </Button>
    </form>
  );
}
