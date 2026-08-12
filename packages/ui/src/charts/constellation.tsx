import type { ReactNode } from "react";

/**
 * A descent chart drawn as a constellation (spec §8, issue #16).
 *
 * §8 names this one of the two signature visual elements, and the reason it
 * works is that a pedigree really is the shape of a star chart: fixed points,
 * lines of descent between them, and most of the sky empty. A conventional
 * bracket chart draws the empty part as blank paper. This draws it as unnamed
 * stars, so "we do not know who her third dam was" looks like something rather
 * than like nothing.
 *
 * Deliberately generic. This package may only depend on the kernel (§4.1), so
 * it knows nothing about cattle, registrations, or associations — a caller
 * flattens whatever it has into `ConstellationNode` and gets a chart back.
 * That is also what lets the same component draw a horse's pedigree later.
 *
 * Everything is drawn from theme tokens via `currentColor` and the token
 * classes, so it is right in Midnight Nebula, where it is at its best, and
 * still legible in Bluebonnet Linen on the customer portal, where a glow on
 * cream would just look like a smudge — hence the glow being a separate,
 * low-opacity halo that disappears against a light ground rather than a
 * hard-coded shadow.
 */

export interface ConstellationNode {
  readonly id: string;
  readonly label: string;
  /** A registration number, a year — whatever reads under the name. */
  readonly sublabel?: string | undefined;
  /** Set for a node that is not one of ours. Drawn hollow. */
  readonly outside?: boolean | undefined;
  /** Appears more than once in this tree — line breeding, or a typo. */
  readonly repeated?: boolean | undefined;
  readonly sire?: ConstellationNode | undefined;
  readonly dam?: ConstellationNode | undefined;
}

/**
 * Geometry.
 *
 * A generation is 156px wide and a slot is 30px tall, which are the smallest
 * numbers at which a name and a registration number are both still readable
 * rather than merely present. Fitting five generations into a phone's width
 * would need about 60px per generation, and the honest name for that is not
 * "responsive" — so the chart keeps its size and the container scrolls.
 */
const GENERATION_WIDTH = 156;
const SLOT_HEIGHT = 30;
const STAR_RADIUS = 4;

interface Placed {
  readonly node: ConstellationNode;
  readonly x: number;
  readonly y: number;
  readonly generation: number;
}

/**
 * Where every ancestor sits.
 *
 * The subject is at the left, each generation a column to its right, and a
 * node's vertical position is the centre of the band its half of the tree
 * occupies — the standard bracket layout, which is what makes a sire line
 * readable as the top edge of the chart.
 *
 * Missing parents still consume their slot. Collapsing them would slide the
 * known ancestors into the gaps and quietly redraw the tree as though the
 * papers were complete.
 */
function place(
  node: ConstellationNode | undefined,
  generation: number,
  top: number,
  height: number,
  maxGeneration: number,
  out: Placed[],
): void {
  if (node === undefined || generation > maxGeneration) return;

  out.push({
    node,
    generation,
    x: generation * GENERATION_WIDTH,
    y: top + height / 2,
  });

  if (generation === maxGeneration) return;
  place(node.sire, generation + 1, top, height / 2, maxGeneration, out);
  place(node.dam, generation + 1, top + height / 2, height / 2, maxGeneration, out);
}

export interface ConstellationProps {
  readonly root: ConstellationNode;
  /** Generations above the subject. 3, 4 or 5 in practice. */
  readonly generations: number;
  /** Called when a star is chosen — drill-down (§5.2). */
  readonly onSelect?: (node: ConstellationNode) => void;
  readonly caption?: ReactNode;
}

export function Constellation({ root, generations, onSelect, caption }: ConstellationProps) {
  const placed: Placed[] = [];
  const rows = 2 ** generations;
  const height = rows * SLOT_HEIGHT;
  place(root, 0, 0, height, generations, placed);

  const width = (generations + 1) * GENERATION_WIDTH;
  const byId = new Map(placed.map((entry) => [`${entry.generation}:${entry.node.id}`, entry]));

  /** One line per parent, drawn from the child so a missing parent draws none. */
  const lines = placed.flatMap((entry) =>
    [entry.node.sire, entry.node.dam]
      .filter((parent): parent is ConstellationNode => parent !== undefined)
      .map((parent) => byId.get(`${entry.generation + 1}:${parent.id}`))
      .filter((target): target is Placed => target !== undefined)
      .map((target) => ({ from: entry, to: target })),
  );

  return (
    <figure className="m-0 flex flex-col gap-2">
      {/*
        Scrolls rather than shrinks. Both axes: five generations is 32 slots
        tall, which is taller than a phone whatever the width.
      */}
      <div className="gf-print-open max-h-[70vh] overflow-auto rounded-density border border-edge bg-panel">
        <svg
          role="img"
          aria-label={`Pedigree of ${root.label}, ${generations} generations`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
        >
          <g className="text-edge">
            {lines.map(({ from, to }) => (
              <path
                key={`${from.node.id}-${to.node.id}-${to.generation}`}
                // An elbow rather than a diagonal: at 32 rows, diagonals cross
                // each other and the eye cannot follow a line to its end.
                d={`M ${from.x + STAR_RADIUS * 2} ${from.y} H ${to.x - 12} V ${to.y} H ${to.x}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                opacity={0.55}
              />
            ))}
          </g>

          {placed.map((entry) => (
            <Star
              key={`${entry.generation}:${entry.node.id}`}
              placed={entry}
              {...(onSelect === undefined ? {} : { onSelect })}
            />
          ))}
        </svg>
      </div>
      {caption === undefined ? null : (
        <figcaption className="text-sm text-muted">{caption}</figcaption>
      )}
    </figure>
  );
}

function Star({
  placed,
  onSelect,
}: {
  readonly placed: Placed;
  readonly onSelect?: (node: ConstellationNode) => void;
}) {
  const { node, x, y } = placed;
  // Ours are filled, outside animals hollow, and a repeat is marked in the
  // identity colour — line breeding is a fact about the animal, not a fault,
  // so it is highlighted rather than warned about.
  const tone = node.repeated ? "text-identity" : node.outside ? "text-muted" : "text-action";
  const interactive = onSelect !== undefined;

  return (
    <g
      className={tone}
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            style: { cursor: "pointer" },
            onClick: () => onSelect(node),
            onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(node);
              }
            },
          }
        : {})}
    >
      {/* The halo. Invisible on a light ground, which is the point. */}
      <circle cx={x} cy={y} r={STAR_RADIUS * 2.5} fill="currentColor" opacity={0.14} />
      <circle
        cx={x}
        cy={y}
        r={STAR_RADIUS}
        fill={node.outside === true ? "none" : "currentColor"}
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <text
        x={x + STAR_RADIUS * 2.5}
        y={y - 1}
        className="fill-ink"
        fontSize={11}
        dominantBaseline="middle"
      >
        {truncate(node.label, 18)}
      </text>
      {node.sublabel === undefined ? null : (
        <text
          x={x + STAR_RADIUS * 2.5}
          y={y + 10}
          className="fill-muted"
          fontSize={9}
          dominantBaseline="middle"
        >
          {truncate(node.sublabel, 20)}
        </text>
      )}
    </g>
  );
}

/** Cut on a character, with an ellipsis, so a long registered name still fits its slot. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
