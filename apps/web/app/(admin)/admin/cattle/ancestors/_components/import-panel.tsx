"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  Card,
  DetailList,
  Pill,
  Section,
  Select,
  TextArea,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  digitalBeefUrl,
  externalAnimalSchema,
  IMPORTABLE_ASSOCIATIONS,
  mergeRegistration,
  parseDigitalBeefPage,
  parseDigitalBeefUrl,
  planImport,
  sexFromPosition,
  type ExternalAnimal,
  type ImportedAnimal,
  type ImportPlan,
  type ImportRow,
  type ParentRef,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";

/**
 * Importing a pedigree off Digital Beef (spec §5.2, §12 decision 1 reversed).
 *
 * Two ways in, and the second is not a fallback so much as the reliable one.
 *
 * **By address**: the server fetches the page, because a browser cannot reach
 * digitalbeef.com from this origin and no CORS header is coming. That works
 * when the association's host will talk to a datacenter IP, and at least one
 * of the three will not.
 *
 * **By paste**: open the page yourself, select all, paste it here. This works
 * regardless of what the host thinks of our server, and it works behind a
 * login. It is the path to use when the first one fails, and it is worth
 * knowing about *before* it fails, which is why both are on the screen at once
 * rather than one appearing after the other errors.
 *
 * Everything lands in a preview first. This parses a page built for a person
 * to look at; it will be wrong the day the template changes, and being wrong
 * in a preview costs a glance rather than a corrupted pedigree.
 */

