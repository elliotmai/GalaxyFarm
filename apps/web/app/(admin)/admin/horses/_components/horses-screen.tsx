"use client";

import { PageBody, PageHeader, Pill } from "@galaxy-farm/ui";
import {
  formatMoney,
  totalAcquisitionCost,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";
import { budgetOutlook, horseCandidates, nextUp, unshopped } from "@galaxy-farm/module-horses";

import { useRecords } from "@/lib/local/use-records";

import { ListRow, RowList } from "./list-row";

/**
 * Horses (spec §5.9, §7 `/admin/horses`).
 *
 * The module is a skeleton and this is its front door: what is live now — the
 * roadmap and the shopping — and what the four shells behind it will hold when
 * there is a horse to put in them.
 *
 * It is a real screen rather than a placeholder because the two live surfaces
 * have numbers worth seeing together. A want with no horse against it and a
 * horse over the budget set for it are the two things this section is for, and
 * both are answered before anybody clicks anything — as one line of facts on
 * each row rather than a row of tiles, because two links with numbers on them
 * is the whole screen.
 */

/** The stub routes §5.9 asks for, and what each will hold. */
const SHELLS: readonly { href: string; label: string; holds: string }[] = [
  { href: "/admin/horses/herd", label: "Herd", holds: "Who is here and how each handles" },
  { href: "/admin/horses/pens", label: "Pens", holds: "Who is in which trap" },
  { href: "/admin/horses/feeding", label: "Feeding", holds: "Rations and cost to keep" },
  { href: "/admin/horses/breeding", label: "Breeding", holds: "Covers and foaling dates" },
];

export function HorsesScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const query = { propertyId };
  const { records: roadmap } = useRecords<RoadmapItem>("roadmapItems", query);
  const { records: allCandidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);

  const now = new Date();
  const steps = nextUp(roadmap, now);
  const outlook = budgetOutlook(roadmap);
  const notStarted = unshopped(roadmap, allCandidates);

  const candidates = horseCandidates(allCandidates);
  const open = candidates.filter(
    (candidate) =>
      candidate.status !== "purchased" &&
      candidate.status !== "passed" &&
      candidate.status !== "gone",
  );
  const passed = candidates.filter((candidate) => candidate.status === "passed").length;
  const cheapest = open
    .map((candidate) => totalAcquisitionCost(candidate))
    .sort((left, right) => left.cents - right.cents)[0];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Horses"
        title="Horses"
        subtitle={`No horses yet · ${open.length} under consideration`}
      />

      <section aria-labelledby="horses-live" className="flex flex-col gap-2.5">
        <h2 id="horses-live" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Live now
        </h2>
        <RowList label="Live now">
          <ListRow
            href="/admin/horses/roadmap"
            title="Roadmap"
            line={[
              `${steps.length} open`,
              `${formatMoney(outlook.total)} planned`,
              // Unpriced wants are left out of the total, so the line says so
              // rather than letting the sum look complete.
              outlook.unpriced === 0 ? undefined : `${outlook.unpriced} not priced`,
            ]}
            chip={
              notStarted.length === 0 ? undefined : (
                <Pill tone="action">{notStarted.length} unshopped</Pill>
              )
            }
          />
          <ListRow
            href="/admin/horses/candidates"
            title="Candidates"
            line={[
              `${open.length} in play`,
              cheapest === undefined ? undefined : `cheapest ${formatMoney(cheapest)} all in`,
              passed === 0 ? undefined : `${passed} passed, kept`,
            ]}
          />
        </RowList>
      </section>

      {/*
        The shells, quietly. They are real routes so navigation and permissions
        are already right, but none of them has anything in it, so they sit
        below the live work as plain rows rather than four cards of their own.
      */}
      <section aria-labelledby="horses-later" className="flex flex-col gap-2.5">
        <h2 id="horses-later" className="text-xs font-semibold uppercase tracking-wide text-muted">
          When the horses arrive
        </h2>
        <RowList label="When the horses arrive">
          {SHELLS.map((shell) => (
            <ListRow
              key={shell.href}
              href={shell.href}
              title={shell.label}
              line={[shell.holds]}
              chip={<Pill tone="neutral">Coming soon</Pill>}
            />
          ))}
        </RowList>
      </section>
    </PageBody>
  );
}
