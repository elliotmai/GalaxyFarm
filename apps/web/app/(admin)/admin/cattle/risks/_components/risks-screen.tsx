"use client";

import Link from "next/link";
import { useMemo } from "react";

import {
  Card,
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Tile,
} from "@galaxy-farm/ui";
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
 * An empty page is a real answer here and gets said properly, rather than
 * being left as a blank screen that looks broken.
 */

const TONE: Record<RiskSeverity, "danger" | "action" | "neutral"> = {
  serious: "danger",
  concern: "action",
  watch: "neutral",
};

export function RisksScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: animals, loading } = useRecords<Animal>("animals", query);
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);

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

  if (loading) return <p className="text-muted">Looking…</p>;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Worth a look"
        subtitle="Eight questions asked about every animal at once. Nothing here is a verdict — it is the herd pointing at something."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Animals flagged"
          value={flagged.length}
          tone={flagged.length > 0 ? "action" : "calm"}
        />
        <Tile
          label="Serious"
          value={serious}
          tone={serious > 0 ? "danger" : "calm"}
          emphasis={serious > 0}
        />
        <Tile label="Findings" value={report.risks.length} />
        <Tile label="Head checked" value={cattle.length} tone="identity" />
      </div>

      {report.risks.length === 0 ? (
        <EmptyState
          title="Nothing to flag"
          detail={
            cattle.length === 0
              ? "There are no cattle on file yet. Add the herd and these checks start running against it."
              : "Every check came back clean against what is recorded. That is worth knowing — but a check can only see what has been written down, so a thin record and a good record look the same from here."
          }
        />
      ) : (
        <>
          <Section
            title="By animal"
            description="One cow's findings read together, because that is how a decision gets made about her."
          >
            <CardGrid columns={2}>
              {flagged.map(({ animalId, risks }) => {
                const animal = byId.get(animalId);
                const worst = risks.some((risk) => risk.severity === "serious")
                  ? "serious"
                  : risks.some((risk) => risk.severity === "concern")
                    ? "concern"
                    : "watch";

                return (
                  <RecordCard
                    key={animalId}
                    tone={TONE[worst as RiskSeverity]}
                    title={
                      animal === undefined ? (
                        "Unknown animal"
                      ) : (
                        <Link
                          href={animalHref(animal)}
                          className="underline decoration-edge underline-offset-4 hover:decoration-action"
                        >
                          {displayName(animal)}
                        </Link>
                      )
                    }
                    subtitle={animal?.tagNumber}
                    actions={
                      <Pill tone={TONE[worst as RiskSeverity]} dot={worst === "serious"}>
                        {risks.length} finding{risks.length === 1 ? "" : "s"}
                      </Pill>
                    }
                  >
                    <div className="flex flex-col gap-3">
                      {risks.map((risk) => (
                        <div key={`${risk.kind}-${risk.detail}`} className="flex flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <Pill tone={TONE[risk.severity]}>{RISK_LABELS[risk.kind]}</Pill>
                          </span>
                          <p className="text-density text-ink">{risk.detail}</p>
                          {risk.measure === undefined ? null : (
                            // The threshold is shown so it can be argued with.
                            // A warning whose rule is hidden is a warning
                            // nobody can decide is wrong.
                            <p className="text-sm text-muted">{risk.measure}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </RecordCard>
                );
              })}
            </CardGrid>
          </Section>

          <Section
            title="What is being checked"
            description="Every check, and how many animals it found. A check finding nothing is as much a result as one finding something."
          >
            <Card>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {RISK_KINDS.map((kind) => (
                  <div
                    key={kind}
                    className="flex items-center justify-between gap-3 border-t border-edge pt-3 first:border-t-0 first:pt-0 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(2)]:pt-0"
                  >
                    <span className="text-density text-ink">{RISK_LABELS[kind]}</span>
                    <Pill tone={report.counts[kind] > 0 ? "action" : "calm"}>
                      {report.counts[kind]}
                    </Pill>
                  </div>
                ))}
              </div>
            </Card>
          </Section>
        </>
      )}
    </PageBody>
  );
}
