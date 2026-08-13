import Link from "next/link";

import { Callout, PageBody, PageHeader, Section } from "@galaxy-farm/ui";

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
 * hold and where the live work is in the meantime.
 */
export function HorseShell({
  title,
  route,
  holds,
}: {
  readonly title: string;
  readonly route: string;
  /** One line: what will live here once there are horses. */
  readonly holds: string;
}) {
  return (
    <PageBody>
      <PageHeader eyebrow="Horses" title={title} subtitle={holds} />

      <Callout tone="neutral" title="No horses here yet">
        This screen is a shell on purpose. Spec §5.9 keeps the horses module a skeleton until there
        is a horse to put in it — the route exists now so navigation and permissions are real, and
        so the build is filling in a prepared module rather than designing one.
      </Callout>

      <Section
        title="What is live now"
        description="Horses are the purchase furthest out and the one most worth researching slowly, so the shopping surface runs years ahead of the module."
      >
        <ul className="flex flex-col gap-2">
          <li>
            <Link href="/admin/horses/roadmap" className="text-action underline underline-offset-4">
              The roadmap
            </Link>{" "}
            <span className="text-muted">
              — what the horses are for, what has to be true first, and the budget for it.
            </span>
          </li>
          <li>
            <Link
              href="/admin/horses/candidates"
              className="text-action underline underline-offset-4"
            >
              Candidates
            </Link>{" "}
            <span className="text-muted">
              — the horses under consideration, compared on what one would cost to get here.
            </span>
          </li>
        </ul>
        <code className="text-sm text-muted">{route}</code>
      </Section>
    </PageBody>
  );
}
