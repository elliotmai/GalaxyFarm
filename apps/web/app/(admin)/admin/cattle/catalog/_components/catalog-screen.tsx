"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  Button,
  Callout,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  TextInput,
  useToast,
  type Tone,
} from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";
import {
  carries,
  catalogueParentPatch,
  catalogueRecord,
  describeBreed,
  externalAnimalSchema,
  isKnownFree,
  MAX_CATALOGUE_GENERATIONS,
  mergeRegistration,
  planCatalogueImport,
  READABLE_REGISTRIES,
  registrationUrl,
  reviveRegistryAnimal,
  semenInventorySchema,
  STATUS_LABELS,
  DEFECT_NAMES,
  type CataloguePlan,
  type CatalogueRow,
  type ExternalAnimal,
  type GeneticTest,
  type RegistryAnimal,
  type SemenInventory,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The association catalog (spec §5.2, §7).
 *
 * Every animal the crawler found in the herdbooks — a hundred thousand of
 * them, none of them ours. This is the one screen on the site that is not
 * offline-first, and deliberately so: the catalog is far too large to sit on
 * a phone, and it is the one thing nobody needs in the barn at zero bars. It
 * is used at a desk, once, when a straw is being considered.
 *
 * It is kept apart from the Ancestors screen because the two are trusted
 * differently. The ancestors are the pedigree behind this herd: a few dozen
 * records, corrected by hand when a page is misread, and the thing every
 * relatedness figure and colour prediction is drawn from. The catalog is
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
  /** Matched, but with no papers in the crawl — see the callout below. */
  readonly unpapered?: number;
  /** Matched the words, then removed by the registry or sex filter. */
  readonly excludedByFilters?: number;
}

async function ask<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as T & { error?: string };

  // The route's own words either way. A 503 here means the graph is not
  // configured, and it names which settings are missing — which is the whole
  // difference between "nothing is set up" and "you set three of the four".
  if (!response.ok) throw new Error(body.error ?? "That did not work.");
  return body;
}

const dayOf = (value: Date | string | undefined): string =>
  value === undefined ? "—" : new Date(value).toISOString().slice(0, 10);

const yearOf = (value: Date | string | undefined): string | undefined =>
  value === undefined ? undefined : String(new Date(value).getUTCFullYear());

/** Every number the animal is papered under, as one string. */
const papersOf = (animal: RegistryAnimal): string =>
  (animal.registrations ?? [{ association: animal.association, regNumber: animal.regNumber }])
    .map((entry) => `${entry.association} ${entry.regNumber}`)
    .join(", ");

/** Colour and horns, the two things read off a straw catalogue at a glance. */
const lookOf = (animal: RegistryAnimal): string | undefined =>
  [animal.colour, animal.hornStatus].filter(Boolean).join(" · ") || undefined;

/**
 * The one chip a result row carries.
 *
 * A defect carrier is the thing worth seeing before opening him, so it wins;
 * "Clean" only when every test on the papers came back free. Anything else —
 * untested, suspect, a mix — says nothing rather than something reassuring.
 */
function statusChip(
  tests: readonly GeneticTest[] | undefined,
): { label: string; tone: Tone } | undefined {
  const all = tests ?? [];
  const carried = all.filter((test) => carries(test.status));

  const [first] = carried;
  if (first !== undefined) {
    return {
      tone: "danger",
      label:
        carried.length === 1
          ? `${first.defect} ${first.status === "affected" ? "affected" : "carrier"}`
          : `Carries ${carried.map((test) => test.defect).join(", ")}`,
    };
  }
  if (all.length > 0 && all.every((test) => isKnownFree(test.status))) {
    return { tone: "calm", label: "Clean" };
  }
  return undefined;
}

const EXPLANATION =
  "Every animal the crawl found in the association herdbooks. It is read-only: nothing here is yours until you bring it across, and it then lands in Ancestors, where you can correct it.";

/** The chip-shaped toggle under the search box. */
const CHIP =
  "inline-flex min-h-target items-center rounded-full border px-4 text-sm font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

