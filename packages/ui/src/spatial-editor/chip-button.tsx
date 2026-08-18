"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { rankOf, type SpatialPalette } from "./palette.js";
import type { ScreenPoint } from "./geometry.js";
import type { SpatialChip } from "./types.js";

/**
 * A chip: one animal standing in a pen, one planting in a bed.
 *
 * A real `<button>` in a layer over the canvas rather than a shape inside it,
 * and that is the whole reason it is not drawn in the SVG with everything
 * else. A chip is the one thing on this screen somebody *does* something to —
 * taps it for instructions, moves it to another pen — and a button is what
 * carries a focus ring, a name, and an Enter key without any of it being
 * rebuilt. The drag is the addition; the button is the floor.
 */

/** A chip's box, in pixels. Wide enough for a name, small enough for a pen. */
export const CHIP_WIDTH = 96;
export const CHIP_HEIGHT = 26;
const CHIP_GAP = 4;

/**
 * Where one chip sits relative to its shape's middle.
 *
 * Below the label and wrapped into a block, so a pen holding eight animals
 * reads as a cluster over that pen rather than a column running off it. The
 * cluster is centred horizontally and hangs downwards, which keeps the shape's
 * name legible above it.
 */
export function chipPlacement(anchor: ScreenPoint, index: number, total: number): ScreenPoint {
  const columns = Math.ceil(Math.sqrt(total));
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: anchor.x + (column - (columns - 1) / 2) * (CHIP_WIDTH + CHIP_GAP),
    y: anchor.y + 14 + row * (CHIP_HEIGHT + CHIP_GAP),
  };
}

export function ChipButton({
  chip,
  palette,
  at,
  selected,
  draggable,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onChoose,
}: {
  readonly chip: SpatialChip;
  readonly palette: SpatialPalette;
  readonly at?: ScreenPoint | undefined;
  readonly selected: boolean;
  readonly draggable: boolean;
  readonly dragging: ScreenPoint | undefined;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, chipId: string) => void;
  readonly onPointerMove: (event: ReactPointerEvent<Element>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<Element>) => void;
  readonly onChoose: () => void;
}) {
  const step = rankOf(palette, chip.rank);
  const placed = dragging ?? at;

  const position: CSSProperties =
    placed === undefined
      ? {}
      : {
          position: "absolute",
          left: placed.x - CHIP_WIDTH / 2,
          top: placed.y - CHIP_HEIGHT / 2,
          width: CHIP_WIDTH,
          zIndex: dragging === undefined ? 1 : 2,
        };

  return (
    <button
      type="button"
      aria-label={`${chip.label}${chip.accentLabel === undefined ? "" : `, ${chip.accentLabel} halter`}${
        step === undefined ? "" : `, ${palette.rankTitle} ${step.label}`
      }`}
      aria-pressed={selected}
      onPointerDown={draggable ? (event) => onPointerDown(event, chip.id) : undefined}
      onPointerMove={draggable ? onPointerMove : undefined}
      onPointerUp={draggable ? onPointerUp : undefined}
      onClick={onChoose}
      className="flex items-center gap-1 overflow-hidden rounded-density border px-1 text-xs"
      style={{
        ...position,
        height: CHIP_HEIGHT,
        backgroundColor: step?.color ?? "#FFFFFF",
        color: step?.ink ?? "#14171B",
        borderColor: selected ? "#14171B" : "rgba(0,0,0,0.35)",
        borderWidth: selected ? 3 : 1,
        cursor: draggable ? "grab" : "pointer",
        touchAction: "none",
      }}
    >
      {chip.accent === undefined ? null : (
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: chip.accent,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)",
            flexShrink: 0,
          }}
        />
      )}
      <span className="truncate">{chip.label}</span>
    </button>
  );
}
