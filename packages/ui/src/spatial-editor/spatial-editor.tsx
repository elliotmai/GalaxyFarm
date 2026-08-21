"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { GeoPoint } from "@galaxy-farm/core";

import { ChipButton, chipPlacement } from "./chip-button.js";
import { GeoImage } from "./geo-image.js";
import { Inspector } from "./inspector.js";
import { type SpatialPalette } from "./palette.js";
import { DraftFigure, ShapeFigure } from "./shape-figure.js";
import {
  boundsOf,
  centroid,
  clampZoom,
  DEFAULT_ZOOM,
  containsPoint,
  fitViewport,
  gridLines,
  panBy,
  project,
  snapToGrid,
  unproject,
  zoomTo,
  type ScreenPoint,
  type SpatialGrid,
  type SpatialView,
  type Viewport,
} from "./geometry.js";
import type {
  SpatialChip,
  SpatialDraft,
  SpatialImagery,
  SpatialReassignment,
  SpatialShape,
} from "./types.js";

/**
 * The spatial editor (spec §2, §8) — one component, two palettes.
 *
 * Draw and adjust rings of ground over a background, put chips in them, drag a
 * chip from one to another, tap either for its instructions. In property mode
 * that is pens over aerial imagery with animals standing in them; in garden
 * mode it is beds on a plan with plantings in them, and the difference between
 * the two is a `SpatialPalette` rather than a second component (§2).
 *
 * ## What is deliberately not here
 *
 * **Saving.** The editor reports a draft boundary as it changes and draws what
 * it is handed back. Whether that becomes a `Zone` record, a `Bed` record, or
 * nothing at all belongs to the screen that owns the records — as does the
 * §4.5 confirmation in front of anything destructive, which cannot be written
 * here because this package has no idea what depends on what.
 *
 * **The domain.** Nothing in this file knows what an animal is. A caller
 * flattens what it has into `SpatialShape` and `SpatialChip`, exactly as it
 * flattens a pedigree into `Ancestor` for the chart. The architecture test
 * (§4.1) fails the build if that ever stops being true, and a garden-mode test
 * asserts the same thing from the other end: the editor draws beds and
 * plantings without a line of it having been written for them.
 *
 * ## The background is a slot, not a dependency
 *
 * Two of them, because the two backgrounds are different kinds of thing.
 * `backdrop` is DOM under the canvas, handed the viewport — that is where the
 * Google satellite layer goes, live, never stored (§8). `imagery` is a
 * georeferenced raster drawn inside the canvas — that is the owned NAIP
 * snapshot the barn kiosk uses with no signal. Neither knows about the other,
 * and the shapes above them are identical in both cases because they are
 * stored in coordinates rather than pixels.
 */

/**
 * Take the pointer, if this environment has pointer capture.
 *
 * A drag that leaves the element it started on keeps working only while the
 * pointer is captured. Not every environment implements it — jsdom does not —
 * and the cost of its absence is a drag that stops at the edge of a chip, not
 * a wrong answer, so it is asked for rather than required.
 */
function capturePointer(target: Element, pointerId: number): void {
  if (typeof target.setPointerCapture === "function") target.setPointerCapture(pointerId);
}

/** How far a pointer may wander before a tap becomes a drag. */
const DRAG_THRESHOLD = 4;