export function DigitalBeefImport({
  existing,
  propertyId,
  actorId,
}: {
  readonly existing: readonly ExternalAnimal[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<ExternalAnimal>(
    "externalAnimals",
    "externalAnimals",
    externalAnimalSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [association, setAssociation] = useState<string>(IMPORTABLE_ASSOCIATIONS[0] ?? "AMAA");
  const [registration, setRegistration] = useState("");
  /** An address typed in whole, for the day one of the three changes its shape. */
  const [pasted, setPasted] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ animal: ImportedAnimal; plan: ImportPlan } | undefined>();
  /** Which proposed merges the person has agreed to. Certain ones are not asked. */
  const [merging, setMerging] = useState<ReadonlySet<string>>(new Set());

  /**
   * Slot → record, for the animal this page is about, if it is already here.
   *
   * This is what lets a Chianina page join onto a Maine-Anjou one. The two
   * registries number the same cow differently, so nothing about the numbers
   * connects them — but both charts put her in the same slot.
   */
  function pedigreeOf(subject: ExternalAnimal): ReadonlyMap<string, ExternalAnimal> {
    const byId = new Map(existing.map((animal) => [animal.id, animal]));
    const slots = new Map<string, ExternalAnimal>();

    const walk = (animal: ExternalAnimal, path: string, depth: number) => {
      if (depth > 4) return;
      for (const [ref, side] of [
        [animal.sire, "sire"],
        [animal.dam, "dam"],
      ] as const) {
        if (ref === undefined) continue;
        const parent = byId.get(ref.id);
        if (parent === undefined) continue;
        const position = path === "" ? side : `${path}'s ${side}`;
        slots.set(position, parent);
        walk(parent, position, depth + 1);
      }
    };

    walk(subject, "", 1);
    return slots;
  }

  function show_(animal: ImportedAnimal) {
    const plan = planImport(animal, existing, pedigreeOf);
    setPreview({ animal, plan });
    setMerging(new Set());
  }

  /**
   * The address, built rather than pasted.
   *
   * Nobody has the URL — they have a registration number off a certificate and
   * they know which association issued it. The address is the same for every
   * animal on a site bar the number on the end, so asking somebody to go and
   * find it is asking them to do a lookup this can do.
   *
   * A pasted address still works and still wins, for the day one of the three
   * changes its address shape.
   */
  const url =
    pasted.trim() !== ""
      ? pasted.trim()
      : (digitalBeefUrl(association as never, registration.trim()) ?? "");

  async function fetchByUrl() {
    setError(undefined);
    setPreview(undefined);

    if (registration.trim() === "" && pasted.trim() === "") {
      setError("Type the animal's registration number, or paste its address.");
      return;
    }

    const parsed = parseDigitalBeefUrl(url);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/import/digital-beef", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as { animal?: ImportedAnimal; error?: string };

      if (!response.ok || payload.animal === undefined) {
        setError(payload.error ?? "Could not read that page.");
        return;
      }
      show_(payload.animal);
    } catch {
      setError("Could not reach the server. Try pasting the page instead.");
    } finally {
      setBusy(false);
    }
  }

  function readPasted() {
    setError(undefined);
    setPreview(undefined);

    const parsed = parseDigitalBeefUrl(url);
    if (!parsed.ok) {
      setError(
        `${parsed.reason} The address is still needed — it says which registry the numbers belong to.`,
      );
      return;
    }
    if (html.trim() === "") {
      setError("Paste the page first.");
      return;
    }

    show_(parseDigitalBeefPage(html, parsed.ref));
  }

  /**
   * Write the animals, then wire the parents.
   *
   * Two passes, because an ancestor's sire is another ancestor that may not
   * exist yet. Anything recognised as already here is left alone — with its
   * new registry number folded in when this page brought one.
   */
  async function commit(animal: ImportedAnimal, plan: ImportPlan) {
    setBusy(true);
    try {
      const byId = new Map(existing.map((entry) => [entry.id, entry]));
      /** Import row key → the record it ended up as. */
      const resolved = new Map<string, Ulid>();
      let created = 0;
      let merged = 0;
      let known = 0;

      for (const row of plan.rows) {
        const match = row.match;
        const agreed = match !== undefined && (match.confidence === "certain" || merging.has(row.key));

        if (agreed) {
          resolved.set(row.key, match.existingId);
          const record = byId.get(match.existingId);
          const patch =
            record === undefined || match.addsRegistration === undefined
              ? undefined
              : mergeRegistration(record, match.addsRegistration);

          // Anything this page knows that the record does not. A Chianina page
          // carries a breed makeup a Maine-Anjou page does not print at all,
          // and a Shorthorn pedigree carries colours going back to 1955.
          // Existing values are never overwritten: the record on file may have
          // been corrected by hand, and an import is not evidence against that.
          const fill = fillBlanks(record, recordFor(row, animal));
          const together = { ...(patch ?? {}), ...fill };

          if (Object.keys(together).length === 0) {
            known += 1;
          } else {
            await api.update(match.existingId, together);
            merged += 1;
          }
          continue;
        }

        const result = await api.create(recordFor(row, animal) as never);

        if (!result.ok) {
          setError(`Could not save ${row.name}.`);
          return;
        }
        resolved.set(row.key, result.value.id);
        created += 1;
      }

      // Second pass. Every placed slot names its own parents by construction —
      // `sire's dam` is the dam of `sire` — so the whole chart wires up, not
      // just the two parents the old version could be sure of.
      for (const row of plan.rows) {
        const id = resolved.get(row.key);
        if (id === undefined) continue;

        const base = row.position ?? "";
        const sire = resolved.get(base === "" ? "sire" : `${base}'s sire`);
        const dam = resolved.get(base === "" ? "dam" : `${base}'s dam`);
        const ref = (value: Ulid | undefined): ParentRef | undefined =>
          value === undefined ? undefined : { kind: "external", id: value };

        const sireRef = ref(sire);
        const damRef = ref(dam);
        if (sireRef === undefined && damRef === undefined) continue;

        await api.update(id, {
          ...(sireRef === undefined ? {} : { sire: sireRef }),
          ...(damRef === undefined ? {} : { dam: damRef }),
        } as Partial<ExternalAnimal>);
      }

      show({
        message: [
          `${created} added`,
          merged > 0 ? `${merged} gained a second registration` : undefined,
          known > 0 ? `${known} already on file` : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(", "),
        tone: "success",
      });
      setPreview(undefined);
      setRegistration("");
      setPasted("");
      setHtml("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Import from Digital Beef"
      description="The associations expose no interface, so this reads the page a person would read. Everything is shown for approval before anything is saved."
    >
      <Card>
        <div className="flex flex-col gap-density">
          <div className="grid grid-cols-1 gap-density sm:grid-cols-[12rem_1fr]">
            <Select
              label="Association"
              hint="Which registry issued the number."
              value={association}
              options={IMPORTABLE_ASSOCIATIONS.map((value) => ({ value, label: value }))}
              onChange={(event) => setAssociation(event.target.value)}
            />
            <TextInput
              label="Registration number"
              hint="Off the certificate. That plus the association is the whole address."
              numeric
              value={registration}
              onChange={(event) => setRegistration(event.target.value)}
              placeholder="4219133"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void fetchByUrl()} busy={busy}>
              Fetch and read it
            </Button>
            {url === "" ? null : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-action underline underline-offset-2"
              >
                Open the page yourself
              </a>
            )}
          </div>

          <details className="rounded-density border border-edge p-density">
            <summary className="cursor-pointer text-density font-medium text-ink">
              Or paste the whole address instead
            </summary>
            <div className="pt-density">
              <TextInput
                label="Animal's web address"
                hint="Overrides the two fields above. Only needed if an association changes the shape of its addresses."
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="https://shorthorn.digitalbeef.com/modules.php?…&animal_registration=4219133"
              />
            </div>
          </details>

          <details className="rounded-density border border-edge p-density">
            <summary className="cursor-pointer text-density font-medium text-ink">
              Or paste the page — works when the site will not talk to our server
            </summary>
            <div className="flex flex-col gap-density pt-density">
              <p className="text-sm text-muted">
                Open the animal&apos;s page in a browser, select the whole page and copy it, then
                paste it here. This works behind a login and regardless of what the association&apos;s
                host thinks of our server. Paste it as it comes — the blank rows in the pedigree
                chart are what say which ancestors are missing, so do not tidy it up.
              </p>
              <TextArea
                label="The page"
                rows={6}
                value={html}
                onChange={(event) => setHtml(event.target.value)}
              />
              <div>
                <Button variant="ghost" onClick={readPasted}>
                  Read what I pasted
                </Button>
              </div>
            </div>
          </details>

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </Card>

      {preview === undefined ? null : (
        <Preview
          animal={preview.animal}
          plan={preview.plan}
          merging={merging}
          onToggleMerge={(key) =>
            setMerging((current) => {
              const next = new Set(current);
              // crud-guard: allow-unconfirmed — unticking a checkbox in an unsaved preview
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          existing={existing}
          busy={busy}
          onSave={() => void commit(preview.animal, preview.plan)}
          onDiscard={() => setPreview(undefined)}
        />
      )}
    </Section>
  );
}

function Preview({
  animal,
  plan,
  merging,
  onToggleMerge,
  existing,
  busy,
  onSave,
  onDiscard,
}: {
  readonly animal: ImportedAnimal;
  readonly plan: ImportPlan;
  readonly merging: ReadonlySet<string>;
  readonly onToggleMerge: (key: string) => void;
  readonly existing: readonly ExternalAnimal[];
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}) {
  const nothingRead = plan.rows.length <= 1 && animal.name === undefined;
  const proposed = plan.rows.filter(
    (row) => row.match !== undefined && row.match.confidence !== "certain",
  );

  return (
    <Card title="What it read">
      <div className="flex flex-col gap-density">
        {nothingRead ? (
          <Callout tone="danger" title="Nothing on that page looked like an animal">
            The page came back but nothing could be read off it. Either it is a login page, or the
            template has changed. Pasting the page yourself is worth trying before anything else.
          </Callout>
        ) : animal.missing.length > 0 ? (
          <Callout tone="action" title={`Could not find: ${animal.missing.join(", ")}`}>
            Those fields were looked for by name and not found. That is different from the animal
            not having them — check the page before saving, because it usually means the template
            moved.
          </Callout>
        ) : null}

        <DetailList
          columns={3}
          items={[
            { label: "Association", value: animal.association },
            { label: "Registration", value: animal.registration },
            { label: "Name", value: animal.name },
            { label: "Tattoo", value: animal.tattoo },
            { label: "Sex", value: animal.sex },
            { label: "Born", value: animal.dob },
            { label: "Colour", value: animal.colour },
            { label: "Horns", value: animal.hornStatus },
            { label: "Status", value: animal.status },
            { label: "Disposed", value: animal.disposedOn },
            { label: "Bred by", value: animal.breeder },
            {
              label: "Inbreeding (their figure)",
              value: animal.coi === undefined ? undefined : `${animal.coi}%`,
            },
            {
              label: "Breeding",
              value:
                animal.breedComposition.length === 0
                  ? undefined
                  : animal.breedComposition
                      .map((share) => `${share.percent}% ${share.breed}`)
                      .join(" · "),
              wide: true,
            },
          ]}
        />

        {proposed.length === 0 ? null : (
          <Callout
            tone="action"
            title={`${proposed.length} of these may already be on file under another registry`}
          >
            One animal registered with two associations has two numbers, and neither page mentions
            the other. Tick the ones to join up — the second number gets added to the record that is
            already here. Leave one unticked and it comes in as a separate animal, which is the
            safer mistake: a duplicate is visible and can be merged later, a wrong join is not.
          </Callout>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-density font-medium text-ink">
            Pedigree — {plan.rows.length - 1} ancestors
          </h3>
          {plan.rows.map((row) => (
            <Row
              key={row.key}
              row={row}
              existing={existing}
              ticked={merging.has(row.key)}
              onToggle={() => onToggleMerge(row.key)}
            />
          ))}
        </div>

        {plan.unplaced.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <Callout tone="action" title={`${plan.unplaced.length} could not be placed on the chart`}>
              The chart had gaps that could not be accounted for, so where these sit is unknown.
              They are still worth saving — but their position has to be set by hand, because
              guessing puts a bull on the wrong side of a pedigree and every relatedness figure
              worked out afterwards is quietly wrong.
            </Callout>
            {plan.unplaced.map((row) => (
              <Row key={row.key} row={row} existing={existing} ticked={false} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={onSave} busy={busy} disabled={nothingRead}>
            Save these
          </Button>
          <Button variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Row({
  row,
  existing,
  ticked,
  onToggle,
}: {
  readonly row: ImportRow;
  readonly existing: readonly ExternalAnimal[];
  readonly ticked: boolean;
  readonly onToggle?: (() => void) | undefined;
}) {
  const match = row.match;
  const onFile = existing.find((entry) => entry.id === match?.existingId);
  const carries = (row.ancestor?.geneticTests ?? []).filter(
    (test) => test.status === "carrier" || test.status === "affected",
  );
  // What else is coming in with this animal, so nothing is saved unseen.
  const detail = [row.ancestor?.tattoo, row.ancestor?.colour, row.ancestor?.dob]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <div className="flex flex-col gap-1 border-t border-edge pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-density text-ink">{row.name}</span>
          {detail === "" ? null : <span className="text-sm text-muted">{detail}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {carries.length === 0 ? null : (
            <Pill tone="danger" dot>
              {carries.map((test) => test.defect).join(", ")} carrier
            </Pill>
          )}
          {row.regNumber === undefined ? null : <Pill>{row.regNumber}</Pill>}
          <Pill tone="identity">{row.position ?? row.ancestor?.branch ?? "this animal"}</Pill>
        </span>
      </div>

      {match === undefined ? null : match.confidence === "certain" ? (
        <p className="text-sm text-muted">{match.reason}</p>
      ) : (
        <label className="flex items-start gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={ticked}
            onChange={() => onToggle?.()}
            disabled={onToggle === undefined}
            className="mt-1"
          />
          <span>
            {match.reason}
            {onFile === undefined
              ? null
              : ` Already known as ${allRegistrations(onFile)
                  .map((entry) => `${entry.association} ${entry.regNumber}`)
                  .join(", ")}.`}
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * Everything read off the page, as a record.
 *
 * One place, so the subject animal and its thirty ancestors are written the
 * same way. They were not: the subject row carried no `ancestor`, so the
 * animal the page is actually *about* was saved with a name and a number while
 * its colour, birth date, horn status, breed makeup and defect results — all
 * of them already parsed — were dropped on the floor.
 *
 * Breeders and owners are read and deliberately not kept. They are a matter of
 * public record on the association's own site and nobody here needs them.
 */
function recordFor(row: ImportRow, animal: ImportedAnimal): Partial<ExternalAnimal> {
  const subject = row.key === "subject";
  const ancestor = row.ancestor;

  const date = (value: string | undefined): Date | undefined => {
    if (value === undefined) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  const dob = date(subject ? animal.dob : ancestor?.dob);
  const colour = subject ? animal.colour : ancestor?.colour;
  const tattoo = subject ? animal.tattoo : ancestor?.tattoo;
  const tests = subject ? [] : (ancestor?.geneticTests ?? []);

  // A slot called `dam's dam's sire` ends in "sire", so that animal is a bull.
  // The chart is the only place it is ever stated — a certificate has no sex
  // field. The subject's own page states it outright.
  const sex = subject
    ? /^(bull|steer)/i.test(animal.sex ?? "")
      ? "male"
      : /^(cow|heifer)/i.test(animal.sex ?? "")
        ? "female"
        : undefined
    : row.position === undefined
      ? undefined
      : sexFromPosition(row.position);

  return {
    name: row.name,
    ...(row.regNumber === undefined ? {} : { regNumber: row.regNumber }),
    association: row.association,
    ...(row.regNumber === undefined
      ? {}
      : { registrations: [{ association: row.association, regNumber: row.regNumber }] }),
    ...(tattoo === undefined ? {} : { tattoo }),
    ...(sex === undefined ? {} : { sex }),
    ...(dob === undefined ? {} : { dob }),
    ...(colour === undefined ? {} : { colour }),
    ...(tests.length === 0 ? {} : { geneticTests: tests }),
    ...(!subject
      ? {}
      : {
          ...(animal.hornStatus === undefined ? {} : { hornStatus: animal.hornStatus }),
          ...(animal.classification === undefined ? {} : { classification: animal.classification }),
          ...(animal.breedComposition.length === 0
            ? {}
            : { breedComposition: animal.breedComposition }),
          ...(animal.coi === undefined ? {} : { coi: animal.coi }),
          ...(animal.status === undefined ? {} : { status: animal.status }),
          ...(date(animal.disposedOn) === undefined ? {} : { disposedOn: date(animal.disposedOn) }),
          ...(animal.serviceType === undefined ? {} : { serviceType: animal.serviceType }),
          ...(animal.sourceUrl === undefined ? {} : { sourceUrl: animal.sourceUrl }),
        }),
    notes: `Imported from ${animal.association}${row.position === undefined ? "" : ` · ${row.position}`}`,
  };
}

/** Only what the record does not already have. Never overwrites. */
function fillBlanks(
  existing: ExternalAnimal | undefined,
  read: Partial<ExternalAnimal>,
): Partial<ExternalAnimal> {
  if (existing === undefined) return {};
  const patch: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(read)) {
    // `notes`, `name`, `association` and `regNumber` are excluded: the first
    // would append an import trail to a record somebody wrote by hand, and the
    // other three belong to whichever registry the record was created under.
    if (["notes", "name", "association", "regNumber", "registrations"].includes(field)) continue;
    if (value === undefined) continue;
    if ((existing as unknown as Record<string, unknown>)[field] !== undefined) continue;
    patch[field] = value;
  }

  return patch as Partial<ExternalAnimal>;
}
