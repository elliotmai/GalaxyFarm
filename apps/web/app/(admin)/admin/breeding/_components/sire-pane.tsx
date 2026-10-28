"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Pill, TextInput } from "@galaxy-farm/ui";
import {
  reviveRegistryAnimal,
  type ExternalAnimal,
  type RegistryAnimal,
} from "@galaxy-farm/module-cattle";

import {
  CHIP,
  chipState,
  Pane,
  PICK_LIST,
  PickRow,
} from "@/app/(admin)/admin/breeding/_components/pane";
import { onFileMatch, sireFlag } from "@/app/(admin)/admin/breeding/_components/workspace-logic";

import { sireValue } from "@/lib/sires";

/**
 * Step two: pick a sire.
 *
 * The straws already in the tank lead, because a bull you own semen from is
 * the cheapest decision there is. The bulls on file — ours, and the ancestors
 * brought across from the papers — sit a chip away, and the catalog search is
 * the same `/api/registry/search` the catalog screen asks.
 *
 * A catalog bull is pickable only once he is on file. Relatedness and colour
 * are walked off the pedigree, and a bull with no pedigree here would produce
 * a confident "no shared ancestors" that only means nobody looked — so a
 * result not yet brought across links to the catalog to do that, the one
 * write path for it, rather than growing a second one here.
 */

export interface SireOption {
  /** `straw:…`, `bull:…` or `external:…` — the shared sire-picker encoding. */
  readonly key: string;
  readonly name: string;
  readonly line: string;
  readonly chip?: ReturnType<typeof sireFlag>;
}

type View = "tank" | "file" | "catalog";

interface Found {
  readonly found: readonly RegistryAnimal[];
  readonly total: number;
}

export function SirePane({
  cowName,
  tank,
  onFile,
  outsiders,
  selected,
  onPick,
}: {
  readonly cowName: string | undefined;
  readonly tank: readonly SireOption[];
  readonly onFile: readonly SireOption[];
  readonly outsiders: readonly ExternalAnimal[];
  readonly selected: string | undefined;
  readonly onPick: (key: string) => void;
}) {
  const [view, setView] = useState<View>("tank");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Found | undefined>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim() === "") return;
    setSearching(true);
    setError(undefined);
    try {
      // Bulls only, at the source: a cow in a sire list is how a cow ends up
      // in a sire slot.
      const query = new URLSearchParams({ text: text.trim(), sex: "male", limit: "25" });
      const response = await fetch(`/api/registry/search?${query.toString()}`);
      const body = (await response.json()) as Found & { error?: string };
      // The route's own words: a 503 names which catalog settings are missing.
      if (!response.ok) throw new Error(body.error ?? "That search did not work.");
      setResult({ ...body, found: body.found.map(reviveRegistryAnimal) });
    } catch (caught) {
      setResult(undefined);
      setError(caught instanceof Error ? caught.message : "That search did not work.");
    } finally {
      setSearching(false);
    }
  }

  const views: readonly { id: View; label: string }[] = [
    { id: "tank", label: "In the tank" },
    { id: "file", label: "On file" },
    { id: "catalog", label: "Catalog search" },
  ];

  const list = (options: readonly SireOption[], empty: string) =>
    options.length === 0 ? (
      <p className="px-4 py-3 text-sm text-muted">{empty}</p>
    ) : (
      <ul className={PICK_LIST}>
        {options.map((option) => (
          <PickRow
            key={option.key}
            title={option.name}
            line={option.line}
            chip={option.chip}
            selected={selected === option.key}
            onPick={() => onPick(option.key)}
          />
        ))}
      </ul>
    );

  return (
    <Pane
      label="Pick a sire"
      title={cowName === undefined ? "2 · Pick a sire" : `2 · Pick a sire for ${cowName}`}
      line="Straws you own first; search the catalog for more"
    >
      <div role="group" aria-label="Where to look" className="flex flex-wrap gap-2 px-4 py-3">
        {views.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={view === entry.id}
            onClick={() => setView(entry.id)}
            className={`${CHIP} ${chipState(view === entry.id)}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {view === "tank" ? (
        <>
          {list(tank, "No straws in the tank yet.")}
          <p className="border-t border-rule px-4 py-3 text-sm">
            <Link href="/admin/cattle/supplies" className="text-action underline">
              Semen tank
            </Link>
          </p>
        </>
      ) : view === "file" ? (
        list(onFile, "No bulls here or on the papers yet.")
      ) : (
        <div className="flex flex-col">
          <form
            role="search"
            onSubmit={(event) => void search(event)}
            className="flex items-end gap-2 px-4 pb-3"
          >
            <span className="min-w-0 flex-1">
              <TextInput
                label="Name or registration"
                hideLabel
                placeholder="Name or registration"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </span>
            <Button type="submit" busy={searching}>
              Search
            </Button>
          </form>

          {error === undefined ? null : (
            <p role="alert" className="px-4 pb-3 text-sm text-danger">
              {error}
            </p>
          )}

          {result === undefined ? null : result.found.length === 0 ? (
            <p className="border-t border-rule px-4 py-3 text-sm text-muted">No bulls match.</p>
          ) : (
            <ul aria-label="Catalog results" className={`border-t border-rule ${PICK_LIST}`}>
              {result.found.map((animal) => {
                const match = onFileMatch(animal, outsiders);
                const line = [`${animal.association} ${animal.regNumber}`, animal.colour]
                  .filter(Boolean)
                  .join(" · ");
                if (match !== undefined) {
                  const key = sireValue("external", match.id);
                  return (
                    <PickRow
                      key={`${animal.association}:${animal.regNumber}`}
                      title={match.name}
                      line={line}
                      chip={
                        sireFlag(match.geneticTests ?? []) ?? { label: "On file", tone: "neutral" }
                      }
                      selected={selected === key}
                      onPick={() => onPick(key)}
                    />
                  );
                }
                return (
                  <li
                    key={`${animal.association}:${animal.regNumber}`}
                    className="flex min-h-[58px] items-center gap-3 border-t border-rule py-2 pl-4 pr-4 first:border-t-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-semibold text-ink">{animal.name}</span>
                      <span className="truncate text-sm text-muted">{line}</span>
                    </span>
                    {/* Brought across in the catalog, where the pedigree comes with him. */}
                    <Link
                      href={`/admin/cattle/catalog?text=${encodeURIComponent(animal.regNumber)}`}
                      className="inline-flex min-h-target shrink-0 items-center text-sm font-medium text-action underline"
                    >
                      Bring across
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {result === undefined || result.total <= result.found.length ? null : (
            <p className="border-t border-rule px-4 py-3 text-sm text-muted">
              <Pill tone="neutral">
                {result.found.length} of {result.total}
              </Pill>{" "}
              Narrow the search to see the rest.
            </p>
          )}
        </div>
      )}
    </Pane>
  );
}