export interface SpatialEditorProps {
  readonly palette: SpatialPalette;
  readonly shapes: readonly SpatialShape[];
  readonly chips?: readonly SpatialChip[];
  /** An owned georeferenced raster under the shapes — the offline path (§8). */
  readonly imagery?: SpatialImagery | undefined;
  /** Live DOM under the canvas, given the viewport to follow. */
  readonly backdrop?: ((view: Viewport) => ReactNode) | undefined;
  /** Snap corners to this grid. Absent means no grid and no toggle. */
  readonly grid?: SpatialGrid | undefined;
  /** Controlled view. Omitted, the editor opens on everything drawn. */
  readonly view?: SpatialView | undefined;
  /**
   * Where to open when nothing has been drawn yet.
   *
   * The first visit to a property whose address has been looked up but whose
   * pens have not been traced: there is a pin on the house and no extent to
   * fit. Without it the editor has nowhere to open and says so, which is
   * correct and unhelpful when a coordinate is sitting right there.
   */
  readonly fallbackCentre?: GeoPoint | undefined;
  readonly onViewChange?: ((view: SpatialView) => void) | undefined;
  /** The boundary being traced or adjusted, owned by the caller. */
  readonly draft?: SpatialDraft | undefined;
  readonly onDraftChange?: ((draft: SpatialDraft) => void) | undefined;
  readonly onSelectShape?: ((shapeId: string | undefined) => void) | undefined;
  readonly onSelectChip?: ((chipId: string | undefined) => void) | undefined;
  /** A chip moved to another shape. Absent means chips cannot be moved. */
  readonly onReassign?: ((move: SpatialReassignment) => void) | undefined;
  /** CSS height of the canvas. */
  readonly height?: string | undefined;
  readonly label?: string | undefined;
}

interface Gesture {
  readonly kind: "pan" | "vertex" | "chip";
  readonly pointerId: number;
  /** Where the pointer went down, so a tap can be told from a drag. */
  readonly origin: ScreenPoint;
  /** Updated as it moves — pan works on the delta since the last frame. */
  last: ScreenPoint;
  moved: boolean;
  readonly vertexIndex?: number;
  readonly chipId?: string;
}

type Selection = { readonly kind: "shape" | "chip"; readonly id: string } | undefined;

