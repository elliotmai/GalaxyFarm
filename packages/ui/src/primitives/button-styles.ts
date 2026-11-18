/**
 * The button's classes, kept apart from the components.
 *
 * `button.tsx` is a client module, and a server component cannot call a
 * function exported from one — Next hands it a client reference, not the
 * function. These are plain strings, so they live here, where a server page
 * (the landing, the offline page) can style a link as a button too.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BASE =
  "inline-flex items-center justify-center gap-2 min-h-target min-w-target " +
  "rounded-density px-4 font-medium text-density leading-none " +
  "transition-colors cursor-pointer select-none " +
  // Focus has to survive on both themes and on top of a filled button, so it
  // is an offset ring rather than an outline that would sit on the fill.
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action text-action-ink hover:opacity-90",
  secondary: "bg-panel text-ink border border-edge hover:bg-canvas",
  // `raised`, not `panel`: a ghost button mostly sits on a panel, where a
  // panel-coloured hover is no hover at all.
  ghost: "bg-transparent text-ink hover:bg-raised",
  danger: "bg-danger text-panel hover:opacity-90",
};

/**
 * The button's classes, for the things that must be a link but look like a
 * button — "Log for them", "Add animal" when it navigates rather than opens.
 *
 * Without this every such link restyled itself by hand, and the hand copies
 * drifted: some semibold and some medium, some with the focus ring and some
 * without, padding 3, 4 or 5. A link that is a button in every way but its
 * element should be indistinguishable from one.
 */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  options: { readonly block?: boolean; readonly className?: string } = {},
): string {
  return [BASE, VARIANTS[variant], options.block === true ? "w-full" : "", options.className ?? ""]
    .filter(Boolean)
    .join(" ");
}

/** `Fab`'s classes, for the one floating add that navigates instead. */
export const FAB_CLASS =
  "fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 " +
  "inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 " +
  "font-semibold text-action-ink shadow-float hover:opacity-90 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
  "disabled:cursor-not-allowed disabled:opacity-50 sm:hidden";

/**
 * A quick-action tile: the row of big square buttons under an animal's name
 * or at the top of a species page — an icon over a short label.
 *
 * Four screens defined it for themselves, two at 72px and two at 76px, with
 * the label at an arbitrary 13px. One tile, one height, the type scale's
 * small size.
 */
export const ACTION_TILE_CLASS =
  "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-density " +
  "border border-rule bg-panel px-1 text-center text-sm font-medium text-ink hover:bg-raised " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

/**
 * The drawn checkbox on a tickable row — a chore, a feeding, a picked animal.
 *
 * The row carries the checkbox role and state; this is only the box. Five
 * screens drew it at four sizes with three corner radii. One box, at the
 * density's own corner, so it is square on the kiosk like everything else.
 */
export function tickBoxClass(on: boolean): string {
  return [
    "flex h-[1.625rem] w-[1.625rem] shrink-0 items-center justify-center rounded-density border-2",
    "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action",
    on ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
  ].join(" ");
}
