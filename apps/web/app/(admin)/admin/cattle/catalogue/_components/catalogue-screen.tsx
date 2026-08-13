"use client";

import { useCallback, useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  DataTable,
  DetailList,
  EmptyState,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TextInput,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  catalogueParentPatch,
  catalogueRecord,
  describeBreed,
  externalAnimalSchema,
  MAX_CATALOGUE_GENERATIONS,
  mergeRegistration,
  planCatalogueImport,
  READABLE_REGISTRIES,
  registrationUrl,
  type CataloguePlan,
  type CatalogueRow,
  type ExternalAnimal,
  type RegistryAnimal,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The association catalogue (spec §5.2, §7).
 *
 * Every animal the crawler found in the herdbooks — a hundred thousand of
 * them, none of them ours. This is the one screen on the site that is not
 * offline-first, and deliberately so: the catalogue is far too large to sit on
 * a phone, and it is the one thing nobody needs in the barn at zero bars. It
 * is used at a desk, once, when a straw is being considered.
 *
 * It is kept apart from the Ancestors screen because the two are trusted
 * differently. The ancestors are the pedigree behind this herd: a few dozen
 * records, corrected by hand when a page is misread, and the thing every
 * relatedness figure and colour prediction is drawn from. The catalogue is
 * somebody else's crawl. Merging them would bury the thirty records that
 * matter and let a mistyped crawl quietly rewrite a pedigree built by hand.
 *
 * So the flow is one-way and it goes through a person: **search, look, bring
 * across.** Nothing is copied until somebody asks for it, and once copied it is
 * ours to correct.
 */

interface SearchState {
  readonly text: string;
  readonly association: string;
  readonly sex: string;
}

const EMPTY: SearchState = { text: "", association: "", sex: "" };

interface Found {
  readonly found: readonly RegistryAnimal[];
  readonly total: number;
}

/** What the API says when the graph is not configured, said in plainer words. */
const NOT_SET_UP =
  "The association catalogue is not connected on this server. Everything else on the site works without it — it is the crawled herdbooks that are missing, not your own records.";

async function ask<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(response.status === 503 ? NOT_SET_UP : (body.error ?? "That did not work."));
  }
  return body;
}

const dayOf = (value: Date | string | undefined): string =>
  value === undefined ? "—" : new Date(value).toISOString().slice(0, 10);

