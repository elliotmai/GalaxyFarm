"use client";

import { useEffect, useState } from "react";

import { searchGardenCrops } from "@galaxy-farm/module-garden";

/**
 * Matches for whatever is typed into a plant name (spec §5.5).
 *
 * Sits under the field it serves rather than being a field of its own, so the
 * name box *is* the search: type "tomato", tap *Tomato · Solanum lycopersicum
 * · Solanaceae*, and the name, the scientific name and the family are filled
 * in. Ignoring the list and typing a name by hand is always fine — the family
 * is inferred from the name anyway.
 *
 * The built-in garden table answers on the first keystroke and offline. The
 * server's answer (`/api/plants/search`, which adds GBIF for everything the
 * table does not know) replaces it when it lands. If the server cannot be
 * reached, a quiet line says the list is the built-in one; nothing blocks.
 */

export interface PlantPick {
  readonly commonName: string;
  readonly scientificName: string;
  readonly family?: string | undefined;
  readonly source: "built-in" | "gbif";
}

/** Long enough to stop asking GBIF about every two-letter prefix. */
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

function localMatches(query: string): PlantPick[] {
  return searchGardenCrops(query, 6).map((crop) => ({
    commonName: crop.name,
    scientificName: crop.scientificName,
    family: crop.family,
    source: "built-in" as const,
  }));
}

export function PlantSuggestions({
  query,
  onPick,
  label = "Matching plants",
}: {
  readonly query: string;
  readonly onPick: (pick: PlantPick) => void;
  readonly label?: string;
}) {
  const trimmed = query.trim();
  const [remote, setRemote] = useState<{ q: string; results: PlantPick[] } | undefined>();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/plants/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as { results?: PlantPick[]; online?: boolean };
          setRemote({ q: trimmed, results: body.results ?? [] });
          setOffline(body.online === false);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // Offline, signed out mid-form, the route down: the built-in list
          // is still showing, and that is the whole fallback.
          console.warn("Plant search unavailable", error);
          setOffline(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  if (trimmed.length < MIN_QUERY) return null;

  // The server's answer for exactly this text, else the table's, now.
  const results = remote?.q === trimmed ? remote.results : localMatches(trimmed);

  return (
    <div className="flex flex-col gap-1">
      {results.length === 0 ? null : (
        <ul
          aria-label={label}
          className="flex max-h-60 flex-col overflow-y-auto rounded-density border border-rule bg-panel"
        >
          {results.map((match) => (
            <li key={`${match.source}-${match.commonName}-${match.scientificName}`}>
              <button
                type="button"
                onClick={() => onPick(match)}
                className="flex min-h-target w-full min-w-0 flex-col items-start px-3 py-1.5 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-action"
              >
                <span className="max-w-full truncate text-sm font-medium text-ink">
                  {match.commonName}
                </span>
                <span className="max-w-full truncate text-xs text-muted">
                  <i>{match.scientificName}</i>
                  {match.family === undefined ? null : ` · ${match.family}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {offline ? (
        <p className="m-0 text-xs text-muted">
          Plant search is offline — showing the built-in list. Typing the name by hand works.
        </p>
      ) : null}
    </div>
  );
}
