import type { HTMLAttributes, ReactNode } from "react";

/**
 * The pieces that make a screen read as designed rather than as a form (§8).
 *
 * §8 asks for "generous whitespace; no template feel", and the honest reading
 * of that is not more padding — a plain box with more padding is a plainer
 * box. What makes an interface feel considered is that different *kinds* of
 * information look different: a count does not look like a status, a status
 * does not look like a name, and a thing that is 84% of the way through looks
 * like a thing that is 84% of the way through.
 *
 * Everything here takes its colour from the surface's tokens. Nothing names a
 * theme, so all of it is right on the barn kiosk and the customer portal.
 */

export type Tone = "neutral" | "action" | "calm" | "danger" | "identity";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  action: "text-action",
  calm: "text-calm",
  danger: "text-danger",
  identity: "text-identity",
};

const TONE_FILL: Record<Tone, string> = {
  neutral: "bg-edge/20 text-ink",
  action: "bg-action/15 text-action",
  calm: "bg-calm/15 text-calm",
  danger: "bg-danger/15 text-danger",
  identity: "bg-identity/15 text-identity",
};

const TONE_EDGE: Record<Tone, string> = {
  neutral: "before:bg-edge",
  action: "before:bg-action",
  calm: "before:bg-calm",
  danger: "before:bg-danger",
  identity: "before:bg-identity",
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
  /** A filled dot before the label — for a live state rather than a label. */
  readonly dot?: boolean;
  readonly children: ReactNode;
}

/**
 * A filled chip, as distinct from `Badge`, which is outlined.
 *
 * The two are not interchangeable and the difference carries meaning: an
 * outlined badge is a *label* on something ("Papered", "8 zones"), and a
 * filled pill is a *state* it is currently in ("Calving window", "3 not
 * sent"). Somebody scanning a screen should be able to tell those apart
 * without reading either.
 */
