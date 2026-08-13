"use client";

import { useState } from "react";

import { Button, Callout, Pill, Select, TextArea, useToast } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  applyChanges,
  defaultAccepted,
  canRefresh,
  registrationUrl,
  registryFor,
  externalAnimalSchema,
  parseAnimalPage,
  parseAnimalUrl,
  pedigreeChanges,
  unknownOnChart,
  refreshChanges,
  type ExternalAnimal,
  type FieldChange,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";

/**
 * Checking one animal against the association again (spec §5.2).
 *
 * The papers on file were right on the day they were read. A bull gets culled,
 * a hair card comes back, a birth date gets corrected, an animal picks up a
 * second registration — and none of that arrives here on its own.
 *
 * The whole design is in one rule: **a refresh proposes, it does not
 * overwrite.** A blank being filled is ticked; a value being *changed* is not,
 * and shows both sides so somebody can see what they would be agreeing to.
 * Anything already recorded may have been corrected by hand, and a re-read of
 * a page built for a person to look at is not evidence against that — one bad
 * parse after a template change would otherwise rewrite thirty records without
 * anything on screen looking unusual.
 */

export function RefreshFromAssociation({
  animal,
  everyone,
  propertyId,
  actorId,
  onDone,
}: {
  readonly animal: ExternalAnimal;
  /** Everything on file, so the page's chart can update the ancestors on it. */
  readonly everyone: readonly ExternalAnimal[];
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

  const papers = allRegistrations(animal);
  const [which, setWhich] = useState(
    papers[0] === undefined ? "" : `${papers[0].association}:${papers[0].regNumber}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [html, setHtml] = useState("");
  const [changes, setChanges] = useState<readonly FieldChange[] | undefined>();
  /** What the page's chart says about the other animals on it. */
  const [others, setOthers] = useState<
    readonly { animal: ExternalAnimal; changes: readonly FieldChange[] }[]
  >([]);
  /** True when the page came back with a detail panel but no pedigree chart. */
  const [chartMissing, setChartMissing] = useState(false);
  /** Animals on the chart that are not on file at all. */
  const [strangers, setStrangers] = useState<readonly string[]>([]);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());

  const [association, regNumber] = which.split(":");
  const url =
    association === undefined || regNumber === undefined
      ? undefined
      : registrationUrl(association, regNumber);

  function present(page: string, ref: { association: string; registration: string; url: string }) {
    const read = parseAnimalPage(page, ref as never);
    const found = refreshChanges(animal, read, everyone);
    setChartMissing(read.ancestors.length === 0);
    setStrangers(unknownOnChart(read, everyone));

    // The chart on this page carries the defect results, colours and birth
    // dates of the *ancestors* — Digital Beef never prints an animal's own
    // genetic tests on its own page, only beside it on its descendants'.
    const chart = pedigreeChanges(read, everyone).filter((entry) => entry.animal.id !== animal.id);

    setChanges(found);
    setOthers(chart);

    const ticked = new Set<string>(defaultAccepted(found));
    for (const entry of chart) {
      for (const change of entry.changes) ticked.add(`${entry.animal.id}:${change.field}`);
    }
    setAccepted(ticked);
  }

  async function check() {
    setError(undefined);
    setChanges(undefined);

    if (url === undefined) {
      setError("This one has no registration number on file, so there is no page to check.");
      return;
    }
    // A registry can have a page worth opening and still not be one this app
    // knows how to read. Saying which is far more use than a failed parse: the
    // link is right there, and a person can copy what they find into the
    // record by hand.
    if (association !== undefined && !canRefresh(association, regNumber)) {
      const registry = registryFor(association);
      setError(
        `${registry?.name ?? association} is not a site this app can read. Open its page below ` +
          `and fill anything in by hand.`,
      );
      return;
    }
    const parsed = parseAnimalUrl(url);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/import/digital-beef", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, raw: true }),
      });
      const payload = (await response.json()) as { page?: string; error?: string };

      if (!response.ok || payload.page === undefined) {
        setError(
          `${payload.error ?? "Could not read that page."} Open it yourself and paste it below.`,
        );
        return;
      }
      present(payload.page, parsed.ref);
    } catch {
      setError("Could not reach the server. Paste the page below instead.");
    } finally {
      setBusy(false);
    }
  }

  function checkPasted() {
    setError(undefined);
    setChanges(undefined);

    if (url === undefined) {
      setError("Pick which registration to check against first.");
      return;
    }
    const parsed = parseAnimalUrl(url);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    if (html.trim() === "") {
      setError("Paste the page first.");
      return;
    }
    present(html, parsed.ref);
  }

  async function save() {
    if (changes === undefined) return;

    setBusy(true);
    try {
      let touched = 0;

      const patch = applyChanges(changes, accepted);
      if (Object.keys(patch).length > 0) {
        const result = await api.update(animal.id, patch);
        if (!result.ok) {
          setError("Could not save that.");
          return;
        }
        touched += 1;
      }

      for (const entry of others) {
        const ticked = new Set(
          entry.changes
            .map((change) => change.field)
            .filter((field) => accepted.has(`${entry.animal.id}:${field}`)),
        );
        const theirs = applyChanges(entry.changes, ticked);
        if (Object.keys(theirs).length === 0) continue;
        const result = await api.update(entry.animal.id, theirs);
        if (result.ok) touched += 1;
      }

      show({
        message:
          touched === 0 ? "Nothing ticked, so nothing changed" : `${touched} record(s) updated`,
        tone: touched === 0 ? "info" : "success",
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const toggle = (field: string) =>
    setAccepted((current) => {
      const next = new Set(current);
      // crud-guard: allow-unconfirmed — unticking a row in an unsaved preview
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  return (
    <div className="flex flex-col gap-density">
      {papers.length === 0 ? (
        <Callout tone="action" title="No registration number on file">
          There is nothing to look up. Add the association and the number first and this can go and
          read the page.
        </Callout>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-density sm:grid-cols-[1fr_auto] sm:items-end">
            <Select
              label="Check against"
              hint={
                papers.length > 1
                  ? "This animal is papered twice. Each registry holds its own record, and they do not always agree."
                  : undefined
              }
              value={which}
              options={papers.map((entry) => ({
                value: `${entry.association}:${entry.regNumber}`,
                label: `${entry.association} ${entry.regNumber}`,
              }))}
              onChange={(event) => setWhich(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void check()} busy={busy}>
                Check for changes
              </Button>
              {url === undefined ? null : (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="self-center text-sm text-action underline underline-offset-2"
                >
                  Open the page
                </a>
              )}
            </div>
          </div>

          <details className="rounded-density border border-edge p-density">
            <summary className="cursor-pointer text-density font-medium text-ink">
              Or paste the page — works when the site will not talk to our server
            </summary>
            <div className="flex flex-col gap-density pt-density">
              <TextArea
                label="The page"
                rows={5}
                value={html}
                onChange={(event) => setHtml(event.target.value)}
              />
              <div>
                <Button variant="ghost" onClick={checkPasted}>
                  Compare what I pasted
                </Button>
              </div>
            </div>
          </details>
        </>
      )}

      {error === undefined ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-danger">{error}</p>
          {url === undefined ? null : (
            // The way out, one click away. These hosts refuse a datacenter IP
            // often enough that opening the page and pasting it is the
            // ordinary path, and making somebody rebuild the address by hand
            // from a registration number is how they give up instead.
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-action underline decoration-edge underline-offset-4 hover:decoration-action"
            >
              Open {association} {regNumber} at the association ↗
            </a>
          )}
        </div>
      )}

      {!chartMissing ? null : (
        <Callout tone="action" title="That page came back without its pedigree chart">
          <p>
            Digital Beef renders the animal&apos;s details on the page and loads the pedigree tab
            separately, so a fetch can come back with the name and the color and no ancestors at
            all. <strong>Defect results only exist on the chart</strong> — they are printed beside
            each ancestor, never on the animal&apos;s own page — so without it there are none to
            read. Open the page in a browser and paste it below; a select-all copies what the tabs
            loaded.
          </p>
          {url === undefined ? null : (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-sm text-action underline decoration-edge underline-offset-4 hover:decoration-action"
            >
              Open {association} {regNumber} at the association ↗
            </a>
          )}
        </Callout>
      )}

      {strangers.length === 0 ? null : (
        <Callout tone="action" title={`${strangers.length} on this chart are not on file`}>
          {strangers.slice(0, 6).join(", ")}
          {strangers.length > 6 ? `, and ${strangers.length - 6} more` : ""}. A refresh does not add
          animals — importing this page does, and it shows every one for approval and wires the
          whole tree at once. Use &ldquo;Import from Digital Beef&rdquo; with this animal&apos;s
          number.
        </Callout>
      )}

      {changes === undefined ? null : changes.length === 0 && others.length === 0 ? (
        <Callout tone="calm" title="Nothing has changed">
          Everything on the page matches what is on file. Worth knowing — it means the record has
          not gone stale, which is not the same as nobody having looked.
        </Callout>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            Blanks being filled in are ticked. A value being <em>changed</em> is not — what is on
            file may have been corrected by hand, and a re-read of the page is not evidence against
            that.
          </p>
          {changes.map((change) => (
            <label
              key={change.field}
              className="flex items-start gap-2 border-t border-edge pt-2 text-density"
            >
              <input
                type="checkbox"
                checked={accepted.has(change.field)}
                onChange={() => toggle(change.field)}
                className="mt-1.5"
              />
              <span className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{change.label}</span>
                  <Pill tone={change.kind === "fill" ? "calm" : "action"}>
                    {change.kind === "fill" ? "was blank" : "would change"}
                  </Pill>
                </span>
                <span className="text-sm text-muted">
                  {change.before === undefined ? null : <s>{change.before}</s>}
                  {change.before === undefined ? null : " → "}
                  <span className="text-ink">{change.after}</span>
                </span>
              </span>
            </label>
          ))}

          {others.length === 0 ? null : (
            <div className="flex flex-col gap-2 border-t border-edge pt-density">
              <p className="text-density text-ink">
                This page&apos;s pedigree also says something about {others.length} ancestor
                {others.length === 1 ? "" : "s"} already on file.
              </p>
              <p className="text-sm text-muted">
                Digital Beef never prints an animal&apos;s own genetic tests on its own page — it
                prints them beside it on the chart of everything descended from it. This is the only
                place they can be read from.
              </p>
              {others.map((entry) => (
                <div key={entry.animal.id} className="flex flex-col gap-1 pt-2">
                  <span className="text-density font-medium text-ink">{entry.animal.name}</span>
                  {entry.changes.map((change) => {
                    const key = `${entry.animal.id}:${change.field}`;
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
                          <span className="text-sm text-muted">{change.after}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-density">
            <Button onClick={() => void save()} busy={busy}>
              Apply the ticked ones
            </Button>
            <Button variant="ghost" onClick={onDone}>
              Leave it alone
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
