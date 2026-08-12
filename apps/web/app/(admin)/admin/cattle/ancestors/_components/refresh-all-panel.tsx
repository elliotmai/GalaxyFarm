"use client";

import { useState } from "react";

import { Button, Callout, Meter, Pill, TextArea, useToast } from "@galaxy-farm/ui";
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

export interface Finding {
  readonly animal: ExternalAnimal;
  /** The page it came off. An animal papered twice has two, and they differ. */
  readonly registration: { association: string; regNumber: string };
  changes: readonly FieldChange[];
}

/**
 * A page the run could not finish with, and everything needed to finish it by
 * hand.
 *
 * The two ways a page goes wrong want the same remedy, so they are one type.
 * Either the host would not answer this server at all, or it answered without
 * the pedigree tab — and in both cases what fixes it is a person opening the
 * page in a browser, where it works, and pasting what they see.
 *
 * Everything the run would have used is carried along: which record the page
 * is about, which registration it was reached by, and the address. That is
 * what lets the paste be resolved *here*, in the same window, instead of
 * sending somebody to thirty separate screens to do thirty separate pastes.
 */
export interface Pending {
  /** Stable row key — the page, since that is what is being resolved. */
  readonly key: string;
  readonly label: string;
  /** Why it is in this list, in words. */
  readonly reason: string;
  readonly kind: "unread" | "chartless";
  readonly url?: string | undefined;
  /** The ancestor this page is about, when it is one of them. */
  readonly animal?: ExternalAnimal | undefined;
  /** The farm's own animal, when the page is one of ours. */
  readonly ours?:
    | { readonly label: string; readonly profile: CattleProfile }
    | undefined;
  readonly registration?: { association: string; regNumber: string } | undefined;
}

/**
 * Merge a page's proposals into what is already on the screen.
 *
 * Free of React on purpose: the run calls it in a loop over local arrays, and
 * a paste calls it against copies of the current state. One implementation, so
 * a page read by hand lands exactly where a page read by the server would.
 */
