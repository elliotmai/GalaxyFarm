import type { ReactNode } from "react";

/**
 * A descent chart drawn the way registry papers draw one (spec §8 v0.9).
 *
 * This replaces the constellation, which drew the same data as stars on a
 * field. That chart was designed for Midnight Nebula and said so; on the
 * Flying Double M ground three separate things went wrong at once. Its halo
 * became the "smudge on cream" its own docstring predicted. Its claim to draw
 * unknown ancestors as unnamed stars was never true — the layout reserved the
 * slot and drew nothing in it, so an incomplete pedigree was a large blank
 * area rather than a set of stated gaps. And a repeated ancestor was marked by
 * switching to the identity colour, which in this palette is the same navy as
 * the action colour, so line breeding — the one thing the chart existed to
 * make visible — became undetectable.
 *
 * So: a bracket, in the shape breeders already read on an association
 * certificate. Every slot is drawn, including the empty ones, because "dam
 * unknown" is a fact about the animal and belongs on the page. A repeat is
 * marked with a word, not a hue, so it survives any palette and reaches
 * anybody who does not separate navy from navy.
 *
 * Deliberately generic. This package may only depend on the kernel (§4.1), so
 * it knows nothing about cattle, registrations, or associations — a caller
 * flattens whatever it has into `Ancestor` and gets a chart back. That is what
 * lets the same component draw a horse's pedigree.
 */

export interface Ancestor {
  readonly id: string;
  readonly label: string;
  /** A registration number, a year — whatever reads under the name. */
  readonly sublabel?: string | undefined;
  /** Set for an animal that is not one of ours. Drawn as a quieter cell. */
  readonly outside?: boolean | undefined;
  /** Appears more than once in this tree — line breeding, or a typo. */
  readonly repeated?: boolean | undefined;
  readonly sire?: Ancestor | undefined;
  readonly dam?: Ancestor | undefined;
}

/**
 * One cell of the bracket.
 *
 * `row` and `span` are grid lines, not pixels: generation g holds 2^g cells,
 * and each spans 2^(generations - g) rows of the same fixed grid. That is what
 * makes a sire's cell sit centred against the pair above it without any
 * measurement, at any depth, and what keeps the columns aligned when a whole
 * branch is missing.
 */
interface Slot {
  readonly key: string;
  readonly ancestor: Ancestor | undefined;
  readonly generation: number;
  readonly row: number;
  readonly span: number;
  /** "Sire" / "Dam" for the unknown cells, so a gap still says what is missing. */
  readonly role: string;
}

function collect(
  ancestor: Ancestor | undefined,
  generation: number,
  row: number,
  span: number,
  generations: number,
  role: string,
  key: string,
  out: Slot[],
): void {
  if (generation > generations) return;

  out.push({ key, ancestor, generation, row, span, role });

  if (generation === generations) return;
  const half = span / 2;
  collect(ancestor?.sire, generation + 1, row, half, generations, "Sire", `${key}s`, out);
  collect(ancestor?.dam, generation + 1, row + half, half, generations, "Dam", `${key}d`, out);
}

export interface PedigreeChartProps {
  readonly root: Ancestor;
  /** Generations above the subject. 3, 4 or 5 in practice. */
  readonly generations: number;
  /** Called when an ancestor is chosen — drill-down (§5.2). */
  readonly onSelect?: (ancestor: Ancestor) => void;
  readonly caption?: ReactNode;
}

/**
 * Row height, in rem.
 *
 * A cell has to hold a name and a registration number, which is two lines at
 * the smallest size either is still readable at. Five generations is 32 rows,
 * so the chart is tall by construction and the container scrolls rather than
 * shrinking the type — the alternative is a certificate nobody can read.
 */
const ROW = 2.75;

export function PedigreeChart({ root, generations, onSelect, caption }: PedigreeChartProps) {
  const slots: Slot[] = [];
  const rows = 2 ** generations;
  collect(root, 0, 0, rows, generations, "Subject", "r", slots);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="gf-print-open max-h-[70vh] overflow-auto rounded-density border border-edge bg-panel p-density">
        <div
          className="grid justify-start gap-x-3 gap-y-1"
          style={{
            // Capped rather than `1fr`. A generation is only ever as wide as a
            // registered name needs; letting the columns divide a wide screen
            // pushes a sire half a monitor away from its own son, and the
            // reader has to measure to see which pair goes with which.
            gridTemplateColumns: `repeat(${generations + 1}, minmax(11rem, 15rem))`,
            gridTemplateRows: `repeat(${rows}, ${ROW}rem)`,
            // Five generations is wider than a phone. It scrolls; it does not
            // reflow, because a bracket that reflows is no longer a bracket.
            minWidth: `${(generations + 1) * 11}rem`,
          }}
        >
          {slots.map((slot) => (
            <Cell key={slot.key} slot={slot} {...(onSelect === undefined ? {} : { onSelect })} />
          ))}
        </div>
      </div>
      {caption === undefined ? null : (
        <figcaption className="text-sm text-muted">{caption}</figcaption>
      )}
    </figure>
  );
}

function Cell({
  slot,
  onSelect,
}: {
  readonly slot: Slot;
  readonly onSelect?: (ancestor: Ancestor) => void;
}) {
  const { ancestor, row, span, role } = slot;

  const style = {
    gridColumn: slot.generation + 1,
    gridRow: `${row + 1} / span ${span}`,
  };

  /*
   * The gap, stated but not shouted.
   *
   * Stated, because blank space is ambiguous between "nobody has entered it"
   * and "there is nothing to enter", and only one of those is a job for
   * somebody. Not shouted, because five generations of a real pedigree is
   * mostly gaps — twenty-one of thirty-one slots on a typical one — and giving
   * each an edge of its own buries the ten facts under the twenty-one
   * absences.
   *
   * So no border: a filled cell has a shape, an empty one only has a label.
   * That also keeps "unknown" from looking like "outside", which is the other
   * thing drawn with a dashed edge and means something quite different.
   */
  if (ancestor === undefined) {
    return (
      <div className="flex items-center" style={style}>
        <p className="m-0 px-2 text-xs text-muted opacity-70">{role} unknown</p>
      </div>
    );
  }

  const interactive = onSelect !== undefined;
  const Tag = interactive ? "button" : "div";

  return (
    <div className="flex items-center" style={style}>
      <Tag
        {...(interactive ? { type: "button" as const, onClick: () => onSelect(ancestor) } : {})}
        className={`w-full rounded-density px-2 py-1 text-left ${
          // Ours sit on a raised ground with a full-strength left edge; an
          // outside animal gets the same shape, unfilled. The difference is a
          // border, not a colour, so it reads in print and in monochrome.
          ancestor.outside === true
            ? "border border-dashed border-edge"
            : "border-l-2 border-action bg-raised"
        } ${interactive ? "hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action" : ""}`}
      >
        <span className="block truncate text-density font-medium text-ink">{ancestor.label}</span>
        <span className="flex items-baseline gap-2">
          {ancestor.sublabel === undefined ? null : (
            <span className="truncate font-mono text-xs text-muted">{ancestor.sublabel}</span>
          )}
          {ancestor.repeated === true ? (
            // A word, not a hue: `identity` and `action` are the same navy in
            // this palette, and colour alone would not carry it anyway.
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-identity">
              Repeat
            </span>
          ) : null}
        </span>
      </Tag>
    </div>
  );
}
