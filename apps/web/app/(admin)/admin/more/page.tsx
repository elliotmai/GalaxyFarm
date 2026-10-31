import Link from "next/link";

import { PageBody, PageHeader } from "@galaxy-farm/ui";

import { MORE } from "@/app/(admin)/_components/nav-groups";

export const metadata = { title: "More" };

/**
 * Everything that is not daily (spec §7, §8 v1.7).
 *
 * The seasonal work done at a desk, the people the farm deals with, and the
 * things set up once. It used to be a utility rail under the sidebar and a
 * Business destination of its own; as a page it is one tap from anywhere on a
 * phone and says what each thing is for, which a rail of bare words never did.
 *
 * Drawn from `MORE` in `nav-groups.ts`, so the page and the nav's idea of
 * what lives here cannot drift apart.
 */
export default function MorePage() {
  return (
    <PageBody>
      <PageHeader title="More" />
      {MORE.map((group) => (
        <section key={group.label} className="flex flex-col gap-2" aria-label={group.label}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {group.label}
          </h2>
          <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-target items-center justify-between gap-3 px-density py-3 hover:bg-raised"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-density font-semibold text-ink">{item.label}</span>
                    <span className="text-sm text-muted">{item.hint}</span>
                  </span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageBody>
  );
}
