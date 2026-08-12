"use client";

import { useState } from "react";

import { Button, Callout, Meter, Pill, useToast } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  applyChanges,
  registrationUrl,
  externalAnimalSchema,
  canRefresh,
  parseAnimalPage,
  parseAnimalUrl,
  cattleProfileSchema,
  pedigreeChanges,
  profileChanges,
  refreshChanges,
  type CattleProfile,
  type ExternalAnimal,
  type FieldChange,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";

/**
 * Checking every papered ancestor at once (spec §5.2).
 *
 * The one-at-a-time check is right when you have a reason to look at one
 * animal. This is for the other case: a herd whose papers were read months ago
 * and have been quietly going stale since — bulls culled, hair cards returned,
 * birth dates corrected, second registrations picked up.
 *
 * The same rule holds and matters more here, not less: **it proposes, it does
 * not overwrite.** Blanks are ticked, changes are not. Applying whatever four
 * hundred pages say, unattended, means one template change rewrites the herd.
 *
 * Fetched one at a time on purpose. Thirty parallel requests to an association
 * that already dislikes datacenter traffic is how this farm's address gets
 * blocked, and there is nobody waiting on the difference — the answer is
 * useful whether it takes twenty seconds or two minutes.
 */

interface Finding {
  readonly animal: ExternalAnimal;
  /** The page it came off. An animal papered twice has two, and they differ. */
  readonly registration: { association: string; regNumber: string };
  changes: readonly FieldChange[];
}

interface Failure {
  readonly animal: ExternalAnimal;
  readonly reason: string;
}

/** Only the ones there is actually a page to look up. */
export function checkable(animals: readonly ExternalAnimal[]): ExternalAnimal[] {
  return animals.filter((animal) =>
    allRegistrations(animal).some((entry) =>
      canRefresh(entry.association, entry.regNumber),
    ),
  );
}

