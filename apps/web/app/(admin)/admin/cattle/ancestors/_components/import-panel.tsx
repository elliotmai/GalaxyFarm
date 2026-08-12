"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  Card,
  DetailList,
  Pill,
  Section,
  TextArea,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  externalAnimalSchema,
  parseDigitalBeefPage,
  parseDigitalBeefUrl,
  type ImportedAnimal,
  type ExternalAnimal,
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
 * when the association's host will talk to a datacenter IP, and plenty do not.
 *
 * **By paste**: open the page yourself, select all, paste it here. This works
 * regardless of what the host thinks of our server, and it works behind a
 * login. It is the path to use when the first one fails, and it is worth
 * knowing about *before* it fails, which is why both are on the screen at
 * once rather than one appearing after the other errors.
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

  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [preview, setPreview] = useState<ImportedAnimal | undefined>();

  async function fetchByUrl() {
    setError(undefined);
    setPreview(undefined);

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
      setPreview(payload.animal);
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

    setPreview(parseDigitalBeefPage(html, parsed.ref));
  }

  /**
   * Write the animal and its ancestors.
   *
   * Ids are minted here and the parents wired in a second pass, because an
   * ancestor's sire is another ancestor that may not exist yet. Anything
   * already on file under the same registration number is left alone rather
   * than duplicated — importing the same bull twice is the likeliest mistake
   * on this screen, since he is the sire of half the herd.
   */
  async function commit(animal: ImportedAnimal) {
    setBusy(true);
    try {
      const byReg = new Map(
        existing
          .filter((entry) => entry.regNumber !== undefined)
          .map((entry) => [entry.regNumber as string, entry.id]),
      );

      const minted = new Map<string, Ulid>();
      const created: string[] = [];
      let skipped = 0;

      const rows = [
        {
          name: animal.name ?? `${animal.association} ${animal.registration}`,
          regNumber: animal.registration,
          position: "subject",
        },
        ...animal.ancestors.map((ancestor) => ({
          name: ancestor.name ?? "Unnamed",
          regNumber: ancestor.regNumber,
          position: ancestor.position,
        })),
      ];

      for (const row of rows) {
        const key = row.regNumber ?? `name:${row.name}`;
        if (row.regNumber !== undefined && byReg.has(row.regNumber)) {
          minted.set(key, byReg.get(row.regNumber) as Ulid);
          skipped += 1;
          continue;
        }
        if (minted.has(key)) continue;

        const result = await api.create({
          name: row.name,
          ...(row.regNumber === undefined ? {} : { regNumber: row.regNumber }),
          association: animal.association,
          notes: `Imported from ${animal.association} · ${row.position}`,
        } as never);

        if (!result.ok) {
          setError(`Could not save ${row.name}.`);
          return;
        }
        minted.set(key, result.value.id);
        created.push(row.name);
      }

      // Second pass: the sire and dam of the subject, which are the only two
      // relationships a three-generation chart pins down without ambiguity.
      // Grandparents are positional and get wired by hand — guessing wrong
      // there puts a bull on the wrong side of a pedigree.
      const subjectId = minted.get(animal.registration);
      const sire = animal.ancestors.find((entry) => entry.position === "sire");
      const dam = animal.ancestors.find((entry) => entry.position === "dam");

      const refOf = (entry: typeof sire): ParentRef | undefined => {
        if (entry === undefined) return undefined;
        const id = minted.get(entry.regNumber ?? `name:${entry.name ?? "Unnamed"}`);
        return id === undefined ? undefined : { kind: "external", id };
      };

      if (subjectId !== undefined) {
        const sireRef = refOf(sire);
        const damRef = refOf(dam);
        if (sireRef !== undefined || damRef !== undefined) {
          await api.update(subjectId, {
            ...(sireRef === undefined ? {} : { sire: sireRef }),
            ...(damRef === undefined ? {} : { dam: damRef }),
          } as Partial<ExternalAnimal>);
        }
      }

      show({
        message: `${created.length} added${skipped > 0 ? `, ${skipped} already on file` : ""}`,
        tone: "success",
      });
      setPreview(undefined);
      setUrl("");
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
          <TextInput
            label="Animal's web address"
            hint="From maine-anjou, chianina or shorthorn.digitalbeef.com. The address is what says which registry the numbers belong to."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://shorthorn.digitalbeef.com/modules.php?…&animal_registration=4219133"
          />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void fetchByUrl()} busy={busy}>
              Fetch and read it
            </Button>
          </div>

          <details className="rounded-density border border-edge p-density">
            <summary className="cursor-pointer text-density font-medium text-ink">
              Or paste the page — works when the site will not talk to our server
            </summary>
            <div className="flex flex-col gap-density pt-density">
              <p className="text-sm text-muted">
                Open the animal's page in a browser, select the whole page and copy it, then paste
                it here. This works behind a login and regardless of what the association's host
                thinks of our server.
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
          animal={preview}
          busy={busy}
          onSave={() => void commit(preview)}
          onDiscard={() => setPreview(undefined)}
        />
      )}
    </Section>
  );
}

function Preview({
  animal,
  busy,
  onSave,
  onDiscard,
}: {
  readonly animal: ImportedAnimal;
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}) {
  const nothingRead = animal.ancestors.length === 0 && animal.name === undefined;

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

        {animal.ancestors.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <h3 className="text-density font-medium text-ink">Pedigree</h3>
            {animal.ancestors.map((ancestor) => (
              <div
                key={`${ancestor.position}-${ancestor.regNumber ?? ancestor.name}`}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-2"
              >
                <span className="text-density text-ink">{ancestor.name ?? "Unnamed"}</span>
                <span className="flex flex-wrap gap-2">
                  {ancestor.regNumber === undefined ? null : <Pill>{ancestor.regNumber}</Pill>}
                  <Pill tone="identity">{ancestor.position}</Pill>
                </span>
              </div>
            ))}
            <p className="text-sm text-muted">
              The sire and the dam get wired to this animal. Grandparents are saved as ancestors and
              left for you to place — their position on a chart is inferred from order, and guessing
              wrong puts a bull on the wrong side of a pedigree.
            </p>
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