export function CatalogueScreen({
  propertyId,
  actorId,
}: {
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

  const { records: onFile } = useRecords<ExternalAnimal>("externalAnimals", { propertyId });

  const [search, setSearch] = useState<SearchState>(EMPTY);
  const [result, setResult] = useState<Found | undefined>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /** The animal being looked at, with however far back was asked for. */
  const [opened, setOpened] = useState<
    | {
        readonly animal: RegistryAnimal;
        readonly plan: CataloguePlan;
        readonly generations: number;
      }
    | undefined
  >();
  const [opening, setOpening] = useState(false);
  const [bringing, setBringing] = useState(false);
  /** Which proposed merges have been agreed to. Certain ones are not asked. */
  const [merging, setMerging] = useState<ReadonlySet<string>>(new Set());

  const runSearch = useCallback(async () => {
    setSearching(true);
    setError(undefined);
    setOpened(undefined);

    const query = new URLSearchParams();
    if (search.text.trim() !== "") query.set("text", search.text.trim());
    if (search.association !== "") query.set("association", search.association);
    if (search.sex !== "") query.set("sex", search.sex);

    try {
      setResult(await ask<Found>(`/api/registry/search?${query.toString()}`));
    } catch (caught) {
      setResult(undefined);
      setError(caught instanceof Error ? caught.message : "That search did not work.");
    } finally {
      setSearching(false);
    }
  }, [search]);

  const open = useCallback(
    async (animal: RegistryAnimal, generations: number) => {
      setOpening(true);
      setError(undefined);

      try {
        const detail = await ask<{
          animal: RegistryAnimal;
          pedigree: (RegistryAnimal & { position: string; generation: number })[];
        }>(
          `/api/registry/animal?association=${encodeURIComponent(animal.association)}` +
            `&regNumber=${encodeURIComponent(animal.regNumber)}&generations=${generations}`,
        );

        const plan = planCatalogueImport(detail.animal, detail.pedigree, onFile);
        setOpened({ animal: detail.animal, plan, generations });
        // Certain matches are not a decision — they are the same animal. Only
        // the proposals start unticked.
        setMerging(new Set());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That animal could not be read.");
      } finally {
        setOpening(false);
      }
    },
    [onFile],
  );

  /**
   * Write the plan.
   *
   * In pedigree order, so a parent always exists before the calf that points
   * at it — then a second pass to join them up, because the crawler names
   * parents by registration and the ids only exist once the first pass is
   * done.
   */
  const bringAcross = useCallback(async () => {
    if (opened === undefined) return;
    setBringing(true);

    const ids = new Map<string, Ulid>();
    const written: { row: CatalogueRow; existing?: ExternalAnimal | undefined }[] = [];
    let created = 0;
    let merged = 0;

    try {
      for (const row of opened.plan.rows) {
        const agreed =
          row.match !== undefined && (row.match.confidence === "certain" || merging.has(row.key));

        if (agreed) {
          const existing = onFile.find((animal) => animal.id === row.match?.existingId);
          if (existing !== undefined) {
            ids.set(row.key, existing.id);
            written.push({ row, existing });

            // Fold in the number this copy would have added, and nothing else.
            // A record somebody has corrected keeps its corrections.
            const patch = mergeRegistration(existing, {
              association: row.animal.association,
              regNumber: row.animal.regNumber,
            });
            if (patch !== undefined) {
              await api.update(existing.id, patch);
              merged += 1;
            }
            continue;
          }
        }

        const outcome = await api.create(
          catalogueRecord(row) as Omit<
            ExternalAnimal,
            "id" | "propertyId" | "createdAt" | "updatedAt"
          >,
        );
        if (outcome.ok) {
          ids.set(row.key, outcome.value.id);
          written.push({ row });
          created += 1;
        }
      }

      let joined = 0;
      for (const entry of written) {
        const id = ids.get(entry.row.key);
        if (id === undefined) continue;

        const patch = catalogueParentPatch(entry.row, ids, entry.existing);
        if (patch === undefined) continue;

        await api.update(id, patch);
        joined += 1;
      }

      show({
        tone: "success",
        message:
          `${created} brought across. ` +
          `${merged === 0 ? "" : `${merged} already here, with the new number added. `}` +
          `${joined === 0 ? "Nothing to join up." : `${joined} joined to their parents.`}`,
      });
      setOpened(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Not everything could be saved.");
    } finally {
      setBringing(false);
    }
  }, [api, merging, onFile, opened, show]);

  const columns = useMemo<Column<RegistryAnimal>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        primary: true,
        render: (animal) => (
          <button
            type="button"
            className="text-left font-medium text-action underline-offset-2 hover:underline"
            onClick={() => void open(animal, MAX_CATALOGUE_GENERATIONS)}
          >
            {animal.name}
          </button>
        ),
      },
      {
        key: "papers",
        header: "Papers",
        render: (animal) => (
          <span className="flex flex-wrap gap-1">
            {(
              animal.registrations ?? [
                { association: animal.association, regNumber: animal.regNumber },
              ]
            ).map((entry) => (
              <Pill key={`${entry.association}-${entry.regNumber}`} tone="identity">
                {entry.association} {entry.regNumber}
              </Pill>
            ))}
          </span>
        ),
      },
      { key: "sex", header: "Sex", render: (animal) => animal.sex ?? "—" },
      { key: "dob", header: "DOB", numeric: true, render: (animal) => dayOf(animal.dob) },
      { key: "colour", header: "Color", render: (animal) => animal.colour ?? "—" },
      {
        key: "breed",
        header: "Breed",
        render: (animal) => describeBreed(animal) || "—",
      },
    ],
    [open],
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Association catalogue"
        subtitle="Every animal the crawl found in the herdbooks. Read-only — search it, then bring what you need across into Ancestors."
        meta={
          result === undefined ? undefined : (
            <Pill tone="neutral">
              {result.total.toLocaleString()} matching · showing {result.found.length}
            </Pill>
          )
        }
      />

      <Section
        title="Search"
        description="Name, registration number or tattoo — any part of any of them."
      >
        <Card>
          <form
            className="grid gap-density sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <TextInput
              label="Name, number or tattoo"
              value={search.text}
              autoComplete="off"
              onChange={(event) => setSearch({ ...search, text: event.target.value })}
            />
            <Select
              label="Registry"
              placeholder="All registries"
              value={search.association}
              options={READABLE_REGISTRIES.map((code) => ({ value: code, label: code }))}
              onChange={(event) => setSearch({ ...search, association: event.target.value })}
            />
            <Select
              label="Sex"
              placeholder="Bulls and cows"
              value={search.sex}
              options={[
                { value: "male", label: "Bulls" },
                { value: "female", label: "Cows" },
              ]}
              onChange={(event) => setSearch({ ...search, sex: event.target.value })}
              // A sire picked out of a list that includes cows is how a cow
              // ends up in a sire slot, and everything drawn from it afterwards
              // looks perfectly ordinary and is nonsense.
              hint="Worth setting when you are looking for a sire."
            />
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={searching}>
                {searching ? "Searching…" : "Search"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch(EMPTY);
                  setResult(undefined);
                  setOpened(undefined);
                }}
              >
                Clear
              </Button>
            </div>
          </form>
        </Card>
      </Section>

      {error === undefined ? null : (
        <Callout tone="danger" title="The catalogue could not be reached">
          {error}
        </Callout>
      )}

      {result === undefined ? null : result.found.length === 0 ? (
        <EmptyState
          title="Nothing matched"
          detail="The crawl covers the registries this farm papers with. An animal from another association will not be in it — import that one from its own page on the Ancestors screen."
        />
      ) : (
        <Section
          title="Results"
          description={
            result.total > result.found.length
              ? `${result.total.toLocaleString()} animals match. The first ${result.found.length} are below — narrow the search to see the rest.`
              : undefined
          }
        >
          <DataTable
            caption="Catalogue search results"
            columns={columns}
            rows={result.found}
            rowKey={(animal) => `${animal.association}:${animal.regNumber}`}
          />
        </Section>
      )}

      {opening ? (
        <Callout tone="neutral" title="Reading the pedigree…">
          Walking back {MAX_CATALOGUE_GENERATIONS} generations.
        </Callout>
      ) : null}

      {opened === undefined ? null : (
        <BringAcross
          opened={opened}
          merging={merging}
          setMerging={setMerging}
          busy={bringing}
          onCancel={() => setOpened(undefined)}
          onConfirm={() => void bringAcross()}
        />
      )}
    </PageBody>
  );
}

