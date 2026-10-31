"use client";

import { useMemo, useState } from "react";

import { Pill, Section, Select, TextInput, useToast } from "@galaxy-farm/ui";
import { asDate, type Ulid } from "@galaxy-farm/core";
import {
  cattleProfileSchema,
  coatName,
  DEFECT_NAMES,
  describeLocus,
  describeCarried,
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
  type ExternalAnimal,
  type DefectStatus,
  type ExtensionAllele,
  type GeneticDefect,
  type RoanAllele,
} from "@galaxy-farm/module-cattle";

import { coatFor } from "@/lib/coat";
import { carriedColourFor, defectsFor } from "@/lib/inherited-genetics";
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
  profiles,
  outsiders,
  propertyId,
  actorId,
}: {
  readonly profile: CattleProfile | undefined;
  readonly animalId: Ulid;
  /** Everything on file, so the parents can settle what this one is. */
  readonly profiles: readonly CattleProfile[];
  readonly outsiders: readonly ExternalAnimal[];
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

  /**
   * What can be worked out about the coat, from everything on file.
   *
   * Recomputed on every render rather than stored. That is the requirement:
   * the day a black bull is recorded as having thrown a red calf, this has to
   * change for him *and* for everything under him, and a value written into a
   * record at import time would not.
   */
  const inferred = useMemo(
    () => coatFor({ kind: "animal", id: animalId }, { profiles, outsiders }),
    [animalId, profiles, outsiders],
  );

  const records = { profiles, outsiders };
  const parents = { sire: profile?.sire, dam: profile?.dam };

  /**
   * What the parents settle, where this animal has no card of its own.
   *
   * Free is inherited only from two tested-free parents; a carrier anywhere
   * inside three generations makes a descendant possible. That asymmetry is
   * the associations' own rule and getting it backwards is how a carrier gets
   * called clean.
   */
  const inherited = useMemo(
    () => defectsFor(tests, parents, records),
    [tests, profile, profiles, outsiders],
  );

  /** The red an animal can be hiding behind a black coat. */
  const carried = useMemo(
    () => carriedColourFor(parents, records, {}),
    [profile, profiles, outsiders],
  );
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
    <div className="flex flex-col gap-density">
      {/*
        The verdict, as one line. It used to be a filled box, and so was every
        section under it, and a page of boxes is a page where the one that says
        "carrier" looks like the one that says "free".
      */}
      {verdict.carried.length > 0 ? (
        <p role="status" className="text-sm font-semibold text-danger">
          Carries {verdict.carried.map((defect) => DEFECT_NAMES[defect]).join(" and ")} — the house
          rule is no carriers on the place.
        </p>
      ) : verdict.untested.length > 0 ? (
        // Untested is not free. Most of the risk here is an untested animal
        // out of a carrier line, so this stays said until a hair card answers.
        <p role="status" className="text-sm font-semibold text-action">
          Untested for {verdict.untested.join(", ")} — untested is not free.
        </p>
      ) : (
        <p role="status" className="text-sm text-calm">
          Tested free of TH, PHA and DS.
        </p>
      )}

      <Section
        title="Defect panel"
        description="Every defect has a status, and “untested” is one of them — that is why the whole grid shows rather than a list you add to."
      >
        <TextInput
          label="Lab"
          hint="Stamped onto results set below — Neogen, GeneSeek, the association."
          value={lab}
          onChange={(event) => setLab(event.target.value)}
        />

        <ul
          aria-label="Defect results"
          className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
        >
          {GENETIC_DEFECTS.map((defect) => {
            const status = statusOf(tests, defect);
            const record = tests.find((test) => test.defect === defect);
            const covered = HOUSE_RULE_DEFECTS.includes(defect);
            // What the parents settle, where this animal has no card of its
            // own. Almost nothing on this place is hair-tested; the papered
            // ancestors are, and a recessive an animal does not have cannot
            // appear in it.
            const deduced = inherited.find((entry) => entry.defect === defect);
            const tested = asDate(record?.testedOn);
            const shown = deduced?.inherited === true ? deduced.status : status;

            return (
              <li key={defect} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{defect}</span>
                    <Pill tone={STATUS_TONE[shown]}>{STATUS_LABELS[shown]}</Pill>
                  </span>
                  <span className="text-sm text-muted">
                    {DEFECT_NAMES[defect]}
                    {covered ? " · house rule" : ""}
                    {/*
                      Through `asDate` because a hair card written by a build
                      before the sync transport revived timestamps inside JSON
                      columns still holds a string, and formatting one threw
                      where it stood — which React answers by unmounting the
                      app. A card whose date cannot be read still shows.
                    */}
                    {tested === undefined ? "" : ` · tested ${tested.toLocaleDateString()}`}
                    {record?.lab === undefined ? "" : ` · ${record.lab}`}
                  </span>
                  {deduced?.inherited !== true ? null : (
                    // Never shown as a test result. A hair card and a
                    // deduction are different claims and only one of them
                    // can be quoted.
                    <span className="text-sm text-muted">From the parents: {deduced.because}</span>
                  )}
                </span>

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
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Coat color"
        description="Worked out from the coat, the parents and the calves, and re-worked every time you open this — so the day something new is recorded about a parent, this changes with it. A hair card, where there is one, wins outright."
      >
        {inferred === undefined ? null : (
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-ink">
              {inferred.coat === undefined ? "Not settled yet" : `Worked out: ${inferred.coat}`}
            </p>
            <p className="text-sm text-muted">
              Extension {describeLocus(inferred.extension, EXTENSION_ALLELES)} · Roan{" "}
              {describeLocus(inferred.roan, ROAN_ALLELES)}
            </p>
            <p
              className={`text-sm ${
                inferred.carriesRed.verdict === "yes"
                  ? "font-semibold text-action"
                  : inferred.carriesRed.verdict === "no"
                    ? "text-calm"
                    : "text-muted"
              }`}
            >
              {inferred.carriesRed.verdict === "yes"
                ? "Carries red — any calf out of a red mate can be red."
                : inferred.carriesRed.verdict === "no"
                  ? "Cannot be hiding red."
                  : inferred.carriesRed.chance === undefined
                    ? "May be hiding red. Its parents' coats, or one red calf, would settle it."
                    : `${Math.round(inferred.carriesRed.chance * 100)}% chance it is hiding red.`}
            </p>

            {inferred.extension.because.length === 0 &&
            inferred.roan.because.length === 0 ? null : (
              // Kept one tap away rather than dropped. A genotype nobody
              // tested for is only worth as much as the reasoning under it,
              // and a person who can see the reasoning can spot the wrong coat
              // or the wrong parent that produced it.
              <details className="text-sm text-muted">
                <summary className="inline-flex min-h-target cursor-pointer items-center font-medium text-action">
                  Why
                </summary>
                <ul className="flex flex-col gap-1 pb-2">
                  {[...new Set([...inferred.extension.because, ...inferred.roan.because])].map(
                    (line) => (
                      <li key={line}>{line}</li>
                    ),
                  )}
                </ul>
              </details>
            )}
          </div>
        )}

        {carried === undefined ? null : (
          /*
            A recessive is invisible. A black cow out of a red-carrying bull
            looks exactly like one out of two homozygous blacks, and the two
            throw different calves. Nobody will hair-test every heifer on the
            place — but the parents are usually known, and the parents settle
            it to a probability.
          */
          <div className="flex flex-col gap-0.5">
            <p className={`text-sm ${carried.carriesRed > 0 ? "text-action" : "text-calm"}`}>
              {describeCarried(carried) ??
                "Nothing hidden — its parents cannot have passed it a red allele."}
            </p>
            <p className="text-sm text-muted">
              Possible:{" "}
              {carried.possible
                .map((entry) => `${entry.genotype} (${Math.round(entry.chance * 100)}%)`)
                .join(", ")}
            </p>
          </div>
        )}

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
          // No hair card loses nothing: what is above was worked out without
          // one, and a test only matters where the working could not settle it.
          <p className="text-sm text-muted">No hair card.</p>
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
              <span className="text-muted">— the other locus is needed to name the color</span>
            )}
          </p>
        )}

        <p className="text-sm text-muted">
          ED dominant black · E wild type · e red. R solid · r white · R/r roan.
        </p>
      </Section>
    </div>
  );
}

/** Re-exported for the tab list, so the profile does not need the allele types. */
export type { ExtensionAllele, RoanAllele };
