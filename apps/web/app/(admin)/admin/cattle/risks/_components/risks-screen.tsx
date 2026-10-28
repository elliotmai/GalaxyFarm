"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, EmptyState, Modal, PageBody, Pill } from "@galaxy-farm/ui";
import { displayName, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  assessRisks,
  RISK_KINDS,
  RISK_LABELS,
  type BreedingRecord,
  type CalvingRecord,
  type CattleProfile,
  type HealthRecord,
  type Risk,
  type RiskSeverity,
} from "@galaxy-farm/module-cattle";

import {
  Chip,
  ChipRow,
  facts,
  FilteredLine,
  Row,
  Rows,
  ScreenHeader,
} from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { animalHref } from "@/lib/animal-slug";
import { useRecords } from "@/lib/local/use-records";

/**
 * What the herd is trying to tell you (spec §5.2).
 *
 * Eight questions a good cattleman already asks, asked about every animal at
 * once. That is the whole value: a cow that has not calved in two years is
 * obvious about one cow and invisible across forty.
 *
 * The page is grouped by **animal** rather than by check, because that is the
 * unit a decision gets made about. Nobody culls a category; they look at one
 * cow who has taken three services, calved late twice and needed help both
 * times, and that reads as one story only when the three findings sit
 * together.
 *
 * Each animal is a row; her findings open in a side panel, where the detail
 * and the threshold behind each one can be read together. An empty page is a
 * real answer here and gets said properly, rather than being left as a blank
 * screen that looks broken.
 */

const TONE: Record<RiskSeverity, "danger" | "action" | "neutral"> = {
  serious: "danger",
  concern: "action",
  watch: "neutral",
};

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  serious: "Serious",
  concern: "Concern",
  watch: "Watch",
};

type RiskKind = (typeof RISK_KINDS)[number];