export function recordInto(
  found: Finding[],
  ticked: Set<string>,
  animal: ExternalAnimal,
  registration: { association: string; regNumber: string },
  changes: readonly FieldChange[],
): void {
  if (changes.length === 0) return;

  const existing = found.find((entry) => entry.animal.id === animal.id);
  if (existing === undefined) {
    found.push({ animal, registration, changes });
  } else {
    // A field already proposed off another registry's page wins — the first
    // page to carry it is as good an answer as the second, and two rows for
    // one field is a question nobody can answer from a checkbox.
    const known = new Set(existing.changes.map((change) => change.field));
    existing.changes = [
      ...existing.changes,
      ...changes.filter((change) => !known.has(change.field)),
    ];
  }
  for (const change of changes) {
    if (change.kind === "fill") ticked.add(`${animal.id}:${change.field}`);
  }
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
  /**
   * The ones with no page at all, and why.
   *
   * They were being dropped by `checkable` and never mentioned again, so
   * "twenty-eight of thirty-four" left six animals unaccounted for with
   * nothing on screen saying which six or what to do about them. Most have no
   * registration number; the rest hold one from a registry with no reader.
   */
  const unreachable = animals
    .filter((animal) => !queue.includes(animal))
    .map((animal) => {
      const papers = allRegistrations(animal);
      const linkable = papers
        .map((entry) => ({ entry, url: registrationUrl(entry.association, entry.regNumber) }))
        .find((candidate) => candidate.url !== undefined);
      return {
        label: animal.name,
        ...(linkable?.url === undefined ? {} : { url: linkable.url }),
        why:
          papers.length === 0
            ? "no registration number on file"
            : `${papers.map((entry) => entry.association).join(", ")} — not a site this app can read`,
      };
    });
  const pages = queue.length + ourRegistrations.length;
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  /** Pages that need a person to open them and paste what they see. */
  const [pending, setPending] = useState<readonly Pending[]>([]);
  /** What the farm's own animals' pages would change on their profiles. */
  const [ourFindings, setOurFindings] = useState<
    readonly { label: string; profile: CattleProfile; changes: readonly FieldChange[] }[]
  >([]);
  /** `${animalId}:${field}` for every change agreed to. */
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Which stuck row has its paste box open, and what is in each. */
  const [openPaste, setOpenPaste] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pasteError, setPasteError] = useState<Record<string, string>>({});

  async function run() {
    setRunning(true);
    setStopped(false);
    setDone(0);
    setFindings([]);
    setPending([]);
    setOurFindings([]);
    setAccepted(new Set());

    const found: Finding[] = [];
    const ourResults: { label: string; profile: CattleProfile; changes: readonly FieldChange[] }[] = [];
    const stuck: Pending[] = [];
    const ticked = new Set<string>();

    const record = (
      animal: ExternalAnimal,
      registration: { association: string; regNumber: string },
      changes: readonly FieldChange[],
    ) => recordInto(found, ticked, animal, registration, changes);

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
            stuck.push({
              key: url,
              label: animal.name,
              reason: payload.error ?? "Could not read that page.",
              kind: "unread",
              url,
              animal,
              registration,
            });
            continue;
          }

          read = true;
          const page = parseAnimalPage(payload.page, parsed.ref);
          // A page without its chart carries no defect results at all — they
          // are printed beside each ancestor and nowhere else — so this is
          // counted and said out loud rather than passing as "no changes".
          if (page.ancestors.length === 0) {
            stuck.push({
              key: url,
              label: animal.name,
              reason: "The page answered, but without its pedigree chart.",
              kind: "chartless",
              url,
              animal,
              registration,
            });
          }
          record(animal, registration, refreshChanges(animal, page, animals));

          // The chart on this page carries the defect results of the ancestors
          // above it — Digital Beef never prints an animal's own tests on its
          // own page, only beside it on its descendants'. Skipping this is why
          // a whole herd came back with no genetics.
          for (const entry of pedigreeChanges(page, animals)) {
            record(entry.animal, registration, entry.changes);
          }
        } catch {
          stuck.push({
            key: url,
            label: animal.name,
            reason: "Could not reach the server.",
            kind: "unread",
            url,
            animal,
            registration,
          });
        }
      }

      if (!read && registrations.length === 0) {
        stuck.push({
          key: `no-page:${animal.id}`,
          label: animal.name,
          reason: "No page could be built for that registry.",
          kind: "unread",
          animal,
        });
      }

      setDone((count) => count + 1);
      setFindings([...found]);
      setPending([...stuck]);
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
          stuck.push({
            key: url,
            label: ours.label,
            reason: payload.error ?? "Could not read that page.",
            kind: "unread",
            url,
            ours: { label: ours.label, profile: ours.profile },
            registration: { association: ours.association, regNumber: ours.regNumber },
          });
        } else {
          const page = parseAnimalPage(payload.page, parsed.ref);
          if (page.ancestors.length === 0) {
            stuck.push({
              key: url,
              label: ours.label,
              reason: "The page answered, but without its pedigree chart.",
              kind: "chartless",
              url,
              ours: { label: ours.label, profile: ours.profile },
              registration: { association: ours.association, regNumber: ours.regNumber },
            });
          }

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
        stuck.push({
          key: url,
          label: ours.label,
          reason: "Could not reach the server.",
          kind: "unread",
          url,
          ours: { label: ours.label, profile: ours.profile },
          registration: { association: ours.association, regNumber: ours.regNumber },
        });
      }

      setDone((count) => count + 1);
      setFindings([...found]);
      setOurFindings([...ourResults]);
      setPending([...stuck]);
      setAccepted(new Set(ticked));
    }

    setRunning(false);
    setStopped(true);
  }

  /**
   * Finish one stuck page with a paste, without leaving this screen.
   *
   * The whole point of doing it here: a herd of thirty ancestors can leave
   * eight pages needing a person, and sending somebody to eight separate
   * screens to paste eight pages — re-finding each animal on the way — is how
   * a job that takes ten minutes turns into one nobody finishes. The paste
   * lands in the same list of proposals the fetched pages produced, ticked the
   * same way, saved by the same button.
   */
  function resolveByPaste(entry: Pending, html: string) {
    const parsed = entry.url === undefined ? undefined : parseAnimalUrl(entry.url);
    if (parsed === undefined || !parsed.ok) {
      setPasteError({
        ...pasteError,
        [entry.key]:
          "There is no address for this one, so there is no way to know which registry the numbers on the page belong to.",
      });
      return;
    }
    if (html.trim() === "") {
      setPasteError({ ...pasteError, [entry.key]: "Paste the page first." });
      return;
    }

    const page = parseAnimalPage(html, parsed.ref);
    const registration = entry.registration ?? {
      association: parsed.ref.association,
      regNumber: parsed.ref.registration,
    };

    // Copies, because these are merged into and React state is not.
    const found: Finding[] = findings.map((finding) => ({ ...finding }));
    const ticked = new Set(accepted);
    const ourResults = [...ourFindings];

    if (entry.animal !== undefined) {
      recordInto(found, ticked, entry.animal, registration, refreshChanges(entry.animal, page, animals));
    }

    if (entry.ours !== undefined) {
      const mine = profileChanges(entry.ours.profile, page);
      if (mine.length > 0) {
        const at = ourResults.findIndex((row) => row.profile.id === entry.ours?.profile.id);
        const row = { label: entry.ours.label, profile: entry.ours.profile, changes: mine };
        if (at < 0) ourResults.push(row);
        else ourResults[at] = row;
        for (const change of mine) {
          if (change.kind === "fill") {
            ticked.add(`profile:${entry.ours.profile.id}:${change.field}`);
          }
        }
      }
    }

    // The chart is why this is worth doing at all: it carries the defect
    // results of every ancestor above this animal, and it is the only place
    // any association prints them.
    for (const other of pedigreeChanges(page, animals)) {
      recordInto(found, ticked, other.animal, registration, other.changes);
    }

    setFindings(found);
    setOurFindings(ourResults);
    setAccepted(ticked);

    if (page.ancestors.length === 0) {
      // Pasted, but still no chart — usually a copy taken before the pedigree
      // tab had loaded. Saying so beats dropping the row and leaving somebody
      // to wonder whether it worked.
      setPasteError({
        ...pasteError,
        [entry.key]:
          "That paste had no pedigree chart in it either. Open the animal's page, wait for the pedigree tab to draw, then select all and copy.",
      });
      return;
    }

    setPasteError(Object.fromEntries(
      Object.entries(pasteError).filter(([key]) => key !== entry.key),
    ));
    setPending((current) => current.filter((row) => row.key !== entry.key));
    setOpenPaste(undefined);
    show({ message: `${entry.label} read from the paste`, tone: "success" });
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

          {unreachable.length === 0 ? null : (
            <Callout
              tone="neutral"
              title={`${unreachable.length} have no page this can check`}
            >
              <p>
                Not a failure — there is simply nowhere to look. Anything with a link is on a site
                this app cannot read; open it and fill the record in by hand.
              </p>
              <PageLinks entries={unreachable} />
            </Callout>
          )}

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
              detail={`${done} of ${pages} pages · ${findings.length} with something to say · ${pending.length} needing a paste`}
            />
          )}
        </>
      )}

      {pending.length === 0 ? null : (
        <Callout tone="action" title={`${pending.length} need the page pasting in`}>
          <p>
            Two things land here and both have the same remedy. A host that will not answer this
            server will answer a browser; and Digital Beef loads the pedigree tab separately, so a
            server fetch can come back with names and colors and no ancestors.{" "}
            <strong>Defect results only exist on the chart</strong> — printed beside each ancestor,
            never on the animal&apos;s own page.
          </p>
          <p className="mt-1">
            Open one, wait for the pedigree to draw, select all, copy, and paste it below. What it
            reads joins the list of proposals underneath, ticked the same way and saved by the same
            button.
          </p>
        </Callout>
      )}

      {pending.map((entry) => (
        <div key={entry.key} className="flex flex-col gap-2 rounded-density border border-edge p-density">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-density font-medium text-ink">{entry.label}</span>
              <Pill tone={entry.kind === "chartless" ? "action" : "neutral"}>
                {entry.kind === "chartless" ? "no pedigree chart" : "could not be read"}
              </Pill>
            </span>
            <span className="flex flex-wrap items-center gap-3">
              {entry.url === undefined ? null : (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-action underline decoration-edge underline-offset-4 hover:decoration-action"
                >
                  open the page ↗
                </a>
              )}
              <Button
                variant="ghost"
                onClick={() => setOpenPaste(openPaste === entry.key ? undefined : entry.key)}
                disabled={entry.url === undefined}
              >
                {openPaste === entry.key ? "Hide" : "Paste the page"}
              </Button>
            </span>
          </div>

          <p className="text-sm text-muted">{entry.reason}</p>

          {openPaste !== entry.key ? null : (
            <div className="flex flex-col gap-2">
              <TextArea
                label={`The page for ${entry.label}`}
                hint="Select all on the animal's page and paste it here. This works regardless of what the host thinks of our server, and behind a login."
                rows={6}
                value={drafts[entry.key] ?? ""}
                onChange={(event) =>
                  setDrafts({ ...drafts, [entry.key]: event.target.value })
                }
              />
              {pasteError[entry.key] === undefined ? null : (
                <p role="alert" className="text-sm text-danger">
                  {pasteError[entry.key]}
                </p>
              )}
              <div>
                <Button onClick={() => resolveByPaste(entry, drafts[entry.key] ?? "")}>
                  Read this page
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

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

/**
 * The pages behind a list of names, as links.
 *
 * A count of what failed is a dead end. A name somebody can click through to
 * the association, copy, and paste back in is the way the job actually gets
 * finished — and with hosts that refuse a datacenter IP, that is the ordinary
 * path rather than the exception.
 *
 * A row with no address still appears, greyed. "We could not build a page for
 * this one" is a different problem from "the site would not answer", and
 * hiding the first would leave somebody counting names that do not add up.
 */
function PageLinks({
  entries,
}: {
  readonly entries: readonly {
    label: string;
    url?: string | undefined;
    /** Why there is nothing to click, when there is not. */
    why?: string | undefined;
  }[];
}) {
  if (entries.length === 0) return null;

  // One row per animal, not per attempt: a dual-registered animal that failed
  // on both its pages is still one animal to go and look at.
  const rows = [...new Map(entries.map((entry) => [entry.label, entry])).values()];

  return (
    <ul className="mt-2 flex flex-col gap-1">
      {rows.map((entry) => (
        <li key={entry.label} className="flex flex-wrap items-baseline gap-2">
          <span className="text-density text-ink">{entry.label}</span>
          {entry.why === undefined ? null : (
            <span className="text-sm text-muted">{entry.why}</span>
          )}
          {entry.url === undefined ? (
            entry.why === undefined ? (
              <span className="text-sm text-muted">no page could be built for its registry</span>
            ) : null
          ) : (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-action underline decoration-edge underline-offset-4 hover:decoration-action"
            >
              open the page ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
