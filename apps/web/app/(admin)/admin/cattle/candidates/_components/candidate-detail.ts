import type { PurchaseCandidate } from "@galaxy-farm/core";
import type { CattleCandidateDetail } from "@galaxy-farm/module-cattle";

/**
 * The cattle half of a candidate, as it is read off the device.
 *
 * It rides along as JSON, so a date is a string here. Everything is optional
 * because a candidate typed in by hand has far less on it than one from a sale.
 */
export type CandidateDetail = Partial<
  Omit<CattleCandidateDetail, "saleDate" | "dob" | "dueDate">
> & {
  readonly saleDate?: string | undefined;
};

export function candidateDetail(candidate: PurchaseCandidate): CandidateDetail {
  return (candidate.domainDetail ?? {}) as CandidateDetail;
}

/**
 * When a lot closes: the listing's own end time when a sale gave one, else the
 * sale date a person typed in. Undefined for a private treaty, which never closes.
 */
export function saleEndOf(candidate: PurchaseCandidate): Date | undefined {
  if (candidate.expiresAt !== undefined) return candidate.expiresAt;
  const raw = candidateDetail(candidate).saleDate;
  if (raw === undefined || raw === "") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