export function SpatialEditor({
  palette,
  shapes,
  chips = [],
  imagery,
  backdrop,
  grid,
  view,
  onViewChange,
  fallbackCentre,
  draft,
  onDraftChange,
  onSelectShape,
  onSelectChip,
  onReassign,
  height = "32rem",
  label,
}: SpatialEditorProps) {
  const uid = useId();
  const host = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  /**
   * A drag that ends on a chip still fires a click on it afterwards, and that
   * click would select the chip somebody had just finished moving. The flag is
   * cleared on the next press rather than after the click, because a drop onto
   * a shape ends nowhere near the button and fires no click at all.
   */
  const suppressClick = useRef(false);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [internalView, setInternalView] = useState<SpatialView | undefined>(undefined);
  const [selection, setSelection] = useState<Selection>(undefined);
  const [snap, setSnap] = useState(palette.snapByDefault);
  /** Where a chip being dragged is right now, so it follows the finger. */
  const [dragging, setDragging] = useState<{ chipId: string; at: ScreenPoint } | undefined>(
    undefined,
  );

  /**
   * The panel measures itself.
   *
   * A viewport needs a width and a height in pixels, and the only honest
   * source for those is the element — a caller passing its own would be
   * keeping a number in sync with a box it does not lay out, and the shapes
   * would sit half a panel away from the ground beneath them the first time a
   * sidebar opened.
   */
  useEffect(() => {
    const element = host.current;
    if (element === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  /** Everything with ground under it, which is what a fit has to cover. */
  const drawn = useMemo(() => shapes.flatMap((shape) => [...(shape.boundary ?? [])]), [shapes]);

  /**
   * What has been drawn wins over the fallback, because the fallback is a pin
   * on the house and the shapes are the reason anybody opened this screen.
   */
  const opening = useMemo<SpatialView | undefined>(() => {
    if (size.width === 0) return undefined;

    const bounds = boundsOf(drawn) ?? imagery?.bounds;
    if (bounds === undefined) {
      return fallbackCentre === undefined
        ? undefined
        : { centre: fallbackCentre, zoom: DEFAULT_ZOOM };
    }

    const fitted = fitViewport(bounds, size);
    return { centre: fitted.centre, zoom: fitted.zoom };
  }, [drawn, fallbackCentre, imagery, size]);

  // Only until somebody moves it. Where the view goes afterwards is theirs.
  useEffect(() => {
    setInternalView((current) => current ?? opening);
  }, [opening]);

  const current = view ?? internalView;
  const viewport: Viewport | undefined =
    current === undefined || size.width === 0
      ? undefined
      : { centre: current.centre, zoom: current.zoom, width: size.width, height: size.height };

  /**
   * Move the view.
   *
   * Takes a whole viewport because that is what the geometry returns, and
   * hands back only the centre and the zoom — the width and the height belong
   * to the panel, which measures itself, and a caller keeping a copy of them
   * in sync with a box it does not lay out is how the shapes end up half a
   * panel from the ground under them.
   */
  const setView = useCallback(
    (next: SpatialView) => {
      const trimmed: SpatialView = { centre: next.centre, zoom: next.zoom };
      if (view === undefined) setInternalView(trimmed);
      onViewChange?.(trimmed);
    },
    [onViewChange, view],
  );

  /** Pointer position inside the canvas, which is what every gesture works in. */
  const pointAt = useCallback((event: { clientX: number; clientY: number }): ScreenPoint => {
    const box = host.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }, []);

  /** A coordinate from a point in the panel, snapped if snapping is on. */
  const groundAt = useCallback(
    (at: ScreenPoint, frame: Viewport): GeoPoint => {
      const point = unproject(at, frame);
      return snap && grid !== undefined ? snapToGrid(point, grid) : point;
    },
    [grid, snap],
  );

  const select = useCallback(
    (next: Selection) => {
      setSelection(next);
      if (next?.kind === "chip") {
        onSelectChip?.(next.id);
      } else if (next?.kind === "shape") {
        onSelectShape?.(next.id);
      } else {
        onSelectChip?.(undefined);
        onSelectShape?.(undefined);
      }
    },
    [onSelectChip, onSelectShape],
  );

  const chooseChip = useCallback(
    (chipId: string) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      select({ kind: "chip", id: chipId });
    },
    [select],
  );

  const shapeById = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape])), [shapes]);

  /**
   * Where a chip dropped here belongs.
   *
   * Answered in coordinates rather than in pixels, so the pen a chip lands in
   * does not depend on how far the panel happened to be zoomed in. Later
   * shapes win: a pen drawn inside a pasture is the more specific answer, and
   * it is drawn on top for the same reason.
   */
  const shapeUnder = useCallback(
    (point: GeoPoint): SpatialShape | undefined => {
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        const shape = shapes[index] as SpatialShape;
        if (shape.inactive === true || shape.acceptsChips === false) continue;
        if (containsPoint(shape.boundary ?? [], point)) return shape;
      }
      return undefined;
    },
    [shapes],
  );

  /**
   * Is there any ground drawn under this point?
   *
   * Not the same question as `shapeUnder`, and deliberately a separate one: a
   * retired pen is not somewhere a chip may be dropped, but a tap on it is
   * still a tap on a shape rather than on bare ground.
   */
  const overShape = useCallback(
    (point: GeoPoint): boolean =>
      shapes.some((shape) => containsPoint(shape.boundary ?? [], point)),
    [shapes],
  );

  const reassign = useCallback(
    (chipId: string, toShapeId: string) => {
      const chip = chips.find((candidate) => candidate.id === chipId);
      if (chip === undefined || chip.shapeId === toShapeId) return;

      onReassign?.({
        chipId,
        ...(chip.shapeId === undefined ? {} : { fromShapeId: chip.shapeId }),
        toShapeId,
      });
      select(undefined);
    },
    [chips, onReassign, select],
  );

  /* ---------------------------------------------------------------- gestures */

  const onCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (viewport === undefined || event.button !== 0) return;
      const at = pointAt(event);
      gesture.current = {
        kind: "pan",
        pointerId: event.pointerId,
        origin: at,
        last: at,
        moved: false,
      };
      capturePointer(event.currentTarget, event.pointerId);
    },
    [pointAt, viewport],
  );

  const onVertexPointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, index: number) => {
      if (viewport === undefined) return;
      event.stopPropagation();
      const at = pointAt(event);
      gesture.current = {
        kind: "vertex",
        pointerId: event.pointerId,
        origin: at,
        last: at,
        moved: false,
        vertexIndex: index,
      };
      capturePointer(event.currentTarget, event.pointerId);
    },
    [pointAt, viewport],
  );

  const onChipPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, chipId: string) => {
      if (viewport === undefined || onReassign === undefined) return;
      suppressClick.current = false;
      const at = pointAt(event);
      gesture.current = {
        kind: "chip",
        pointerId: event.pointerId,
        origin: at,
        last: at,
        moved: false,
        chipId,
      };
      capturePointer(event.currentTarget, event.pointerId);
    },
    [onReassign, pointAt, viewport],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const active = gesture.current;
      if (active === undefined || viewport === undefined) return;
      if (active.pointerId !== event.pointerId) return;

      const at = pointAt(event);
      const travelled =
        Math.abs(at.x - active.origin.x) + Math.abs(at.y - active.origin.y) > DRAG_THRESHOLD;
      if (travelled) active.moved = true;

      if (active.kind === "pan") {
        if (!active.moved) return;
        setView(panBy(viewport, at.x - active.last.x, at.y - active.last.y));
      } else if (active.kind === "vertex" && draft !== undefined) {
        const next = [...draft.boundary];
        next[active.vertexIndex as number] = groundAt(at, viewport);
        onDraftChange?.({ shapeId: draft.shapeId, boundary: next });
      } else if (active.kind === "chip" && active.moved) {
        setDragging({ chipId: active.chipId as string, at });
      }

      active.last = at;
    },
    [draft, groundAt, onDraftChange, pointAt, setView, viewport],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const active = gesture.current;
      gesture.current = undefined;
      setDragging(undefined);
      if (active === undefined || viewport === undefined) return;
      if (active.pointerId !== event.pointerId) return;

      const at = pointAt(event);

      if (active.kind === "chip") {
        // A tap is left to the click handler, so the keyboard reaches the same
        // behaviour: a button activated by Enter fires a click and no pointer
        // events at all.
        if (!active.moved) return;
        suppressClick.current = true;

        const target = shapeUnder(unproject(at, viewport));
        if (target !== undefined) reassign(active.chipId as string, target.id);
        return;
      }

      if (active.kind === "pan" && !active.moved) {
        // A tap on bare ground. While a boundary is being traced that is a new
        // corner; otherwise it is somebody dismissing whatever was selected.
        if (draft !== undefined) {
          onDraftChange?.({
            shapeId: draft.shapeId,
            boundary: [...draft.boundary, groundAt(at, viewport)],
          });
        } else if (!overShape(unproject(at, viewport))) {
          // Bare ground, and only bare ground. A tap that landed on a shape
          // reaches that shape's own handler a moment later, and clearing the
          // selection here first would throw away the chip it was about to be
          // moved to — which is single-tap reassignment, the barn
          // touchscreen's whole interaction.
          select(undefined);
        }
      }
    },
    [draft, groundAt, onDraftChange, overShape, pointAt, reassign, select, shapeUnder, viewport],
  );

  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (viewport === undefined) return;
      // The page must not scroll as well. This is why the listener is
      // registered by hand below rather than as an `onWheel` prop: React
      // attaches wheel handlers passively, and a passive listener may not
      // call this — so the map would zoom and the page would run away under
      // it at the same time.
      event.preventDefault();

      // Whole zoom levels, not a continuous scale: Google's satellite layer is
      // raster tiles, and a fractional zoom under a vector overlay is a
      // resampled photograph with the fence lines soft.
      const step = event.deltaY < 0 ? 1 : -1;
      setView(zoomTo(viewport, clampZoom(viewport.zoom + step), pointAt(event)));
    },
    [pointAt, setView, viewport],
  );

  // Held in a ref so the listener is registered once and still sees the
  // current view; re-registering on every pan would be a listener churned
  // sixty times a second.
  const wheel = useRef(onWheel);
  wheel.current = onWheel;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    const handler = (event: WheelEvent) => wheel.current(event);
    element.addEventListener("wheel", handler, { passive: false });

    return () => element.removeEventListener("wheel", handler);
  }, []);

  const zoomBy = useCallback(
    (step: number) => {
      if (viewport === undefined) return;
      setView(zoomTo(viewport, clampZoom(viewport.zoom + step)));
    },
    [setView, viewport],
  );

  const fit = useCallback(() => {
    if (opening !== undefined) setView(opening);
  }, [opening, setView]);

  /* ----------------------------------------------------------------- drawing */

  const chipsByShape = useMemo(() => {
    const byShape = new Map<string, SpatialChip[]>();
    for (const chip of chips) {
      if (chip.shapeId === undefined) continue;
      const shape = shapeById.get(chip.shapeId);
      if (shape === undefined || (shape.boundary ?? []).length < 3) continue;
      byShape.set(chip.shapeId, [...(byShape.get(chip.shapeId) ?? []), chip]);
    }
    return byShape;
  }, [chips, shapeById]);

  /**
   * The chips with nowhere on the map to sit.
   *
   * Somewhere off the property, or in a zone nobody has traced yet. They go in
   * a tray under the canvas rather than being left off the screen, because an
   * animal missing from the map is indistinguishable from an animal missing.
   */
  const unplaced = useMemo(() => {
    const placed = new Set(
      Array.from(chipsByShape.values()).flatMap((inside) => inside.map((chip) => chip.id)),
    );
    return chips.filter((chip) => !placed.has(chip.id));
  }, [chips, chipsByShape]);

  const selectedChip =
    selection?.kind === "chip" ? chips.find((chip) => chip.id === selection.id) : undefined;
  const selectedShape = selection?.kind === "shape" ? shapeById.get(selection.id) : undefined;

  const lines =
    viewport === undefined || grid === undefined ? undefined : gridLines(viewport, grid);

  const onShapeChosen = useCallback(
    (shape: SpatialShape) => {
      // A chip is waiting to be moved — the keyboard and single-tap path
      // through the same reassignment the drag performs. This is what the
      // barn's touchscreen already does, and what a pointer drag can never be
      // for somebody working from the keyboard.
      if (selectedChip !== undefined && onReassign !== undefined && shape.acceptsChips !== false) {
        reassign(selectedChip.id, shape.id);
        return;
      }
      select({ kind: "shape", id: shape.id });
    },
    [onReassign, reassign, select, selectedChip],
  );

  return (
    <div className="flex flex-col gap-density">
      <div
        ref={host}
        className="relative overflow-hidden rounded-density border border-edge bg-raised"
        style={{ height, touchAction: "none" }}
      >
        {viewport === undefined || backdrop === undefined ? null : (
          <div className="absolute inset-0" aria-hidden="true">
            {backdrop(viewport)}
          </div>
        )}

        <svg
          className="absolute inset-0 h-full w-full"
          role="application"
          aria-label={label ?? `The ${palette.shapeNoun.many} on the ${palette.surfaceNoun}`}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: draft === undefined ? "grab" : "crosshair" }}
        >
          <defs>
            <pattern
              id={`${uid}-resting`}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="2" />
            </pattern>
          </defs>

          {viewport === undefined ? null : (
            <>
              {imagery === undefined ? null : <GeoImage imagery={imagery} view={viewport} />}

              {lines === undefined ? null : (
                <g className="text-muted" opacity={0.35} aria-hidden="true">
                  {lines.vertical.map((x) => (
                    <line
                      key={`v${x}`}
                      x1={x}
                      y1={0}
                      x2={x}
                      y2={viewport.height}
                      stroke="currentColor"
                      strokeWidth={1}
                    />
                  ))}
                  {lines.horizontal.map((y) => (
                    <line
                      key={`h${y}`}
                      x1={0}
                      y1={y}
                      x2={viewport.width}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth={1}
                    />
                  ))}
                </g>
              )}

              {shapes.map((shape) => (
                <ShapeFigure
                  key={shape.id}
                  shape={shape}
                  palette={palette}
                  view={viewport}
                  hatchId={`${uid}-resting`}
                  selected={selection?.kind === "shape" && selection.id === shape.id}
                  interactive={draft === undefined}
                  moving={selectedChip}
                  onChoose={onShapeChosen}
                />
              ))}

              {draft === undefined ? null : (
                <DraftFigure
                  draft={draft}
                  view={viewport}
                  onVertexPointerDown={onVertexPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              )}
            </>
          )}
        </svg>

        {viewport === undefined
          ? null
          : shapes.map((shape) => {
              const inside = chipsByShape.get(shape.id) ?? [];
              if (inside.length === 0) return null;
              const middle = centroid(shape.boundary ?? []);
              if (middle === undefined) return null;
              const anchor = project(middle, viewport);

              return inside.map((chip, index) => (
                <ChipButton
                  key={chip.id}
                  chip={chip}
                  palette={palette}
                  at={chipPlacement(anchor, index, inside.length)}
                  selected={selection?.kind === "chip" && selection.id === chip.id}
                  draggable={onReassign !== undefined}
                  dragging={dragging?.chipId === chip.id ? dragging.at : undefined}
                  onPointerDown={onChipPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onChoose={() => chooseChip(chip.id)}
                />
              ));
            })}

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <CanvasButton onClick={() => zoomBy(1)} label="Zoom in">
            +
          </CanvasButton>
          <CanvasButton onClick={() => zoomBy(-1)} label="Zoom out">
            −
          </CanvasButton>
          <CanvasButton onClick={fit} label={`Fit every ${palette.shapeNoun.one}`}>
            ⤢
          </CanvasButton>
          {grid === undefined ? null : (
            <CanvasButton
              onClick={() => setSnap((on) => !on)}
              label={snap ? "Turn grid snap off" : "Turn grid snap on"}
              pressed={snap}
            >
              #
            </CanvasButton>
          )}
        </div>

        {imagery?.attribution === undefined ? null : (
          <p className="absolute bottom-1 left-2 m-0 text-xs text-muted">{imagery.attribution}</p>
        )}

        {viewport === undefined ? (
          <p className="absolute inset-0 flex items-center justify-center text-density text-muted">
            {`Nothing is drawn yet, so there is nowhere to open the ${palette.surfaceNoun}.`}
          </p>
        ) : null}
      </div>

      {unplaced.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-density text-muted">{`Not on the ${palette.surfaceNoun} (${unplaced.length}):`}</span>
          {unplaced.map((chip) => (
            <ChipButton
              key={chip.id}
              chip={chip}
              palette={palette}
              selected={selection?.kind === "chip" && selection.id === chip.id}
              draggable={onReassign !== undefined}
              dragging={dragging?.chipId === chip.id ? dragging.at : undefined}
              onPointerDown={onChipPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onChoose={() => chooseChip(chip.id)}
            />
          ))}
        </div>
      )}

      <Inspector
        palette={palette}
        draft={draft}
        draftShape={draft === undefined ? undefined : shapeById.get(draft.shapeId)}
        chip={selectedChip}
        shape={selectedShape}
        occupants={
          selectedShape === undefined ? 0 : (chipsByShape.get(selectedShape.id) ?? []).length
        }
        movable={onReassign !== undefined}
        onClear={() => select(undefined)}
      />
    </div>
  );
}

function CanvasButton({
  onClick,
  label,
  pressed,
  children,
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly pressed?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-density border border-edge bg-panel text-ink"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
