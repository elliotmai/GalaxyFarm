"use client";

import { useState } from "react";

import { Button, Callout, Meter, Pill, useToast } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  applyChanges,
  digitalBeefUrl,
  externalAnimalSchema,
  IMPORTABLE_ASSOCIATIONS,
  parseDigitalBeefPage,
  parseDigitalBeefUrl,
  pedigreeChanges,
  refreshChanges,
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
      (IMPORTABLE_ASSOCIATIONS as readonly string[]).includes(entry.association),
    ),
  );
}

export function RefreshAllAncestors({
  animals,
  propertyId,
  actorId,
  onDone,
}: {
  readonly animals: readonly ExternalAnimal[];
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
  const { show } = useToast();

  const queue = checkable(animals);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [failures, setFailures] = useState<readonly Failure[]>([]);
  /** `${animalId}:${field}` for every change agreed to. */
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function run() {
    setRunning(true);
    setStopped(false);
    setDone(0);
    setFindings([]);
    setFailures([]);
    setAccepted(new Set());

    const found: Finding[] = [];
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
      const registrations = allRegistrations(animal).filter((entry) =>
        (IMPORTABLE_ASSOCIATIONS as readonly string[]).includes(entry.association),
      );

      let read = false;
      for (const registration of registrations) {
        const url = digitalBeefUrl(registration.association as never, registration.regNumber);
        const parsed = url === undefined ? undefined : parseDigitalBeefUrl(url);
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
          const page = parseDigitalBeefPage(payload.page, parsed.ref);
          record(animal, registration, refreshChanges(animal, page));

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

  const tickedCount = findings.reduce(
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
            <div>
              <Button onClick={() => void run()}>Check all {queue.length}</Button>
            </div>
          ) : (
            <Meter
              value={queue.length === 0 ? 0 : (done / queue.length) * 100}
              tone="action"
              label={running ? "Reading the papers" : "Finished"}
              detail={`${done} of ${queue.length} · ${findings.length} with something to say · ${failures.length} unreachable`}
            />
          )}
        </>
      )}

      {failures.length === 0 ? null : (
        <Callout tone="action" title={`${failures.length} could not be read`}>
          {[...new Set(failures.map((failure) => failure.reason))].join(" ")} Those ancestors are
          untouched — check them one at a time and paste the page if the site will not talk to the
          server.
        </Callout>
      )}

      {findings.length === 0 ? (
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
