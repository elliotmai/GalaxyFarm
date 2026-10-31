import Link from "next/link";

import { EmptyState, PageBody, PageHeader } from "@galaxy-farm/ui";

/**
 * A horses screen that does not exist yet (spec §5.9).
 *
 * §5.9 asks for stub routes for herd, pens, feeding and breeding — "coming
 * soon shells so navigation and permissions are already real". That is worth
 * more than it sounds: the route resolves, the middleware gates it like every
 * other admin route, and the nav has the shape it will keep, so the module
 * arrives into a place already laid out for it.
 *
 * Deliberately not `PagePlaceholder`. A screen that is waiting on a horse is
 * not the same as one waiting on a phase, and this one can say what it will
 * hold and where the live work is in the meantime — as one empty state with
 * the two live screens as its actions, rather than a callout and a section
 * explaining the spec.
 */
export function HorseShell({
  title,
  holds,
}: {
  readonly title: string;
  /** One line: what will live here once there are horses. */
  readonly holds: string;
}) {
  return (
    <PageBody>
      <PageHeader eyebrow="Horses" title={title} subtitle={holds} />

      <EmptyState
        title="No horses here yet"
        detail="This fills in when the first horse arrives. The shopping is live now."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/admin/horses/roadmap"
              className="inline-flex min-h-target items-center rounded-density border border-rule px-4 font-semibold text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            >
              Roadmap
            </Link>
            <Link
              href="/admin/horses/candidates"
              className="inline-flex min-h-target items-center rounded-density border border-rule px-4 font-semibold text-action hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            >
              Candidates
            </Link>
          </div>
        }
      />
    </PageBody>
  );
}