export function Pill({ tone = "neutral", dot = false, children, className, ...rest }: PillProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium",
        TONE_FILL[tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export interface MeterProps {
  /** 0 to 1. Clamped, because a projection can run past its own end. */
  readonly value: number;
  readonly tone?: Tone;
  readonly label?: string;
  /** Right-aligned above the bar — "day 279 of 283". */
  readonly detail?: ReactNode;
  /** A mark on the track: where the calving window opens, say. */
  readonly marker?: number;
}

/**
 * How far through something is.
 *
 * A gestation, a withdrawal period, a feed bag. All of these are currently
 * reported as two dates and a subtraction somebody does in their head, and a
 * bar is the one presentation where "nearly there" is legible without reading
 * anything at all.
 *
 * Clamped rather than allowed to overflow: a cow at day 290 of a 283-day
 * projection is real and common, and a bar drawn at 103% would break its own
 * container. The number beside it still says 290.
 */
export function Meter({ value, tone = "action", label, detail, marker }: MeterProps) {
  const percent = Math.max(0, Math.min(1, value)) * 100;

  return (
    <div className="flex flex-col gap-1">
      {label === undefined && detail === undefined ? null : (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {label === undefined ? <span /> : <span className="text-muted">{label}</span>}
          {detail === undefined ? null : (
            <span className="[font-variant-numeric:tabular-nums] text-ink">{detail}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(label === undefined ? {} : { "aria-label": label })}
        className="relative h-2 w-full overflow-hidden rounded-full bg-edge/30"
      >
        <div
          className={[
            "h-full rounded-full transition-[width] duration-500",
            tone === "danger"
              ? "bg-danger"
              : tone === "calm"
                ? "bg-calm"
                : tone === "identity"
                  ? "bg-identity"
                  : tone === "neutral"
                    ? "bg-muted"
                    : "bg-action",
          ].join(" ")}
          style={{ width: `${percent}%` }}
        />
        {marker === undefined ? null : (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-ink/50"
            style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

export interface TileProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly tone?: Tone;
  /** Draws the eye when this number is the point of the screen. */
  readonly emphasis?: boolean;
  /** A pill in the corner — a delta, a state, a count of something inside. */
  readonly badge?: ReactNode;
}

/**
 * One number, with a coloured edge.
 *
 * The edge is a three-pixel bar rather than a border on all four sides. A row
 * of fully outlined boxes is the "template feel" §8 asks to avoid — the eye
 * reads the outlines as a grid and the numbers second. One accented edge
 * reads as an accent, and the number stays the loudest thing in it.
 */
export function Tile({ label, value, hint, tone = "neutral", emphasis = false, badge }: TileProps) {
  return (
    <div
      className={[
        "relative flex flex-col gap-1 overflow-hidden rounded-density border border-edge bg-raised px-density py-3",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        TONE_EDGE[tone],
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        {badge}
      </div>
      <span
        className={[
          "[font-variant-numeric:tabular-nums]",
          emphasis ? "font-heading text-3xl font-semibold" : "text-xl font-semibold",
          emphasis ? TONE_TEXT[tone] : "text-ink",
        ].join(" ")}
      >
        {value}
      </span>
      {hint === undefined ? null : <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export interface RecordCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** What this is: the animal's name, the zone, the dam. */
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Pills and badges, under the title. */
  readonly meta?: ReactNode;
  /** Buttons, opposite the title. */
  readonly actions?: ReactNode;
  readonly tone?: Tone;
  readonly children?: ReactNode;
  /** Wrapped in a link by the caller — adds the hover treatment. */
  readonly interactive?: boolean;
}

/**
 * One record, as a card rather than a row.
 *
 * A table is the right shape for comparing forty animals on one number. It is
 * the wrong shape for looking at six and needing three facts about each, which
 * is most of what these screens actually are — and it is the wrong shape on a
 * phone at any count.
 *
 * The accent edge carries the state, so a pen with a fresh cow in it is
 * findable by colour before anybody reads a word.
 */
export function RecordCard({
  title,
  subtitle,
  meta,
  actions,
  tone = "neutral",
  interactive = false,
  children,
  className,
  ...rest
}: RecordCardProps) {
  return (
    <div
      className={[
        "relative flex flex-col gap-3 overflow-hidden rounded-density border border-edge bg-panel p-density",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        TONE_EDGE[tone],
        interactive
          ? "transition-colors hover:border-action focus-within:border-action cursor-pointer"
          : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-density font-semibold text-ink">{title}</div>
          {subtitle === undefined ? null : <div className="text-sm text-muted">{subtitle}</div>}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {meta === undefined ? null : <div className="flex flex-wrap gap-1.5">{meta}</div>}
      {children}
    </div>
  );
}

/** A responsive rank of cards. One up on a phone, two or three on a laptop. */
export function CardGrid({
  children,
  columns = 2,
}: {
  readonly children: ReactNode;
  readonly columns?: 2 | 3;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-density ${
        columns === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2"
      }`}
    >
      {children}
    </div>
  );
}

export interface CalloutProps {
  readonly tone?: Tone;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}

/**
 * Something the reader must not scroll past.
 *
 * A `Badge` in a row of badges is a label among labels — it is exactly as
 * visible as the six beside it, which is the wrong amount of visible for a
 * withdrawal period. A callout is filled, full width, and sits above the
 * content it is about, so the only way to miss it is not to open the page.
 *
 * `role="status"` rather than `role="alert"`: this is a standing condition
 * found on arrival, not something that just happened, and an alert would
 * interrupt a screen reader mid-heading to say so.
 */
export function Callout({ tone = "danger", title, children, actions }: CalloutProps) {
  return (
    <div
      role="status"
      className={[
        "flex flex-wrap items-start justify-between gap-density rounded-density p-density",
        "border border-current/25",
        TONE_FILL[tone],
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-heading text-density font-semibold">{title}</p>
        {children === undefined ? null : <div className="text-sm opacity-90">{children}</div>}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
