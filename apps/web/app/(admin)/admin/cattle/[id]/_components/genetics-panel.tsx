"use client";

import { useState } from "react";

import { Callout, Card, Pill, Section, Select, TextInput, useToast } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  cattleProfileSchema,
  coatName,
  DEFECT_NAMES,
  DEFECT_STATUSES,
  STATUS_LABELS,
  EXTENSION_ALLELES,
  GENETIC_DEFECTS,
  herdRuleVerdict,
  HOUSE_RULE_DEFECTS,
  ROAN_ALLELES,
  statusOf,
  writeExtension,
  writeRoan,
  type CattleProfile,
  type DefectStatus,
  type ExtensionAllele,
  type GeneticDefect,
  type RoanAllele,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";

/**
 * Hair-card results and coat alleles (spec §5.2).
 *
 * Two things live here because they arrive on the same piece of paper: a
 * genomic test comes back with the defect panel and the colour loci together,
 * and splitting them across two screens would mean typing from one card twice.
 *
 * The defect list is a fixed grid rather than an add-a-row list. Every animal
 * has a status for every defect — "untested" is a status — and a list you add
 * to would let somebody believe an animal was clear because its row was
 * missing. The whole grid, always, is what makes an absent result visible.
 */

const STATUS_TONE: Record<DefectStatus, "calm" | "danger" | "neutral" | "action"> = {
  free: "calm",
  free_by_parentage: "calm",
  // Not neutral. "Possible carrier" is what the associations print against an
  // animal with a tested carrier close behind it, and under a rule that no
  // carrier comes onto the place it is a reason to send a hair card, not a
  // shrug.
  suspect: "action",
  carrier: "danger",
  affected: "danger",
  untested: "neutral",
};

