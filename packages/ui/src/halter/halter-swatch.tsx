/**
 * The halter colour (spec §8).
 *
 * A show calf's halter is how it is identified across a barn without reading a
 * tag — "the one in the red halter" is the sentence people actually say. It
 * appears on Pen Board chips, roster rows, stall cards, and profile headers, so
 * the swatch has to be recognisable at chip size and still say what it is.
 *
 * The name always travels with the colour. Two calves in navy and black are
 * indistinguishable in a dark barn at chip size, and the default is black,
 * which on the admin theme is nearly the panel behind it — hence the ring.
 */

export type HalterSwatchSize = "chip" | "default" | "kiosk";

export interface HalterSwatchProps {
  /** Any CSS colour. Defaults to black, which is what an unlabelled calf wears. */
  readonly color?: string;
  /** What to call it — "Red", "Navy", "Hot pink". Shown to screen readers always. */
  readonly name?: string;
  readonly showName?: boolean;
  readonly size?: HalterSwatchSize;
  readonly className?: string;
}

export const DEFAULT_HALTER_COLOR = "#101010";
export const DEFAULT_HALTER_NAME = "Black";

/** The colours a show string is usually bought in, for pickers and seeds. */
export const HALTER_COLORS = [
  { name: "Black", color: "#101010" },
  { name: "Red", color: "#C62828" },
  { name: "Royal blue", color: "#1E5AA8" },
  { name: "Navy", color: "#1B2A4A" },
  { name: "Kelly green", color: "#1E7A3C" },
  { name: "Purple", color: "#6A3FA0" },
  { name: "Hot pink", color: "#D6337F" },
  { name: "Orange", color: "#E4671B" },
  { name: "Turquoise", color: "#1F9BA5" },
  { name: "White", color: "#F2F2F2" },
] as const;

const SIZES: Record<HalterSwatchSize, { readonly box: string; readonly text: string }> = {
  chip: { box: "14px", text: "12px" },
  default: { box: "20px", text: "15px" },
  kiosk: { box: "32px", text: "20px" },
};

export function HalterSwatch({
  color = DEFAULT_HALTER_COLOR,
  name = DEFAULT_HALTER_NAME,
  showName = false,
  size = "default",
  className,
}: HalterSwatchProps) {
  const { box, text } = SIZES[size];

  return (
    <span
      className={className}
      data-halter={name}
      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: box,
          height: box,
          borderRadius: "999px",
          backgroundColor: color,
          // Black on midnight and white on linen both vanish into the panel
          // without this. The ring is the theme's border token, so it is a
          // measured 3:1 against either surface rather than a guess.
          boxShadow: "inset 0 0 0 1px var(--gf-border, #7f8b96)",
          flexShrink: 0,
        }}
      />
      {showName ? (
        <span aria-hidden="true" style={{ fontSize: text }}>
          {name}
        </span>
      ) : null}
      <span
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {`${name} halter`}
      </span>
    </span>
  );
}
