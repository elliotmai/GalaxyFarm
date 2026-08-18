"use client";

import { withArticle, type SpatialPalette } from "./palette.js";
import type { SpatialChip, SpatialDraft, SpatialShape } from "./types.js";

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
        {chip.instructions === undefined ? (
          <p className="m-0 text-muted">{`No instructions recorded for this ${palette.chipNoun.one}.`}</p>
        ) : (
          <p className="m-0">{chip.instructions}</p>
        )}
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
        <p className="m-0 text-muted">
          {`${occupants} ${occupants === 1 ? palette.chipNoun.one : palette.chipNoun.many}`}
          {shape.resting === true ? ` · ${palette.restingLabel}` : ""}
        </p>
        {shape.instructions === undefined ? (
          <p className="m-0 text-muted">{`No instructions recorded for this ${palette.shapeNoun.one}.`}</p>
        ) : (
          <p className="m-0">{shape.instructions}</p>
        )}
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
