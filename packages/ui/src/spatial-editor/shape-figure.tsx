"use client";

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { rankOf, type SpatialPalette } from "./palette.js";
import { centroid, lineData, pathData, project, type Viewport } from "./geometry.js";
import type { SpatialChip, SpatialDraft, SpatialShape } from "./types.js";

/**
 * The ground, and the boundary being drawn over it.
 *
 * Two figures rather than one because they answer to different things: a shape
 * is a record, drawn from what is stored, and a draft is a gesture in
 * progress, drawn from what the caller is holding. Keeping the draft on top
 * and in white is what makes a half-traced pen legible over a pen that is
 * already there in the colour of its safety level.
 */

export function ShapeFigure({
  shape,
  palette,
  view,
  hatchId,
  selected,
  interactive,
  moving,
  onChoose,
}: {
  readonly shape: SpatialShape;
  readonly palette: SpatialPalette;
  readonly view: Viewport;
  readonly hatchId: string;
  readonly selected: boolean;
  /** False while a boundary is being traced — then a click is a new corner. */
  readonly interactive: boolean;
  readonly moving: SpatialChip | undefined;
  readonly onChoose: (shape: SpatialShape) => void;
}) {
  const ring = shape.boundary ?? [];
  if (ring.length < 3) return null;

  const step = rankOf(palette, shape.rank);
  const colour = step?.color ?? "#FFFFFF";
  const dimmed = shape.resting === true || shape.inactive === true;
  const middle = centroid(ring);

  // Over a photograph the fill stays faint whatever the rank, because the
  // photograph is what somebody is tracing against; on a blank plan the fill
  // is most of what there is to see.
  const fillOpacity = palette.ground === "aerial" ? (dimmed ? 0.05 : 0.15) : dimmed ? 0.12 : 0.35;

  const canDrop = moving !== undefined && shape.acceptsChips !== false && shape.inactive !== true;
  const description = canDrop
    ? `Move ${moving.label} to ${shape.label}`
    : `${shape.label}${step === undefined ? "" : `, ${palette.rankTitle} ${step.label}`}${
        shape.resting === true ? `, ${palette.restingLabel.toLowerCase()}` : ""
      }`;

  return (
    <g
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": description,
            "aria-pressed": selected,
            onClick: () => onChoose(shape),
            onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onChoose(shape);
            },
          }
        : { "aria-hidden": true, pointerEvents: "none" as const })}
      style={{ cursor: interactive ? "pointer" : "crosshair", color: colour }}
    >
      <path
        d={pathData(ring, view)}
        fill={colour}
        fillOpacity={fillOpacity}
        stroke={colour}
        strokeOpacity={dimmed ? 0.45 : 0.95}
        strokeWidth={selected ? 5 : dimmed ? 2 : 3}
        strokeLinejoin="round"
      />
      {shape.resting === true ? (
        // Hatching as well as dimming. Dimming alone is a difference in
        // degree, and a pasture being rested is a difference in kind — it is
        // the state a confirmation challenges somebody for moving stock into.
        <path d={pathData(ring, view)} fill={`url(#${hatchId})`} fillOpacity={0.3} stroke="none" />
      ) : null}

      {(shape.lines ?? []).map((line) => (
        <path
          key={line.id}
          d={lineData(line.points, view)}
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity={line.dashed === true ? 0.7 : 1}
          strokeWidth={line.dashed === true ? 2 : 3}
          strokeDasharray={line.dashed === true ? "6 6" : undefined}
        />
      ))}

      {middle === undefined ? null : (
        <text
          x={project(middle, view).x}
          y={project(middle, view).y}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="#FFFFFF"
          // The name sits over a photograph that is light in places and dark
          // in others; an outline is what keeps it readable over both.
          stroke="rgba(0,0,0,0.65)"
          strokeWidth={3}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {shape.label}
        </text>
      )}
    </g>
  );
}

export function DraftFigure({
  draft,
  view,
  onVertexPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  readonly draft: SpatialDraft;
  readonly view: Viewport;
  readonly onVertexPointerDown: (event: ReactPointerEvent<SVGCircleElement>, index: number) => void;
  readonly onPointerMove: (event: ReactPointerEvent<Element>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<Element>) => void;
}) {
  return (
    <g>
      {draft.boundary.length >= 2 ? (
        <path
          d={
            draft.boundary.length >= 3
              ? pathData(draft.boundary, view)
              : lineData(draft.boundary, view)
          }
          fill="#FFFFFF"
          fillOpacity={draft.boundary.length >= 3 ? 0.2 : 0}
          stroke="#FFFFFF"
          strokeWidth={3}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      ) : null}

      {draft.boundary.map((point, index) => {
        const at = project(point, view);
        return (
          <circle
            key={`${at.x},${at.y},${index}`}
            cx={at.x}
            cy={at.y}
            r={7}
            fill="#FFFFFF"
            stroke="#14171B"
            strokeWidth={2}
            style={{ cursor: "move" }}
            onPointerDown={(event) => onVertexPointerDown(event, index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        );
      })}
    </g>
  );
}