export function GeneticsPanel({
  profile,
  animalId,
  propertyId,
  actorId,
}: {
  readonly profile: CattleProfile | undefined;
  readonly animalId: Ulid;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const tests = profile?.geneticTests ?? [];
  const verdict = herdRuleVerdict(tests);

  const [busy, setBusy] = useState(false);
  const [lab, setLab] = useState("");

  async function save(next: Partial<CattleProfile>) {
    setBusy(true);
    try {
      const result =
        profile === undefined
          ? await api.create({
              animalId,
              breedComposition: [],
              registrations: [],
              geneticTests: [],
              ...next,
            } as never)
          : await api.update(profile.id, next);

      if (!result.ok) {
        show({ message: "Could not save that", tone: "danger" });
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(defect: GeneticDefect, status: DefectStatus) {
    // Replace rather than append: one result per defect, and the newest is the
    // one that counts. A history of superseded results would be its own list.
    const kept = tests.filter((test) => test.defect !== defect);
    const next =
      status === "untested"
        ? kept
        : [
            ...kept,
            {
              defect,
              status,
              testedOn: new Date(),
              ...(lab.trim() === "" ? {} : { lab: lab.trim() }),
            },
          ];

    if (await save({ geneticTests: next } as Partial<CattleProfile>)) {
      show({
        message: `${defect} · ${status.replace(/_/g, " ")}`,
        tone: status === "carrier" || status === "affected" ? "danger" : "success",
      });
    }
  }

  const extension = profile?.coatGenotype?.extension;
  const roan = profile?.coatGenotype?.roan;

  async function setAllele(locus: "extension" | "roan", index: 0 | 1, value: string) {
    const current = locus === "extension" ? extension : roan;
    const pair = [current?.[0] ?? "", current?.[1] ?? ""];
    pair[index] = value;

    // An incomplete pair is stored as nothing rather than as half a genotype:
    // half a genotype predicts nothing and would read as a recorded result.
    const complete = pair[0] !== "" && pair[1] !== "";
    const next = {
      ...profile?.coatGenotype,
      [locus]: complete ? pair : undefined,
    };

    if (await save({ coatGenotype: next } as Partial<CattleProfile>)) {
      show({ message: complete ? "Genotype saved" : "Genotype cleared", tone: "success" });
    }
  }

  return (
    <div className="flex flex-col gap-density pt-density">
      {verdict.carried.length > 0 ? (
        <Callout tone="danger" title={`Carries ${verdict.carried.join(" and ")}`}>
          {verdict.carried.map((defect) => DEFECT_NAMES[defect]).join(", ")}. The house rule is that
          no carrier belongs on this place — stricter than the genetics require, and deliberately
          so.
        </Callout>
      ) : verdict.untested.length > 0 ? (
        <Callout tone="action" title={`Untested for ${verdict.untested.join(", ")}`}>
          Untested is not the same as free. Most of the risk here is an untested animal out of a
          carrier line, so this stays flagged until a hair card says otherwise.
        </Callout>
      ) : (
        <Callout tone="calm" title="Free of all three">
          Tested free of TH, PHA and DS.
        </Callout>
      )}

      <Section
        title="Defect panel"
        description="Every defect has a status, and “untested” is one of them — that is why the whole grid shows rather than a list you add to."
      >
        <Card>
          <div className="mb-density">
            <TextInput
              label="Lab"
              hint="Stamped onto results you set below. Neogen, GeneSeek, the association."
              value={lab}
              onChange={(event) => setLab(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3">
            {GENETIC_DEFECTS.map((defect) => {
              const status = statusOf(tests, defect);
              const record = tests.find((test) => test.defect === defect);
              const covered = HOUSE_RULE_DEFECTS.includes(defect);

              return (
                <div
                  key={defect}
                  className="flex flex-wrap items-end justify-between gap-3 border-t border-edge pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-density font-medium text-ink">
                      {defect}
                      {covered ? <Pill tone="identity">house rule</Pill> : null}
                      <Pill tone={STATUS_TONE[status]}>{status.replace(/_/g, " ")}</Pill>
                    </span>
                    <span className="text-sm text-muted">
                      {DEFECT_NAMES[defect]}
                      {record?.testedOn === undefined
                        ? ""
                        : ` · tested ${record.testedOn.toLocaleDateString()}`}
                      {record?.lab === undefined ? "" : ` · ${record.lab}`}
                    </span>
                  </div>

                  <Select
                    label={`${defect} status`}
                    hideLabel
                    value={status}
                    disabled={busy}
                    options={DEFECT_STATUSES.map((value) => ({
                      value,
                      label: STATUS_LABELS[value],
                    }))}
                    onChange={(event) => void setStatus(defect, event.target.value as DefectStatus)}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      <Section
        title="Coat colour"
        description="Two alleles per locus, off the test. The coat alone is not enough — a black animal can be ED/ED or ED/e, and out of a red mate those two throw entirely different calves."
      >
        <Card>
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-2 gap-density sm:grid-cols-4">
              <Select
                label="Extension"
                value={extension?.[0] ?? ""}
                placeholder="—"
                disabled={busy}
                options={EXTENSION_ALLELES.map((value) => ({ value, label: value }))}
                onChange={(event) => void setAllele("extension", 0, event.target.value)}
              />
              <Select
                label="and"
                value={extension?.[1] ?? ""}
                placeholder="—"
                disabled={busy}
                options={EXTENSION_ALLELES.map((value) => ({ value, label: value }))}
                onChange={(event) => void setAllele("extension", 1, event.target.value)}
              />
              <Select
                label="Roan"
                value={roan?.[0] ?? ""}
                placeholder="—"
                disabled={busy}
                options={ROAN_ALLELES.map((value) => ({ value, label: value }))}
                onChange={(event) => void setAllele("roan", 0, event.target.value)}
              />
              <Select
                label="and"
                value={roan?.[1] ?? ""}
                placeholder="—"
                disabled={busy}
                options={ROAN_ALLELES.map((value) => ({ value, label: value }))}
                onChange={(event) => void setAllele("roan", 1, event.target.value)}
              />
            </div>

            {extension === undefined && roan === undefined ? (
              <p className="text-sm text-muted">
                Nothing recorded. Both loci are needed before a calf's colour can be predicted.
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-density text-ink">
                {extension === undefined ? null : (
                  <Pill tone="identity">{writeExtension(extension)}</Pill>
                )}
                {roan === undefined ? null : <Pill tone="identity">{writeRoan(roan)}</Pill>}
                {extension !== undefined && roan !== undefined ? (
                  <span>
                    which makes it <strong>{coatName(extension, roan)}</strong>
                  </span>
                ) : (
                  <span className="text-muted">
                    — the other locus is still needed to name the colour
                  </span>
                )}
              </p>
            )}

            <p className="text-sm text-muted">
              ED is dominant black, E is wild type, e is red. R is solid and r is white; R/r is
              roan.
            </p>
          </div>
        </Card>
      </Section>
    </div>
  );
}

/** Re-exported for the tab list, so the profile does not need the allele types. */
export type { ExtensionAllele, RoanAllele };
