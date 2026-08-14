/**
 * What a screen looks like before its records arrive (spec §8).
 *
 * Two different waits need covering, and they are not the same wait.
 *
 * The first is between clicking a nav item and the route's JavaScript
 * arriving. Next paints a route-level `loading.tsx` for that, but only if the
 * file exists — without one the click does *nothing visible* until the server
 * answers, which reads as a broken control rather than as a load.
 *
 * The second is between the screen mounting and IndexedDB answering. Every
 * read here comes from the device, so it is short, but it is not zero and it
 * used to be a line of grey text saying "Loading the farm…".
 *
 * Both are covered the same way: draw the shape of what is coming. The layout
 * is known long before the data is, so there is no reason to show nothing —
 * and a page that keeps its geometry while it fills does not shift under
 * somebody's thumb the moment they reach for it.
 */

export interface SkeletonProps {
  /** Tailwind height utility, or any class the caller wants on the block. */
  readonly className?: string;
  /** Rendered as a circle — an avatar, a status dot, a safety chip. */
  readonly circle?: boolean;
}

/**
 * One placeholder block.
 *
 * `bg-rule` rather than a shimmer gradient. A shimmer is an animation running
 * on every screen somebody opens forty times a day, and §8 already asks for
 * nothing to move on a surface where a weight is being read. The block is
 * quiet, the reduced-motion rule in `theme.css` covers the pulse, and the
 * information — "something is coming, and it is this shape" — is carried by
 * the geometry rather than by the movement.
 */
export function Skeleton({ className, circle = false }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        "block animate-pulse bg-rule",
        circle ? "rounded-full" : "rounded-density",
        className ?? "h-4 w-full",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/**
 * A screen's worth of skeleton, with the heading kept real.
 *
 * The title is passed through rather than blocked out, because it is the one
 * thing already known at this point — the route says so. Replacing it with a
 * grey bar throws away information the reader could have had, and makes every
 * loading screen in the app look identical.
 *
 * `role="status"` with a polite live region: a screen reader is told the page
 * is loading once, rather than being read a wall of decorative blocks.
 */
export interface SkeletonScreenProps {
  readonly title?: string;
  /** Stat tiles across the top. */
  readonly stats?: number;
  /** Rows in the list below them. */
  readonly rows?: number;
}

export function SkeletonScreen({ title, stats = 4, rows = 5 }: SkeletonScreenProps) {
  return (
    <div className="flex flex-col gap-density" role="status" aria-busy="true">
      <span className="sr-only">Loading{title === undefined ? "" : ` ${title}`}…</span>

      {title === undefined ? (
        <Skeleton className="h-8 w-48" />
      ) : (
        <h1 className="font-heading text-2xl font-semibold text-ink">{title}</h1>
      )}

      {stats > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-density border border-rule bg-raised px-density py-3"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-density border border-rule bg-panel p-density">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton circle className="h-5 w-5 shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