export function CatalogScreen({
  propertyId,
  actorId,
  initialText,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** Words handed over by the global search (`?text=`), searched on arrival. */
  readonly initialText?: string | undefined;
}) {
  const api = useMutations<ExternalAnimal>(
    "externalAnimals",
    "externalAnimals",
    externalAnimalSchema,
    propertyId,
    actorId,
  );
  const tank = useMutations<SemenInventory>(
    "semenInventory",
    "semenInventory",
    semenInventorySchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const { records: onFile } = useRecords<ExternalAnimal>("externalAnimals", { propertyId });

  const [search, setSearch] = useState<SearchState>({ ...EMPTY, text: initialText ?? "" });
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
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
  /**
   * The bull just brought across, while the reason for bringing him is fresh.
   *
   * "Used at a desk, once, when a straw is being considered" is what this
   * screen is for, and the straw was the point of the visit — so the tank is
   * offered here rather than left as a second errand on another screen, where
   * he would be typed in again by name and the pedigree just imported would go
   * unused.
   */
  const [brought, setBrought] = useState<
    { readonly id: Ulid; readonly name: string; readonly bull: boolean } | undefined
  >();

  /**
   * Search with what is in the box — or with `next`, when a chip has just
   * changed the filters and the state holding them has not landed yet.
   */
  const runSearch = useCallback(
    async (next: SearchState = search) => {
      setSearching(true);
      setError(undefined);
      setOpened(undefined);

      const query = new URLSearchParams();
      if (next.text.trim() !== "") query.set("text", next.text.trim());
      if (next.association !== "") query.set("association", next.association);
      if (next.sex !== "") query.set("sex", next.sex);

      try {
        const answer = await ask<Found>(`/api/registry/search?${query.toString()}`);
        setResult({ ...answer, found: answer.found.map(reviveRegistryAnimal) });
      } catch (caught) {
        setResult(undefined);
        setError(caught instanceof Error ? caught.message : "That search did not work.");
      } finally {
        setSearching(false);
      }
    },
    [search],
  );

  // Arriving from the global search with words already typed: search them
  // once, on the way in. A ref rather than an empty dependency list, so a
  // re-render never searches a second time.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if ((initialText ?? "").trim() !== "") void runSearch();
  }, [initialText, runSearch]);

  /**
   * A filter changed. Once there are results on screen they are re-asked for
   * straight away — a chip that lights up while the list under it still shows
   * the old answer is a chip that appears not to work.
   */
  const refilter = (next: SearchState): void => {
    setSearch(next);
    if (result !== undefined) void runSearch(next);
  };

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

        // Dates back into dates before anything reads them. JSON has no date,
        // so what arrives is a string wearing the type of one.
        const subject = reviveRegistryAnimal(detail.animal);
        const pedigree = detail.pedigree.map(reviveRegistryAnimal);

        const plan = planCatalogueImport(subject, pedigree, onFile);
        setOpened({ animal: subject, plan, generations });
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

      // The animal the search landed on is the first row, and the one somebody
      // came here for. A cow is never offered to the tank; a bull whose sex the
      // crawl never read is, because that is what a straw is.
      const subject = opened.plan.rows[0];
      const subjectId = subject === undefined ? undefined : ids.get(subject.key);
      setBrought(
        subjectId === undefined
          ? undefined
          : {
              id: subjectId,
              name: opened.animal.name,
              bull: opened.animal.sex !== "female",
            },
      );
      setOpened(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Not everything could be saved.");
    } finally {
      setBringing(false);
    }
  }, [api, merging, onFile, opened, show]);

  const sexWord = search.sex === "male" ? "Bulls" : search.sex === "female" ? "Cows" : undefined;
  const filterWords = [search.association === "" ? undefined : search.association, sexWord]
    .filter((entry) => entry !== undefined)
    .join(", ");
  const hidden = result?.excludedByFilters ?? 0;
  const unpapered = result?.unpapered ?? 0;
  const unshown = result === undefined ? 0 : result.total - result.found.length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Association catalog"
        actions={
          <button
            type="button"
            aria-label="What is the catalog?"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen(!helpOpen)}
            className={[
              "flex min-h-target min-w-target items-center justify-center rounded-full border",
              "bg-panel text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-action",
              helpOpen ? "border-action text-action" : "border-rule text-muted hover:text-ink",
            ].join(" ")}
          >
            ?
          </button>
        }
        meta={
          <span className="text-sm text-muted">
            {result === undefined
              ? "Read-only"
              : `${result.total.toLocaleString()} matching · showing ${result.found.length}`}
          </span>
        }
      />

      {helpOpen ? (
        <p
          id={helpId}
          className="max-w-prose rounded-density border border-rule bg-panel p-density text-sm leading-relaxed text-ink"
        >
          {EXPLANATION}
        </p>
      ) : null}

      <form
        role="search"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <div className="flex gap-2">
          <label htmlFor={`${helpId}-q`} className="sr-only">
            Name, number or tattoo
          </label>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-density border-2 border-action bg-panel px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action">
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-muted"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              id={`${helpId}-q`}
              type="search"
              value={search.text}
              autoComplete="off"
              placeholder="Name, reg # or tattoo"
              onChange={(event) => setSearch({ ...search, text: event.target.value })}
              className="h-12 min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-muted"
            />
          </div>
          <Button type="submit" variant="primary" busy={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${helpId}-reg`} className="sr-only">
            Registry
          </label>
          <select
            id={`${helpId}-reg`}
            value={search.association}
            onChange={(event) => refilter({ ...search, association: event.target.value })}
            className={[
              CHIP,
              "bg-panel text-ink",
              search.association === "" ? "border-edge" : "border-2 border-action",
            ].join(" ")}
          >
            <option value="">Any registry</option>
            {READABLE_REGISTRIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {/*
            A sire picked out of a list that includes cows is how a cow ends up
            in a sire slot, and everything drawn from it afterwards looks
            perfectly ordinary and is nonsense — so Bulls is one tap away.
            Pressing the chip already on clears it.
          */}
          {(
            [
              { value: "male", label: "Bulls" },
              { value: "female", label: "Cows" },
            ] as const
          ).map((option) => {
            const on = search.sex === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => refilter({ ...search, sex: on ? "" : option.value })}
                className={[
                  CHIP,
                  on
                    ? "border-action bg-action text-action-ink"
                    : "border-edge bg-panel text-ink hover:bg-canvas",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
          {search.text === "" &&
          search.association === "" &&
          search.sex === "" &&
          result === undefined ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch(EMPTY);
                setResult(undefined);
                setOpened(undefined);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </form>

      {error === undefined || opened !== undefined ? null : (
        <Callout tone="danger" title="The catalog could not be reached">
          {error}
        </Callout>
      )}

      {result === undefined ? null : result.found.length === 0 ? (
        <EmptyState
          title={
            search.text.trim() === ""
              ? "Nothing matched"
              : `Nothing matches “${search.text.trim()}”`
          }
          detail={
            unpapered > 0
              ? "Nothing with papers, at least. The crawl knows these animals by name but has not read their registrations yet."
              : "Try the registration number or tattoo, or fewer words of the name. An animal from another association is imported from its own page on Ancestors."
          }
        />
      ) : (
        <ResultList
          found={result.found}
          onOpen={(animal) => void open(animal, MAX_CATALOGUE_GENERATIONS)}
        />
      )}

      {/*
        Counted, never hidden. The search is an inner match on the registration,
        so an animal the crawl has created but not yet papered cannot come back
        from it however well it matches — and a pedigree walk creates exactly
        that: a sire is a node the moment somebody's papers name him, and his
        own registration only appears when the crawl reaches him.

        Saying "nothing matched" in that case is false, and it sends somebody
        who has just seen the animal in the database looking for a fault in the
        app rather than a gap in the crawl.
      */}
      {/*
        A filter that removes everything looks exactly like a catalogue that
        does not hold the animal — an empty table — and the two are fixed in
        completely different places. Two ways it happens and neither shows from
        outside: the registry filter matches the *registration*, so a bull
        papered in two associations is invisible under the one whose number was
        not searched; and the sex filter compares against a value the crawl may
        not have, so asking for bulls hides every animal whose sex was never
        read off a page.
      */}
      {result === undefined || (hidden === 0 && unpapered === 0 && unshown <= 0) ? null : (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {hidden === 0 ? null : (
            <span className="inline-flex flex-wrap items-center gap-x-1">
              {hidden.toLocaleString()} more hidden by “{filterWords}” ·
              <button
                type="button"
                onClick={() => refilter({ ...search, association: "", sex: "" })}
                className="min-h-target px-1 font-semibold text-action hover:underline"
              >
                Show them
              </button>
            </span>
          )}
          {unpapered === 0 ? null : (
            <span>{unpapered.toLocaleString()} more match with no papers yet</span>
          )}
          {unshown <= 0 ? null : (
            <span>{unshown.toLocaleString()} more not shown · narrow the search</span>
          )}
        </p>
      )}

      {opening && opened === undefined ? (
        <p role="status" className="text-sm text-muted">
          Reading the pedigree, {MAX_CATALOGUE_GENERATIONS} generations back…
        </p>
      ) : null}

      {brought === undefined || !brought.bull ? null : (
        <AddToTank
          name={brought.name}
          onDismiss={() => setBrought(undefined)}
          onAdd={async (straws) => {
            const result = await tank.create({
              // The reference, not just the name. It is what makes the straw
              // worth joining: the breeding drawn from it inherits the sire,
              // and the calf is pedigreed from the tree just imported.
              sireExternalId: brought.id,
              sireName: brought.name,
              strawsOnHand: straws,
            } as never);

            if (!result.ok) {
              setError("That could not be added to the tank.");
              return;
            }
            setBrought(undefined);
            show({
              tone: "success",
              message: `${straws} straw${straws === 1 ? "" : "s"} of ${brought.name} in the tank`,
            });
          }}
        />
      )}

      {opened === undefined ? null : (
        <BringAcross
          opened={opened}
          merging={merging}
          setMerging={setMerging}
          busy={bringing}
          reading={opening}
          error={error}
          onGenerations={(generations) => void open(opened.animal, generations)}
          onCancel={() => {
            if (!bringing) setOpened(undefined);
          }}
          onConfirm={() => void bringAcross()}
        />
      )}
    </PageBody>
  );
}

/**
 * The results, one compact row each.
 *
 * A list of buttons rather than a table of links: the whole row opens the
 * animal, which is a 44px target on a phone instead of a name-sized one. On a
 * laptop the same rows line up into columns under a header.
 */
function ResultList({
  found,
  onOpen,
}: {
  readonly found: readonly RegistryAnimal[];
  readonly onOpen: (animal: RegistryAnimal) => void;
}) {
  const id = useId();
  const columns =
    "md:grid-cols-[minmax(12rem,2.2fr)_minmax(9rem,1.4fr)_minmax(8rem,1.2fr)_4.5rem_7.5rem]";

  return (
    <div className="overflow-hidden rounded-density border border-rule bg-panel">
      <div
        aria-hidden="true"
        className={`hidden gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid ${columns}`}
      >
        <span>Name</span>
        <span>Registration</span>
        <span>Colour · horn</span>
        <span>Born</span>
        <span>Tests</span>
      </div>
      <ul aria-label="Catalog search results" className="flex flex-col">
        {found.map((animal, index) => {
          const chip = statusChip(animal.geneticTests);
          const papers = papersOf(animal);
          const look = lookOf(animal);
          const year = yearOf(animal.dob);
          const nameId = `${id}-${index}-name`;
          const factsId = `${id}-${index}-facts`;

          return (
            <li
              key={`${animal.association}:${animal.regNumber}`}
              className="border-t border-rule first:border-t-0 md:first:border-t"
            >
              <button
                type="button"
                aria-labelledby={nameId}
                aria-describedby={factsId}
                onClick={() => onOpen(animal)}
                className={[
                  "grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 text-left",
                  "hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action",
                  `md:min-h-14 md:gap-x-4 ${columns}`,
                ].join(" ")}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span id={nameId} className="truncate font-semibold text-ink">
                    {animal.name}
                  </span>
                  <span id={factsId} className="truncate text-sm text-muted md:hidden">
                    {[papers, look, year].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span aria-hidden="true" className="hidden truncate text-sm md:block">
                  {papers}
                </span>
                <span aria-hidden="true" className="hidden truncate text-sm text-muted md:block">
                  {look ?? "—"}
                </span>
                <span aria-hidden="true" className="hidden text-sm tabular-nums md:block">
                  {year ?? "—"}
                </span>
                <span className="justify-self-end md:justify-self-start">
                  {chip === undefined ? null : <Pill tone={chip.tone}>{chip.label}</Pill>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The straw this visit was about.
 *
 * Offered only after the pedigree is on file, so what goes in the tank is a
 * reference rather than a name — the difference between a cane that pedigrees
 * a calf at calving and one that leaves the sire column blank.
 */
function AddToTank({
  name,
  onAdd,
  onDismiss,
}: {
  readonly name: string;
  readonly onAdd: (straws: number) => Promise<void>;
  readonly onDismiss: () => void;
}) {
  const [straws, setStraws] = useState("1");
  const [busy, setBusy] = useState(false);

  const count = Number(straws);
  const valid = Number.isInteger(count) && count > 0;

  return (
    <Callout tone="identity" title={`${name} is on file. Straws of him in the tank?`}>
      <p>A breeding picks him from the tank and keeps his pedigree, with no name typed twice.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <TextInput
          label="Straws"
          type="number"
          inputMode="numeric"
          value={straws}
          onChange={(event) => setStraws(event.target.value)}
        />
        <Button
          variant="primary"
          disabled={!valid || busy}
          onClick={() => {
            setBusy(true);
            void onAdd(count).finally(() => setBusy(false));
          }}
        >
          {busy ? "Adding…" : "Add to the tank"}
        </Button>
        <Button variant="ghost" onClick={onDismiss} disabled={busy}>
          Not now
        </Button>
      </div>
    </Callout>
  );
}

/**
 * The preview, which is the whole point of the screen.
 *
 * Everything this would write, what it recognised, and what it is only
 * guessing at — before a single record is created. A wrong merge welds two
 * animals' descendants together and nothing looks unusual afterwards, so the
 * guesses are ticked by a person and the certainties are not asked about.
 *
 * In a side panel rather than under the list: opened from a row near the foot
 * of fifty results, a preview rendered below them appeared to do nothing. On a
 * phone the same panel is a bottom sheet.
 */
function BringAcross({
  opened,
  merging,
  setMerging,
  busy,
  reading,
  error,
  onGenerations,
  onCancel,
  onConfirm,
}: {
  readonly opened: { animal: RegistryAnimal; plan: CataloguePlan; generations: number };
  readonly merging: ReadonlySet<string>;
  readonly setMerging: (next: ReadonlySet<string>) => void;
  readonly busy: boolean;
  /** The pedigree is being read again, to a different depth. */
  readonly reading: boolean;
  readonly error: string | undefined;
  readonly onGenerations: (generations: number) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { animal, plan, generations } = opened;
  const url = registrationUrl(animal.association, animal.regNumber);
  const generationsId = useId();
  const tests = animal.geneticTests ?? [];

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
    <Modal
      title={animal.name}
      description={[`${animal.association} ${animal.regNumber}`, lookOf(animal), yearOf(animal.dob)]
        .filter(Boolean)
        .join(" · ")}
      placement="side"
      onClose={onCancel}
      footer={
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={generationsId} className="text-sm text-ink">
              Bring with
            </label>
            <select
              id={generationsId}
              value={generations}
              disabled={busy || reading}
              onChange={(event) => onGenerations(Number(event.target.value))}
              className="min-h-target rounded-density border border-edge bg-panel px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action"
            >
              {Array.from({ length: MAX_CATALOGUE_GENERATIONS + 1 }, (_, count) => (
                <option key={count} value={count}>
                  {count === 0 ? "No ancestors" : `${count} generation${count === 1 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm} disabled={busy || reading}>
              {busy ? "Bringing across…" : `Bring ${newRecords} across to Ancestors`}
            </Button>
          </div>
        </div>
      }
    >
      {error === undefined ? null : (
        <Callout tone="danger" title="That did not work">
          {error}
        </Callout>
      )}

      <div className="flex flex-wrap gap-2">
        {tests.length === 0 ? (
          <Pill tone="neutral">No tests on file</Pill>
        ) : (
          tests.map((test) => (
            <Pill
              key={test.defect}
              tone={carries(test.status) ? "danger" : isKnownFree(test.status) ? "calm" : "neutral"}
              title={DEFECT_NAMES[test.defect]}
            >
              {test.defect} {STATUS_LABELS[test.status].toLowerCase()}
            </Pill>
          ))
        )}
      </div>

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

      <div className="flex flex-col">
        <div className="flex items-baseline justify-between gap-3 pb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Pedigree</h3>
          <span role="status" className="text-sm text-muted">
            {reading
              ? "Reading…"
              : `${plan.rows.length} animal${plan.rows.length === 1 ? "" : "s"}, ${plan.known} on file`}
          </span>
        </div>
        <ul className="flex flex-col">
          {plan.rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-rule py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted">{row.position ?? "the animal itself"}</span>
                <span className="truncate font-medium text-ink">{row.animal.name}</span>
                <span className="text-sm text-muted">
                  {row.animal.association} {row.animal.regNumber}
                </span>
              </span>

              {row.match === undefined ? (
                <Pill tone="action">New</Pill>
              ) : row.match.confidence === "certain" ? (
                <Pill tone="calm">Already on file</Pill>
              ) : (
                <label className="flex min-h-target items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={merging.has(row.key)}
                    onChange={() => toggle(row.key)}
                  />
                  <span>{row.match.reason}</span>
                </label>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
