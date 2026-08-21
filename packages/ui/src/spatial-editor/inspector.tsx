"use client";

import { rankOf, withArticle, type SpatialPalette } from "./palette.js";
import type { SpatialChip, SpatialDraft, SpatialInstruction, SpatialShape } from "./types.js";

/**
 * What tapping something says (issue #8: "tap for instructions").
 *
 * Below the canvas rather than floating over it: instructions are prose, they
 * are read rather than glanced at, and a popover covering the map is a popover
 * somebody dismisses before they have finished the sentence.
 */
export function Inspector({
  palette,
  draft,
  draftShape,
  chip,
  shape,
  occupants,
  movable,
  onClear,
}: {
  readonly palette: SpatialPalette;
  readonly draft: SpatialDraft | undefined;
  readonly draftShape: SpatialShape | undefined;
  readonly chip: SpatialChip | undefined;
  readonly shape: SpatialShape | undefined;
  readonly occupants: number;
  readonly movable: boolean;
  readonly onClear: () => void;
}) {
  if (draft !== undefined) {
    const corners = draft.boundary.length;
    return (
      <aside className="rounded-density border border-rule bg-panel p-density text-density text-ink">
        <p className="m-0">
          {`Drawing ${draftShape?.label ?? `this ${palette.shapeNoun.one}`}. `}
          {corners === 0
            ? "Click each corner. Three is the fewest that enclose any ground."
            : corners < 3
              ? `${corners} down — at least ${3 - corners} more.`
              : `${corners} corners. Drag one to move it, or keep clicking to add more.`}
        </p>
      </aside>
    );
  }

  if (chip !== undefined) {
    return (
      <aside className="rounded-density border border-rule bg-panel p-density text-density text-ink">
        <h3 className="m-0 text-density font-semibold">{chip.label}</h3>
        {chip.sublabel === undefined ? null : <p className="m-0 text-muted">{chip.sublabel}</p>}
        <RankLine palette={palette} rank={chip.rank} note={chip.rankNote} />
        <Instructions lines={chip.instructions} noun={palette.chipNoun.one} />
        {movable ? (
          <p className="m-0 text-muted">
            {`Choose ${withArticle(palette.shapeNoun.one)} to move ${chip.label} there, or drag the chip.`}
          </p>
        ) : null}
        <button type="button" className="mt-2 text-action underline" onClick={onClear}>
          Done
        </button>
      </aside>
    );
  }

  if (shape !== undefined) {
    return (
      <aside className="rounded-density border border-rule bg-panel p-density text-density text-ink">
        <h3 className="m-0 text-density font-semibold">{shape.label}</h3>
        {shape.sublabel === undefined ? null : <p className="m-0 text-muted">{shape.sublabel}</p>}
        <RankLine palette={palette} rank={shape.rank} note={undefined} />
        <p className="m-0 text-muted">
          {`${occupants} ${occupants === 1 ? palette.chipNoun.one : palette.chipNoun.many}`}
          {shape.resting === true ? ` · ${palette.restingLabel}` : ""}
        </p>
        <Instructions lines={shape.instructions} noun={palette.shapeNoun.one} />
        <button type="button" className="mt-2 text-action underline" onClick={onClear}>
          Done
        </button>
      </aside>
    );
  }

  return (
    <p className="m-0 text-density text-muted">
      {`Tap ${withArticle(palette.shapeNoun.one)} or ${withArticle(palette.chipNoun.one)} for its instructions.`}
    </p>
  );
}

/**
 * Where this sits on the scale, as a number and a word beside the colour.
 *
 * The colour is on the map and the map is glanced at; this is the panel
 * somebody reads when they have stopped to ask. §5.1 is firm that the number
 * travels with the colour everywhere, and this is one of the everywheres: a
 * swatch on its own is nothing to a colour-blind reader and nothing to anybody
 * at dusk.
 */
function RankLine({
  palette,
  rank,
  note,
}: {
  readonly palette: SpatialPalette;
  readonly rank: number | undefined;
  readonly note: string | undefined;
}) {
  const step = rankOf(palette, rank);
  if (step === undefined) return null;

  return (
    <p className="m-0 flex flex-wrap items-center gap-1">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: step.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)" }}
      />
      <span>{`${palette.rankTitle} ${step.label}`}</span>
      {note === undefined ? null : <span className="text-muted">{`— ${note}`}</span>}
    </p>
  );
}

/**
 * The merged instructions, each line still saying where it came from.
 *
 * A description list rather than paragraphs, because that is what this is: a
 * source, and what that source has to say. The alternative — one blob of prose
 * with the sources spliced into the sentences — is the three-panels problem
 * the merge exists to end, moved one level down.
 */
function Instructions({
  lines,
  noun,
}: {
  readonly lines: readonly SpatialInstruction[] | undefined;
  readonly noun: string;
}) {
  if (lines === undefined || lines.length === 0) {
    return <p className="m-0 text-muted">{`No instructions recorded for this ${noun}.`}</p>;
  }

  return (
    <dl className="m-0 mt-1 flex flex-col gap-1">
      {lines.map((line, index) => (
        // Keyed by source and position rather than by source alone: one pen
        // and one of its occupants can share a name, and either can
        // legitimately have two things to say.
        <div key={`${line.from}:${index}`}>
          <dt className="text-muted">{line.from}</dt>
          <dd className="m-0 whitespace-pre-line">{line.text}</dd>
        </div>
      ))}
    </dl>
  );
}