/**
 * The preview, which is the whole point of the screen.
 *
 * Everything this would write, what it recognised, and what it is only
 * guessing at — before a single record is created. A wrong merge welds two
 * animals' descendants together and nothing looks unusual afterwards, so the
 * guesses are ticked by a person and the certainties are not asked about.
 */
function BringAcross({
  opened,
  merging,
  setMerging,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly opened: { animal: RegistryAnimal; plan: CataloguePlan; generations: number };
  readonly merging: ReadonlySet<string>;
  readonly setMerging: (next: ReadonlySet<string>) => void;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { animal, plan } = opened;
  const url = registrationUrl(animal.association, animal.regNumber);

  const newRecords = plan.rows.filter(
    (row) =>
      row.match === undefined || (row.match.confidence !== "certain" && !merging.has(row.key)),
  ).length;

  const toggle = (key: string): void => {
    const next = new Set(merging);
    // crud-guard: allow-unconfirmed — unticking a proposed merge in a preview that has written nothing yet
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setMerging(next);
  };

  return (
    <Section
      title={animal.name}
      description={`${animal.association} ${animal.regNumber} · ${plan.rows.length} animals in this pedigree, ${plan.known} of them already on file.`}
      actions={
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Bringing across…" : `Bring ${newRecords} across`}
          </Button>
        </span>
      }
    >
      <Card>
        <DetailList
          items={[
            { label: "Sex", value: animal.sex ?? "—" },
            { label: "DOB", value: dayOf(animal.dob) },
            { label: "Color", value: animal.colour ?? "—" },
            { label: "Horns", value: animal.hornStatus ?? "—" },
            { label: "Tattoo", value: animal.tattoo ?? "—" },
            { label: "Class on the papers", value: animal.classification ?? "—" },
            { label: "Breed", value: describeBreed(animal) || "—" },
            {
              label: "On the association's site",
              value:
                url === undefined ? (
                  "—"
                ) : (
                  <a className="text-action underline" href={url} target="_blank" rel="noreferrer">
                    {animal.association} {animal.regNumber}
                  </a>
                ),
            },
          ]}
        />
      </Card>

      <ul className="flex flex-col gap-2">
        {plan.rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-baseline gap-2 rounded-density border border-edge bg-panel px-3 py-2"
          >
            <span className="font-medium text-ink">{row.animal.name}</span>
            <Pill tone="identity">
              {row.animal.association} {row.animal.regNumber}
            </Pill>
            <span className="text-sm text-muted">{row.position ?? "the animal itself"}</span>

            {row.match === undefined ? (
              <Pill tone="action">New</Pill>
            ) : row.match.confidence === "certain" ? (
              <Pill tone="calm">Already on file</Pill>
            ) : (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={merging.has(row.key)}
                  onChange={() => toggle(row.key)}
                />
                <span>{row.match.reason}</span>
              </label>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
