"use client";

import Link from "next/link";

import { CardGrid, PageBody, PageHeader, Pill, RecordCard, Section, Tile } from "@galaxy-farm/ui";
import {
  formatMoney,
  totalAcquisitionCost,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";
import { budgetOutlook, horseCandidates, nextUp, unshopped } from "@galaxy-farm/module-horses";

import { useRecords } from "@/lib/local/use-records";

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
 * both are answered before anybody clicks anything.
 */

/** The stub routes §5.9 asks for, and what each will hold. */
const SHELLS: readonly { href: string; label: string; holds: string }[] = [
  {
    href: "/admin/horses/herd",
    label: "Herd",
    holds: "Who is here, whose they are, and what each one is like to handle.",
  },
  {
    href: "/admin/horses/pens",
    label: "Pens",
    holds: "Which horse is in which trap, and what that pen's safety level becomes with him in it.",
  },
  {
    href: "/admin/horses/feeding",
    label: "Feeding",
    holds: "Rations in the units they are fed in, and what a horse costs to keep.",
  },
  {
    href: "/admin/horses/breeding",
    label: "Breeding",
    holds: "Covers, foaling dates, and what a cross was for.",
  },
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
  const cheapest = open
    .map((candidate) => totalAcquisitionCost(candidate))
    .sort((left, right) => left.cents - right.cents)[0];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Horses"
        title="Horses"
        subtitle="No horses yet. The shopping is live anyway — §5.9 calls this the purchase furthest out and the one most worth researching slowly, so the roadmap and the comparison run years ahead of the module."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="On the roadmap" value={steps.length} tone="identity" hint="Still open" />
        <Tile
          label="Planned spend"
          value={formatMoney(outlook.total)}
          hint={
            outlook.unpriced === 0
              ? "Everything open is priced"
              : `${outlook.unpriced} not priced — not counted here`
          }
        />
        <Tile label="Under consideration" value={open.length} tone="action" />
        <Tile
          label="Cheapest all in"
          value={cheapest === undefined ? "—" : formatMoney(cheapest)}
          hint={cheapest === undefined ? "Nothing being compared yet" : "Hauling and exam included"}
        />
      </div>

      <Section
        title="Live now"
        description="Both work with no horse on the place, which is the whole reason they are built first."
      >
        <CardGrid columns={2}>
          <RecordCard
            tone="identity"
            title={
              <Link href="/admin/horses/roadmap" className="underline underline-offset-4">
                Roadmap
              </Link>
            }
            subtitle="What the horses are for, what has to be true before one arrives, and the budget for each want."
            meta={
              <>
                <Pill tone="identity">{steps.length} open</Pill>
                {notStarted.length === 0 ? (
                  <Pill tone="calm">every want has a horse against it</Pill>
                ) : (
                  <Pill tone="action">{notStarted.length} with nothing under consideration</Pill>
                )}
              </>
            }
          />
          <RecordCard
            tone="action"
            title={
              <Link href="/admin/horses/candidates" className="underline underline-offset-4">
                Candidates
              </Link>
            }
            subtitle="Horses under consideration, compared on total acquisition cost rather than on the asking price."
            meta={
              <>
                <Pill tone="action">{open.length} in play</Pill>
                <Pill tone="neutral">
                  {candidates.filter((candidate) => candidate.status === "passed").length} passed,
                  kept
                </Pill>
              </>
            }
          />
        </CardGrid>
      </Section>

      <Section
        title="When the horses arrive"
        description="Stub routes today, so navigation and permissions are already real and the module lands in a place laid out for it."
      >
        <CardGrid columns={2}>
          {SHELLS.map((shell) => (
            <RecordCard
              key={shell.href}
              tone="neutral"
              title={
                <Link href={shell.href} className="underline underline-offset-4">
                  {shell.label}
                </Link>
              }
              subtitle={shell.holds}
              // Under the text rather than opposite the title: three of these
              // four subtitles wrap, and a corner pill lands in a different
              // place on each card when they do.
              meta={<Pill tone="neutral">coming soon</Pill>}
            />
          ))}
        </CardGrid>
      </Section>
    </PageBody>
  );
}