export function RefreshAllAncestors({
  animals,
  ourRegistrations,
  propertyId,
  actorId,
  onDone,
}: {
  readonly animals: readonly ExternalAnimal[];
  /**
   * The farm's own papered cattle, by registration.
   *
   * Not decoration. Digital Beef prints an animal's genetic tests on the
   * charts of its *descendants*, so the flags for the sire and dam at the top
   * of the tree — the two ancestors closest to this herd — are on the pages of
   * the farm's own animals and nowhere else. Checking only the ancestors leaves
   * exactly those two permanently untested.
   */
  readonly ourRegistrations: readonly {
    readonly label: string;
    readonly association: string;
    readonly regNumber: string;
    /** The profile to update — breed makeup and defect results live there. */
    readonly profile: CattleProfile;
  }[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onDone: () => void;
}) {
  const api = useMutations<ExternalAnimal>(
    "externalAnimals",
    "externalAnimals",
    externalAnimalSchema,
    propertyId,
    actorId,
  );
  const profilesApi = useMutations<CattleProfile>(
    "cattleProfiles",
    "cattleProfiles",
    cattleProfileSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const queue = checkable(animals);
  const pages = queue.length + ourRegistrations.length;
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [failures, setFailures] = useState<readonly Failure[]>([]);
  /** Pages that came back with a detail panel but no pedigree chart. */
  const [chartless, setChartless] = useState(0);
  /** What the farm's own animals' pages would change on their profiles. */
  const [ourFindings, setOurFindings] = useState<
    readonly { label: string; profile: CattleProfile; changes: readonly FieldChange[] }[]
  >([]);
  /** `${animalId}:${field}` for every change agreed to. */
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function run() {
    setRunning(true);
    setStopped(false);
    setDone(0);
    setFindings([]);
    setFailures([]);
    setChartless(0);
    setOurFindings([]);
    setAccepted(new Set());

    const found: Finding[] = [];
    const ourResults: { label: string; profile: CattleProfile; changes: readonly FieldChange[] }[] = [];
    const failed: Failure[] = [];
    const ticked = new Set<string>();

    /** Merge a change into what is already proposed for an animal. */
    const record = (
      animal: ExternalAnimal,
      registration: { association: string; regNumber: string },
      changes: readonly FieldChange[],
    ) => {
      if (changes.length === 0) return;
      const existing = found.find((entry) => entry.animal.id === animal.id);
      if (existing === undefined) {
        found.push({ animal, registration, changes });
      } else {
        // A field already proposed off another registry's page wins — the
        // first page to carry it is as good an answer as the second, and two
        // rows for one field is a question nobody can answer from a checkbox.
        const known = new Set(existing.changes.map((change) => change.field));
        existing.changes = [
          ...existing.changes,
          ...changes.filter((change) => !known.has(change.field)),
        ];
      }
      for (const change of changes) {
        if (change.kind === "fill") ticked.add(`${animal.id}:${change.field}`);
      }
    };

    for (const animal of queue) {
      // *Every* registry the animal is papered in, not just the first. Only
      // Chianina prints a breed makeup; a Maine-Anjou page carries none at all,
      // so checking the first number and stopping is why a dual-registered
      // animal came back with nothing to say about its breeding.
      //
      // Deduped by the page each one actually resolves to. A record can hold
      // the same animal's number twice — once filed correctly and once under
      // the registry whose page printed it, `ASA / MA364424` — and both
      // resolve to one Maine-Anjou page. Fetching it twice is a wasted round
      // trip against an association that is already slow to answer.
      const byPage = new Map<string, { association: string; regNumber: string }>();
      for (const entry of allRegistrations(animal)) {
        if (!canRefresh(entry.association, entry.regNumber)) continue;
        const url = registrationUrl(entry.association, entry.regNumber);
        if (url !== undefined && !byPage.has(url)) byPage.set(url, entry);
      }
      const registrations = [...byPage.values()];

      let read = false;
      for (const registration of registrations) {
        const url = registrationUrl(registration.association, registration.regNumber);
        const parsed = url === undefined ? undefined : parseAnimalUrl(url);
        if (url === undefined || parsed === undefined || !parsed.ok) continue;

        try {
          const response = await fetch("/api/import/digital-beef", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url, raw: true }),
          });
          const payload = (await response.json()) as { page?: string; error?: string };

          if (!response.ok || payload.page === undefined) {
            failed.push({ animal, reason: payload.error ?? "Could not read that page." });
            continue;
          }

          read = true;
          const page = parseAnimalPage(payload.page, parsed.ref);
          // A page without its chart carries no defect results at all — they
          // are printed beside each ancestor and nowhere else — so this is
          // counted and said out loud rather than passing as "no changes".
          if (page.ancestors.length === 0) setChartless((count) => count + 1);
          record(animal, registration, refreshChanges(animal, page, animals));

          // The chart on this page carries the defect results of the ancestors
          // above it — Digital Beef never prints an animal's own tests on its
          // own page, only beside it on its descendants'. Skipping this is why
          // a whole herd came back with no genetics.
          for (const entry of pedigreeChanges(page, animals)) {
            record(entry.animal, registration, entry.changes);
          }
        } catch {
          failed.push({ animal, reason: "Could not reach the server." });
        }
      }

      if (!read && registrations.length === 0) {
        failed.push({ animal, reason: "No page could be built for that registry." });
      }

      setDone((count) => count + 1);
      setFindings([...found]);
      setFailures([...failed]);
      setAccepted(new Set(ticked));
    }

    // The farm's own papered cattle last. Their pages are read purely for
    // what the charts say about the ancestors above them — nothing on this
    // screen edits an animal of ours.
    for (const ours of ourRegistrations) {
      const url = registrationUrl(ours.association, ours.regNumber);
      const parsed = url === undefined ? undefined : parseAnimalUrl(url);
      if (url === undefined || parsed === undefined || !parsed.ok) {
        setDone((count) => count + 1);
        continue;
      }

      try {
        const response = await fetch("/api/import/digital-beef", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, raw: true }),
        });
        const payload = (await response.json()) as { page?: string; error?: string };

        if (!response.ok || payload.page === undefined) {
          failed.push({
            animal: { id: ours.label, name: ours.label } as ExternalAnimal,
            reason: payload.error ?? "Could not read that page.",
          });
        } else {
          const page = parseAnimalPage(payload.page, parsed.ref);
          if (page.ancestors.length === 0) setChartless((count) => count + 1);

          // The animal's own breed makeup, colour and horn status. This is the
          // one place the farm's own cattle get a composition off the papers —
          // and they are the animals whose composition matters most, being the
          // ones bred, shown and sold.
          const mine = profileChanges(ours.profile, page);
          if (mine.length > 0) {
            ourResults.push({ label: ours.label, profile: ours.profile, changes: mine });
            for (const change of mine) {
              if (change.kind === "fill") ticked.add(`profile:${ours.profile.id}:${change.field}`);
            }
          }

          for (const entry of pedigreeChanges(page, animals)) {
            record(entry.animal, { association: ours.association, regNumber: ours.regNumber }, entry.changes);
          }
        }
      } catch {
        failed.push({
          animal: { id: ours.label, name: ours.label } as ExternalAnimal,
          reason: "Could not reach the server.",
        });
      }

      setDone((count) => count + 1);
      setFindings([...found]);
      setOurFindings([...ourResults]);
      setFailures([...failed]);
      setAccepted(new Set(ticked));
    }

    setRunning(false);
    setStopped(true);
  }

  async function apply() {
    setBusy(true);
    try {
      let changed = 0;
      for (const finding of findings) {
        const patch = applyChanges(
          finding.changes,
          new Set(
            finding.changes
              .map((change) => change.field)
              .filter((field) => accepted.has(`${finding.animal.id}:${field}`)),
          ),
        );
        if (Object.keys(patch).length === 0) continue;
        const result = await api.update(finding.animal.id, patch);
        if (result.ok) changed += 1;
      }

      for (const finding of ourFindings) {
        const patch = applyChanges(
          finding.changes,
          new Set(
            finding.changes
              .map((change) => change.field)
              .filter((field) => accepted.has(`profile:${finding.profile.id}:${field}`)),
          ),
        );
        if (Object.keys(patch).length === 0) continue;
        const result = await profilesApi.update(
          finding.profile.id,
          patch as Partial<CattleProfile>,
        );
        if (result.ok) changed += 1;
      }

      show({
        message:
          changed === 0 ? "Nothing ticked, so nothing changed" : `${changed} ancestor(s) updated`,
        tone: changed === 0 ? "info" : "success",
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) =>
    setAccepted((current) => {
      const next = new Set(current);
      // crud-guard: allow-unconfirmed — unticking a row in an unsaved preview
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const tickedCount =
    ourFindings.reduce(
      (total, finding) =>
        total +
        finding.changes.filter((change) =>
          accepted.has(`profile:${finding.profile.id}:${change.field}`),
        ).length,
      0,
    ) +
    findings.reduce(
    (total, finding) =>
      total +
      finding.changes.filter((change) => accepted.has(`${finding.animal.id}:${change.field}`))
        .length,
    0,
  );

  return (
    <div className="flex flex-col gap-density">
      {queue.length === 0 ? (
        <Callout tone="action" title="Nothing to check">
          No ancestor on file has a registration number with one of the three associations, so
          there is no page to look up.
        </Callout>
      ) : (
        <>
          <p className="text-density text-ink">
            {queue.length} of {animals.length} ancestors have a number this can look up. Each page
            is fetched one at a time — thirty at once is how a farm&apos;s address gets blocked, and
            nobody is waiting on the difference.
          </p>

          {!running && !stopped ? (
            <>
              <p className="text-sm text-muted">
                Defect results are read off the <em>pedigree charts</em>. Digital Beef never prints
                an animal&apos;s own genetic tests on its own page — only beside it on the pages of
                everything descended from it — so the farm&apos;s own animals are read too, because
                their charts are the only place the sire and dam at the top of the tree appear.
              </p>
              <div>
                <Button onClick={() => void run()}>Check all {pages} pages</Button>
              </div>
            </>
          ) : (
            <Meter
              value={pages === 0 ? 0 : (done / pages) * 100}
              tone="action"
              label={running ? "Reading the papers" : "Finished"}
              detail={`${done} of ${pages} pages · ${findings.length} with something to say · ${failures.length} unreachable`}
            />
          )}
        </>
      )}

      {chartless === 0 ? null : (
        <Callout tone="action" title={`${chartless} pages came back without a pedigree chart`}>
          Digital Beef renders the details on the page and loads the pedigree tab separately, so a
          server fetch can come back with names and colors and no ancestors.{" "}
          <strong>Defect results only exist on the chart</strong> — printed beside each ancestor,
          never on the animal&apos;s own page — so those pages had none to give. Check those
          animals one at a time and paste the page; a select-all in a browser copies what the tabs
          loaded.
        </Callout>
      )}

      {failures.length === 0 ? null : (
        <Callout tone="action" title={`${failures.length} could not be read`}>
          {[...new Set(failures.map((failure) => failure.reason))].join(" ")} Those ancestors are
          untouched — check them one at a time and paste the page if the site will not talk to the
          server.
        </Callout>
      )}

      {ourFindings.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-density font-medium text-ink">The farm&apos;s own animals</p>
          <p className="text-sm text-muted">
            Breed makeup, color and horn status off their own papers. This is the one place a
            registered animal of ours picks up a composition from the association rather than
            having it worked out from its parents.
          </p>
          {ourFindings.map((finding) => (
            <div key={finding.profile.id} className="flex flex-col gap-1 border-t border-edge pt-3">
              <span className="text-density font-medium text-ink">{finding.label}</span>
              {finding.changes.map((change) => {
                const key = `profile:${finding.profile.id}:${change.field}`;
                return (
                  <label key={key} className="flex items-start gap-2 text-density">
                    <input
                      type="checkbox"
                      checked={accepted.has(key)}
                      onChange={() => toggle(key)}
                      className="mt-1.5"
                    />
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-ink">{change.label}</span>
                      <Pill tone={change.kind === "fill" ? "calm" : "action"}>
                        {change.kind === "fill" ? "was blank" : "would change"}
                      </Pill>
                      <span className="text-sm text-muted">
                        {change.before === undefined ? null : <s>{change.before}</s>}
                        {change.before === undefined ? null : " → "}
                        <span className="text-ink">{change.after}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {findings.length === 0 && ourFindings.length === 0 ? (
        stopped ? (
          <Callout tone="calm" title="Nothing has changed">
            Every page that could be read matches what is on file. That is worth knowing: the
            records have not gone stale.
          </Callout>
        ) : null
      ) : (
        <div className="flex flex-col gap-density">
          <p className="text-sm text-muted">
            Blanks being filled in are ticked. A value being <em>changed</em> is not — what is on
            file may have been corrected by hand, and a re-read of the page is not evidence against
            that.
          </p>

          {findings.map((finding) => (
            <div key={finding.animal.id} className="flex flex-col gap-2 border-t border-edge pt-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-density font-medium text-ink">{finding.animal.name}</span>
                <Pill tone="identity">
                  {finding.registration.association} {finding.registration.regNumber}
                </Pill>
              </span>

              {finding.changes.map((change) => {
                const key = `${finding.animal.id}:${change.field}`;
                return (
                  <label key={key} className="flex items-start gap-2 text-density">
                    <input
                      type="checkbox"
                      checked={accepted.has(key)}
                      onChange={() => toggle(key)}
                      className="mt-1.5"
                    />
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-ink">{change.label}</span>
                      <Pill tone={change.kind === "fill" ? "calm" : "action"}>
                        {change.kind === "fill" ? "was blank" : "would change"}
                      </Pill>
                      <span className="text-sm text-muted">
                        {change.before === undefined ? null : <s>{change.before}</s>}
                        {change.before === undefined ? null : " → "}
                        <span className="text-ink">{change.after}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-edge pt-density">
        <Button
          onClick={() => void apply()}
          busy={busy}
          disabled={running || tickedCount === 0}
        >
          Apply {tickedCount === 0 ? "the ticked ones" : `${tickedCount} change(s)`}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {running ? "Leave it running and close" : "Close"}
        </Button>
      </div>
    </div>
  );
}