export function RisksScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);

  /** One check to narrow to, or "" for every animal with anything. */
  const [kind, setKind] = useState<RiskKind | "">("");
  /** The animal whose findings are open in the side panel. */
  const [open, setOpen] = useState<Ulid | undefined>();

  const cattle = useMemo(() => animals.filter((animal) => animal.species === "cattle"), [animals]);

  const report = useMemo(
    () =>
      assessRisks({
        animals: cattle,
        profiles,
        breedings,
        calvings,
        health,
        now: new Date(),
      }),
    [cattle, profiles, breedings, calvings, health],
  );

  const byId = useMemo(() => new Map(cattle.map((animal) => [animal.id, animal])), [cattle]);

  /** Animals with the most serious finding first, then the most findings. */
  const flagged = useMemo(() => {
    const weight = (risk: Risk) =>
      risk.severity === "serious" ? 100 : risk.severity === "concern" ? 10 : 1;
    return [...report.byAnimal]
      .map(([animalId, risks]) => ({
        animalId,
        risks,
        score: risks.reduce((total, risk) => total + weight(risk), 0),
      }))
      .sort((left, right) => right.score - left.score);
  }, [report]);

  const serious = report.risks.filter((risk) => risk.severity === "serious").length;
  const shown =
    kind === "" ? flagged : flagged.filter(({ risks }) => risks.some((risk) => risk.kind === kind));
  // Only the checks that found something get a chip. The rest are a result
  // too — said once, quietly, at the foot of the page.
  const firing = RISK_KINDS.filter((entry) => report.counts[entry] > 0);
  const quiet = RISK_KINDS.length - firing.length;

  const nameOf = (animalId: Ulid) => {
    const animal = byId.get(animalId);
    return animal === undefined ? "Unknown animal" : displayName(animal);
  };
  const openRisks = open === undefined ? undefined : report.byAnimal.get(open);
  const openAnimal = open === undefined ? undefined : byId.get(open);

  if (loading) return <p className="text-muted">Looking…</p>;

  return (
    <PageBody>
      <ScreenHeader
        title="Worth a look"
        facts={facts(
          `${flagged.length} of ${cattle.length} head flagged`,
          serious > 0 && `${serious} serious`,
        )}
      />

      {report.risks.length === 0 ? (
        <EmptyState
          title="Nothing to flag"
          detail={
            cattle.length === 0
              ? "No cattle on file yet. These checks run once the herd is added."
              : "Every check came back clean — against what is recorded, which is all a check can see."
          }
        />
      ) : (
        <>
          {/*
            Grouped by animal rather than by check, because the animal is the
            unit a decision gets made about. The checks are the chips: the way
            in when the question is "who is open twice", not "what is wrong
            with her".
          */}
          <ChipRow label="Filter by check">
            <Chip on={kind === ""} onClick={() => setKind("")}>
              All
            </Chip>
            {firing.map((entry) => (
              <Chip
                key={entry}
                on={kind === entry}
                onClick={() => setKind(kind === entry ? "" : entry)}
              >
                {RISK_LABELS[entry]}
                <span className="gf-numeric text-xs opacity-80">{report.counts[entry]}</span>
              </Chip>
            ))}
          </ChipRow>

          {kind === "" ? null : (
            <FilteredLine
              shown={shown.length}
              total={flagged.length}
              what={RISK_LABELS[kind]}
              onClear={() => setKind("")}
            />
          )}

          <Rows label="Flagged animals">
            {shown.map(({ animalId, risks }) => {
              const worst: RiskSeverity = risks.some((risk) => risk.severity === "serious")
                ? "serious"
                : risks.some((risk) => risk.severity === "concern")
                  ? "concern"
                  : "watch";
              return (
                <Row
                  key={animalId}
                  title={nameOf(animalId)}
                  onSelect={() => setOpen(animalId)}
                  selectLabel={`${nameOf(animalId)}: ${risks.length} finding${risks.length === 1 ? "" : "s"}`}
                  line={facts(
                    byId.get(animalId)?.tagNumber,
                    ...[...new Set(risks.map((risk) => RISK_LABELS[risk.kind]))],
                  )}
                  chip={
                    <Pill tone={TONE[worst]} dot={worst === "serious"}>
                      {SEVERITY_LABEL[worst]}
                    </Pill>
                  }
                />
              );
            })}
          </Rows>

          <p className="text-sm text-muted">
            {quiet === 0
              ? `All ${RISK_KINDS.length} checks found something.`
              : `${quiet} of ${RISK_KINDS.length} checks found nothing: ${RISK_KINDS.filter(
                  (entry) => report.counts[entry] === 0,
                )
                  .map((entry) => RISK_LABELS[entry])
                  .join(", ")}.`}
          </p>
        </>
      )}

      {openRisks === undefined || open === undefined ? null : (
        <Modal
          placement="side"
          title={nameOf(open)}
          onClose={() => setOpen(undefined)}
          footer={
            <>
              {openAnimal === undefined ? null : (
                <Link
                  href={animalHref(openAnimal)}
                  className="inline-flex min-h-target items-center rounded-density bg-action px-4 font-medium text-action-ink hover:opacity-90"
                >
                  Open profile
                </Link>
              )}
              <Button onClick={() => setOpen(undefined)}>Close</Button>
            </>
          }
        >
          {/* One animal's findings read together, because three findings
              about one cow are one story. */}
          <ul className="flex flex-col divide-y divide-rule">
            {openRisks.map((risk) => (
              <li
                key={`${risk.kind}-${risk.detail}`}
                className="flex flex-col gap-1 py-3 first:pt-0"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{RISK_LABELS[risk.kind]}</span>
                  <Pill tone={TONE[risk.severity]}>{SEVERITY_LABEL[risk.severity]}</Pill>
                </span>
                <p className="text-density text-ink">{risk.detail}</p>
                {risk.measure === undefined ? null : (
                  // The threshold is shown so it can be argued with. A
                  // warning whose rule is hidden is a warning nobody can
                  // decide is wrong.
                  <p className="text-sm text-muted">{risk.measure}</p>
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </PageBody>
  );
}
