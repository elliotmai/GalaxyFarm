"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  DetailList,
  EmptyState,
  PageBody,
  PageHeader,
  Section,
  Select,
  Stat,
  StatRow,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  animalSchema,
  displayName,
  type Animal,
  type SafetyLevel,
  type Ulid,
} from "@galaxy-farm/core";
import {
  CALF_VIGOUR,
  CALVING_EASE,
  calvingInterval,
  calvingRecordSchema,
  isInCalvingWindow,
  producedLiveCalf,
  projectedDueDate,
  serviceFor,
  suggestedCalfTag,
  type BreedingRecord,
  type CalfVigour,
  type CalvingEase,
  type CalvingRecord,
} from "@galaxy-farm/module-cattle";

import { animalHref } from "@/lib/animal-slug";
import { useRecordCalving, type CalvingOutcome } from "@/lib/calving-flow";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Calving (spec §5.2, issue #13).
 *
 * The screen is a form and a list, and almost all of the work is what happens
 * between them: recording a calving creates the calf, wires its pedigree to the
 * dam and the service sire, files the birth weight as a `WeightRecord`, and
 * announces `CalvingRecorded` for the feed module to answer with a creep plan.
 * None of that is a step somebody has to remember.
 *
 * `?dam=<id>` prefills the cow, which is what makes this two taps from her
 * profile and from the calving-watch card rather than a form to fill in from
 * the top.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const EASE_LABELS: Readonly<Record<CalvingEase, string>> = {
  1: "1 — unassisted",
  2: "2 — easy pull",
  3: "3 — hard pull",
  4: "4 — malpresentation",
  5: "5 — caesarean",
};

export function CalvingScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const params = useSearchParams();
  const { records: animals } = useRecords<Animal>("animals", { propertyId });
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", { propertyId });
  const { records: calvings, loading } = useRecords<CalvingRecord>("calvingRecords", {
    propertyId,
  });

  const calvingsApi = useMutations<CalvingRecord>(
    "calvingRecords",
    "calvingRecords",
    calvingRecordSchema,
    propertyId,
    actorId,
  );
  // The dam's safety level is the only thing this screen edits on an animal,
  // and it goes through the same validated path as everything else.
  const animalsApi = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const now = new Date();
  const byId = useMemo(() => new Map(animals.map((animal) => [animal.id, animal])), [animals]);

  const dams = animals.filter(
    (animal) =>
      animal.species === "cattle" && animal.sex === "female" && animal.status === "active",
  );

  const watching = breedings.filter((record) => isInCalvingWindow(record, now));
  const live = calvings.filter((record) => producedLiveCalf(record));

  async function remove(record: CalvingRecord) {
    const dam = byId.get(record.damId);
    const calf = record.calfAnimalId === undefined ? undefined : byId.get(record.calfAnimalId);

    const confirmed = await confirmDelete({
      // Typed tier, per the issue: this record created a live animal, and a
      // dialog that can be dismissed by tapping in the wrong place is not
      // enough in front of that.
      tier: calf === undefined ? "elevated" : "typed",
      recordName: `${dam === undefined ? "this cow" : displayName(dam)}, calved ${formatDate(record.date)}`,
      entity: "calving record",
      dependents:
        calf === undefined
          ? []
          : [
              {
                entity: "Calf",
                label: displayName(calf),
                // Detached, not deleted. The calf is a living animal and
                // deleting its birth record must not delete it — but its
                // pedigree and birth weight lose the record they came from,
                // which is what this says out loud.
                effect: "detached" as const,
              },
            ],
      consequence:
        calf === undefined
          ? undefined
          : `${displayName(calf)} stays in the herd. Its pedigree and birth weight remain, but nothing will record where they came from.`,
      action: "Delete",
    });
    if (!confirmed) return;

    await calvingsApi.remove(record.id, "Removed from the calving log");
    show({ message: "Calving record deleted", tone: "danger" });
  }

  const columns: readonly Column<CalvingRecord>[] = [
    {
      key: "dam",
      header: "Dam",
      render: (record) => {
        const dam = byId.get(record.damId);
        return dam === undefined ? (
          <span className="text-muted">Unknown</span>
        ) : (
          <Link
            href={animalHref(dam)}
            className="font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
          >
            {displayName(dam)}
          </Link>
        );
      },
    },
    { key: "date", header: "Calved", render: (record) => formatDate(record.date) },
    {
      key: "calf",
      header: "Calf",
      render: (record) => {
        if (record.calfAnimalId === undefined) {
          return <span className="text-muted">{producedLiveCalf(record) ? "—" : "Stillborn"}</span>;
        }
        const calf = byId.get(record.calfAnimalId);
        return calf === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <Link
            href={animalHref(calf)}
            className="text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
          >
            {displayName(calf)}
          </Link>
        );
      },
    },
    {
      key: "ease",
      header: "Ease",
      render: (record) => (
        <span className="[font-variant-numeric:tabular-nums]">{record.calvingEase}</span>
      ),
    },
    {
      key: "weight",
      header: "Birth wt",
      render: (record) => (
        <span className="[font-variant-numeric:tabular-nums]">
          {record.birthWeightLb === undefined ? "—" : `${record.birthWeightLb} lb`}
        </span>
      ),
    },
    {
      key: "vigour",
      header: "Vigour",
      render: (record) =>
        record.vigour === "stillborn" ? (
          <Badge tone="danger">Stillborn</Badge>
        ) : record.vigour === "vigorous" ? (
          <Badge tone="calm">Vigorous</Badge>
        ) : (
          <Badge tone="action">{record.vigour}</Badge>
        ),
    },
    {
      key: "interval",
      header: "Interval",
      // Whether she is holding a yearly interval or slipping — the number that
      // decides whether a cow stays.
      render: (record) => {
        const days = calvingInterval(calvings, record.damId);
        return days === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="[font-variant-numeric:tabular-nums]">{days} d</span>
        );
      },
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

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Calving"
        subtitle="Recording a calving creates the calf, wires its pedigree to the dam and the service sire, and files the birth weight. None of that is a second step."
      />

      <StatRow>
        <Stat label="Calvings" value={calvings.length} />
        <Stat label="Live calves" value={live.length} />
        <Stat
          label="Being watched"
          value={watching.length}
          emphasis={watching.length > 0}
          hint={watching.length > 0 ? "In the window now" : undefined}
        />
        <Stat
          label="Unassisted"
          value={
            calvings.length === 0
              ? "—"
              : `${Math.round((calvings.filter((r) => !r.assisted).length / calvings.length) * 100)}%`
          }
        />
      </StatRow>

      {watching.length === 0 ? null : (
        <Section
          title="Due now"
          description="In the calving window. Recording from here fills in the cow."
        >
          <div className="grid grid-cols-1 gap-density lg:grid-cols-2">
            {watching.map((record) => {
              const dam = byId.get(record.damId);
              return (
                <Card key={record.id}>
                  <DetailList
                    columns={2}
                    items={[
                      { label: "Dam", value: dam === undefined ? undefined : displayName(dam) },
                      { label: "Due", value: formatDate(projectedDueDate(record)) },
                    ]}
                  />
                  <div className="pt-density">
                    <Button
                      onClick={() => {
                        document
                          .querySelector("#record-calving")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      Record her calving
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Record a calving" id="record-calving">
        <RecordCalving
          dams={dams}
          breedings={breedings}
          defaultDamId={params.get("dam") ?? ""}
          propertyId={propertyId}
          actorId={actorId}
          onDamLevel={async (dam, level) => {
            await animalsApi.update(dam.id, {
              safetyLevel: level,
              safetyNotes: `Calf at side since ${formatDate(new Date())} — protective. Clear this when the calf is weaned.`,
            } as Partial<Animal>);
            show({ message: `${displayName(dam)} raised to level ${level}` });
          }}
        />
      </Section>

      <Section title="Every calving">
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : (
          <Card>
            <DataTable
              caption="Calving records"
              columns={columns}
              rows={[...calvings].sort((left, right) => right.date.getTime() - left.date.getTime())}
              rowKey={(record) => record.id}
              empty={
                <EmptyState
                  title="Nothing has calved yet"
                  detail="Andromeda is the first, due 24 November. Recording her calving here creates the calf with its pedigree already wired."
                />
              }
            />
          </Card>
        )}
      </Section>
    </PageBody>
  );
}

/**
 * The form.
 *
 * Two things are worth pointing at. The calf tag prefills from the dam and the
 * year — which is what actually gets written on the tag — because a calf with
 * neither a name nor a tag fails validation and would have made the whole flow
 * unsaveable. And the sire is shown, not asked for: it comes off the service,
 * and showing it is what tells somebody the pedigree is about to be right.
 */
function RecordCalving({
  dams,
  breedings,
  defaultDamId,
  propertyId,
  actorId,
  onDamLevel,
}: {
  readonly dams: readonly Animal[];
  readonly breedings: readonly BreedingRecord[];
  readonly defaultDamId: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onDamLevel: (dam: Animal, level: SafetyLevel) => Promise<void>;
}) {
  const { show } = useToast();
  const record = useRecordCalving(propertyId, actorId);

  const [damId, setDamId] = useState(defaultDamId);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ease, setEase] = useState<CalvingEase>(1);
  const [vigour, setVigour] = useState<CalfVigour>("vigorous");
  const [calfSex, setCalfSex] = useState<"male" | "female" | "unknown">("unknown");
  const [birthWeight, setBirthWeight] = useState("");
  const [assisted, setAssisted] = useState(false);
  const [assistDetail, setAssistDetail] = useState("");
  const [notes, setNotes] = useState("");
  const [tagTouched, setTagTouched] = useState(false);
  const [calfTag, setCalfTag] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CalvingOutcome | undefined>();

  const dam = dams.find((animal) => animal.id === damId);
  const service =
    damId === "" ? undefined : serviceFor(breedings, damId as Ulid, new Date(`${date}T12:00:00`));

  // Prefilled, not imposed: the field follows the dam and the date until
  // somebody types in it, and then it stops moving under them.
  useEffect(() => {
    if (tagTouched) return;
    setCalfTag(suggestedCalfTag(dam, new Date(`${date}T12:00:00`)));
  }, [dam, date, tagTouched]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (damId === "") {
      setError("Choose the cow that calved");
      return;
    }
    const liveCalf = vigour !== "stillborn";
    if (liveCalf && calfTag.trim() === "") {
      setError("Give the calf a tag — an animal with no tag and no name cannot be found later");
      return;
    }
    if (assisted && ease === 1) {
      setError("An assisted calving cannot be ease 1");
      return;
    }

    setBusy(true);
    try {
      const result = await record(
        {
          damId: damId as Ulid,
          date: new Date(`${date}T12:00:00`),
          calvingEase: ease,
          vigour,
          ...(liveCalf ? { calfSex } : {}),
          ...(birthWeight === "" ? {} : { birthWeightLb: Number(birthWeight) }),
          assisted,
          ...(assistDetail.trim() === "" ? {} : { assistDetail: assistDetail.trim() }),
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
          calfTag: calfTag.trim(),
        },
        { dam, breedings },
      );

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setOutcome(result);
      setBirthWeight("");
      setNotes("");
      setAssistDetail("");
      setTagTouched(false);
      show({ message: result.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-density">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Dam"
            value={damId}
            onChange={(event) => setDamId(event.target.value)}
            placeholder="Choose a cow"
            options={dams.map((animal) => ({ value: animal.id, label: displayName(animal) }))}
            required
          />
          <TextInput
            label="Date calved"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
          <Select
            label="Calving ease"
            hint="The industry 1–5 scale."
            value={String(ease)}
            onChange={(event) => setEase(Number(event.target.value) as CalvingEase)}
            options={CALVING_EASE.map((value) => ({
              value: String(value),
              label: EASE_LABELS[value],
            }))}
          />
          <Select
            label="Vigour"
            value={vigour}
            onChange={(event) => setVigour(event.target.value as CalfVigour)}
            options={CALF_VIGOUR.map((value) => ({ value, label: value }))}
          />
          {vigour === "stillborn" ? null : (
            <>
              <Select
                label="Calf sex"
                value={calfSex}
                onChange={(event) =>
                  setCalfSex(event.target.value as "male" | "female" | "unknown")
                }
                options={[
                  { value: "unknown", label: "unknown" },
                  { value: "female", label: "heifer" },
                  { value: "male", label: "bull" },
                ]}
              />
              <TextInput
                label="Calf tag"
                hint="Dam and year, prefilled. Overwrite it if you tag differently."
                value={calfTag}
                onChange={(event) => {
                  setTagTouched(true);
                  setCalfTag(event.target.value);
                }}
                required
              />
            </>
          )}
          <TextInput
            label="Birth weight (lb)"
            hint="Filed as a weight record, not a loose field."
            type="number"
            value={birthWeight}
            onChange={(event) => setBirthWeight(event.target.value)}
          />
          <TextInput
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3">
          <Checkbox
            label="Assisted"
            checked={assisted}
            onChange={(event) => setAssisted(event.target.checked)}
          />
          {assisted ? (
            <TextInput
              label="What was done"
              value={assistDetail}
              onChange={(event) => setAssistDetail(event.target.value)}
            />
          ) : null}
        </div>

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" busy={busy}>
            Record calving
          </Button>
          {damId === "" ? null : (
            <p className="text-sm text-muted">
              {service === undefined
                ? "No service on file — the calf's sire will be blank rather than guessed."
                : `Sire from the ${service.method} service on ${formatDate(service.date)}.`}
            </p>
          )}
        </div>
      </form>

      {outcome === undefined ? null : (
        <AfterCalving outcome={outcome} dam={dam} onDamLevel={onDamLevel} />
      )}
    </div>
  );
}

/**
 * What §5.1 asks for after a calving: an elevated safety level on the *dam*.
 *
 * Suggested, not applied. A quiet cow does get protective with a calf at side,
 * and a helper walking up to her needs to know — but silently changing what an
 * animal's badge says, without anybody deciding to, would make the badge
 * something people stop believing.
 */
function AfterCalving({
  outcome,
  dam,
  onDamLevel,
}: {
  readonly outcome: CalvingOutcome;
  readonly dam: Animal | undefined;
  readonly onDamLevel: (dam: Animal, level: SafetyLevel) => Promise<void>;
}) {
  const [done, setDone] = useState(false);
  const suggested = outcome.suggestedDamLevel;

  return (
    <Card title="Recorded">
      <DetailList
        columns={2}
        items={[
          { label: "Calving", value: formatDate(outcome.calving?.date) },
          {
            label: "Calf",
            value:
              outcome.calf === undefined ? (
                "None — stillborn"
              ) : (
                <Link
                  href={animalHref(outcome.calf)}
                  className="text-ink underline decoration-edge underline-offset-4"
                >
                  {displayName(outcome.calf)}
                </Link>
              ),
          },
        ]}
      />

      {dam === undefined ||
      suggested === undefined ||
      suggested <= dam.safetyLevel ||
      done ? null : (
        <div className="mt-density flex flex-wrap items-center gap-3 border-t border-edge pt-density">
          <p className="text-sm text-muted">
            {displayName(dam)} is at level {dam.safetyLevel}. A cow with a calf at side gets
            protective — §5.1 suggests level {suggested} until the calf is weaned.
          </p>
          <Button
            onClick={() => {
              void onDamLevel(dam, suggested).then(() => setDone(true));
            }}
          >
            Raise her to level {suggested}
          </Button>
          <Button variant="ghost" onClick={() => setDone(true)}>
            Leave her at {dam.safetyLevel}
          </Button>
        </div>
      )}
    </Card>
  );
}
