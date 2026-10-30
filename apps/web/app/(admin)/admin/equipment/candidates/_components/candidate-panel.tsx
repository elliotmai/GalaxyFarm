"use client";

import Link from "next/link";

import { Button, Modal, Pill, Select, optionLabel } from "@galaxy-farm/ui";
import {
  CANDIDATE_STATUSES,
  formatMoney,
  isPriced,
  totalAcquisitionCost,
  type CandidateStatus,
  type PurchaseCandidate,
  type RoadmapItem,
} from "@galaxy-farm/core";
import { concerns } from "@galaxy-farm/module-equipment";

import { detailOf, formatDate } from "./candidate-format";

/**
 * One candidate, opened from its row in the comparison.
 *
 * What used to be a card per candidate under the table — "Worth being told" —
 * and the status select and buttons that used to fill the table's last column.
 * Not a score: a decision this size is made by a person weighing the concerns,
 * the pros and the cons against each other, and a single number would flatten
 * exactly the things worth weighing. So they are listed, one per line.
 */
export function CandidatePanel({
  candidate,
  want,
  onStatus,
  onEdit,
  onDelete,
  onClose,
}: {
  readonly candidate: PurchaseCandidate;
  readonly want: RoadmapItem | undefined;
  readonly onStatus: (status: CandidateStatus) => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const detail = detailOf(candidate);
  const flags = concerns({
    ...detail,
    candidateId: candidate.id,
    category: detail.category ?? "vehicle",
    // Absent reads as "not asked yet", which is itself a concern — §5.6 flags
    // a missing service history, and a candidate nobody has asked is exactly
    // the one nobody should assume about.
    serviceHistoryAvailable: detail.serviceHistoryAvailable ?? false,
  });

  const description = [
    [detail.year, detail.make, detail.model].filter(Boolean).join(" "),
    candidate.location,
    want === undefined ? undefined : `against “${want.title}”`,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <Modal
      title={candidate.title}
      {...(description === "" ? {} : { description })}
      placement="side"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={onEdit}>
            Edit
          </Button>
          <Button onClick={onClose}>Done</Button>
          <Button variant="danger" className="ml-auto" onClick={onDelete}>
            Delete
          </Button>
        </>
      }
    >
      {/* Choosing "purchased" here creates the machine, as it always has. */}
      <Select
        label="Status"
        value={candidate.status}
        onChange={(event) => onStatus(event.target.value as CandidateStatus)}
        options={CANDIDATE_STATUSES.map((value) => ({
          value,
          label: optionLabel(value),
        }))}
      />

      <dl className="flex flex-col divide-y divide-rule text-sm">
        <div className="flex justify-between gap-2 py-2">
          <dt className="text-muted">Asking</dt>
          <dd className="gf-numeric">
            {candidate.askingPrice === undefined
              ? "No price yet"
              : formatMoney(candidate.askingPrice)}
          </dd>
        </div>
        {candidate.additionalCosts.map((cost) => (
          <div key={cost.label} className="flex justify-between gap-2 py-2">
            <dt className="text-muted">{cost.label}</dt>
            <dd className="gf-numeric">{formatMoney(cost.amount)}</dd>
          </div>
        ))}
        {/* No all-in figure without an asking price to add the costs to. */}
        {isPriced(candidate) ? (
          <div className="flex justify-between gap-2 py-2 font-semibold">
            <dt>All in</dt>
            <dd className="gf-numeric">{formatMoney(totalAcquisitionCost(candidate))}</dd>
          </div>
        ) : null}
      </dl>

      {flags.length === 0 ? (
        <p className="text-sm text-muted">Nothing flagged.</p>
      ) : (
        <ul aria-label="Worth being told" className="flex flex-col gap-1 text-sm text-danger">
          {flags.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}

      {candidate.pros.length === 0 && candidate.cons.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {candidate.pros.map((pro) => (
            <Pill key={pro} tone="calm">
              {pro}
            </Pill>
          ))}
          {candidate.cons.map((con) => (
            <Pill key={con} tone="danger">
              {con}
            </Pill>
          ))}
        </div>
      )}

      {candidate.expiresAt === undefined && candidate.notes === undefined ? null : (
        <p className="text-sm text-muted">
          {[
            candidate.expiresAt === undefined
              ? undefined
              : `Sale or expiry ${formatDate(candidate.expiresAt)}`,
            candidate.notes,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {candidate.listingUrl === undefined ? null : (
        <Link
          href={candidate.listingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
        >
          Open the listing ↗
        </Link>
      )}
    </Modal>
  );
}
