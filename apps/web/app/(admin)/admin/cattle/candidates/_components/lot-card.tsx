import { Button, Pill, Select } from "@galaxy-farm/ui";
import {
  CANDIDATE_STATUSES,
  formatMoney,
  totalAcquisitionCost,
  type CandidateStatus,
  type PurchaseCandidate,
} from "@galaxy-farm/core";

import { candidateDetail, saleEndOf, type CandidateDetail } from "./candidate-detail";

/**
 * One lot, laid out the way an auction site lays out a lot: the photo leads,
 * the lot number and time left sit on the photo, and the price is the largest
 * thing on the card. The sale is the seller here, so it sits above the name.
 *
 * The closing time is shown as a running count rather than a date, because a
 * lot is a deadline (see the screen's header).
 */

/** "3d 4h", "5h 12m", "Closing", or "Closed" — short enough to sit on a photo. */
export function countdownLabel(endsAt: Date | undefined, now: Date): string | undefined {
  if (endsAt === undefined) return undefined;
  const ms = endsAt.getTime() - now.getTime();
  if (ms <= 0) return "Closed";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
  if (hours < 24) return `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
}

/** The lot name without the "Lot 001:" the title carries, since the number has its own badge. */
function lotNameOf(candidate: PurchaseCandidate): string {
  return candidate.title.replace(/^Lot\s+[^:]+:\s*/, "");
}

function registrationOf(detail: CandidateDetail): string {
  if (detail.regNumber === undefined) return "Not registered";
  return `${detail.association ?? "Reg"} ${detail.regNumber}`;
}

const SEX_LABEL: Readonly<Record<string, string>> = {
  female: "Female",
  male: "Male",
  steer: "Steer",
};

function sexOf(detail: CandidateDetail): string | undefined {
  const sex = SEX_LABEL[detail.sex ?? "unknown"];
  if (sex === undefined) return undefined;
  return detail.bred === true && sex === "Female" ? "Bred female" : sex;
}

export function LotCard({
  candidate,
  now,
  onStatus,
  onDelete,
}: {
  readonly candidate: PurchaseCandidate;
  readonly now: Date;
  readonly onStatus: (status: CandidateStatus) => void;
  readonly onDelete: () => void;
}) {
  const detail = candidateDetail(candidate);
  const endsAt = saleEndOf(candidate);
  const countdown = countdownLabel(endsAt, now);
  const closed = countdown === "Closed";
  const sex = sexOf(detail);
  const breed = detail.breedText ?? detail.dobText;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="relative aspect-[4/3] bg-edge/10">
        {detail.pictureUrl === undefined ? (
          <div className="grid h-full place-items-center text-sm text-muted">No photo</div>
        ) : (
          // Listing photos come off SC's CDN and are shown as the seller posted them.
          <img
            src={detail.pictureUrl}
            alt={lotNameOf(candidate)}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
        {detail.lotNumber === undefined ? null : (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
            Lot {detail.lotNumber}
          </span>
        )}
        {countdown === undefined ? null : (
          <span
            className={[
              "absolute right-2 top-2 rounded px-2 py-0.5 text-xs font-semibold text-white",
              closed ? "bg-black/60" : "bg-danger",
            ].join(" ")}
          >
            {countdown}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          {detail.saleName === undefined ? null : (
            <p className="truncate text-xs uppercase tracking-wide text-muted">{detail.saleName}</p>
          )}
          <h3 className="font-semibold leading-tight">{lotNameOf(candidate)}</h3>
          <p className="text-sm text-muted">{[sex, breed].filter(Boolean).join(" · ") || "—"}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Registration</dt>
          <dd>{registrationOf(detail)}</dd>
          <dt className="text-muted">Sire</dt>
          <dd className="truncate">
            {detail.sireName ?? "—"}
            {detail.sire === undefined ? null : (
              <span className="ml-1 text-xs text-identity">in catalog</span>
            )}
          </dd>
          <dt className="text-muted">Dam</dt>
          <dd className="truncate">
            {detail.damName ?? "—"}
            {detail.dam === undefined ? null : (
              <span className="ml-1 text-xs text-identity">in catalog</span>
            )}
          </dd>
          <dt className="text-muted">Where</dt>
          <dd className="truncate">{candidate.location ?? "—"}</dd>
          <dt className="text-muted">Sold</dt>
          <dd className="capitalize">{(detail.saleType ?? "auction").replace(/_/g, " ")}</dd>
        </dl>

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-edge pt-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Next bid</p>
            <p className="text-2xl font-bold tabular-nums">{formatMoney(candidate.askingPrice)}</p>
            <p className="text-xs text-muted">
              {formatMoney(totalAcquisitionCost(candidate))} all in
            </p>
          </div>
          <Pill tone={candidate.status === "passed" ? "neutral" : "action"}>
            {candidate.status.replace(/_/g, " ")}
          </Pill>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {candidate.listingUrl === undefined ? null : (
            <a
              href={candidate.listingUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-action underline"
            >
              View lot
            </a>
          )}
          {detail.videoUrl === undefined ? null : (
            <a
              href={detail.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-action underline"
            >
              Video
            </a>
          )}
          <Select
            label="Status"
            hideLabel
            value={candidate.status}
            onChange={(event) => onStatus(event.target.value as CandidateStatus)}
            options={CANDIDATE_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, " "),
            }))}
          />
          <Button variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </article>
  );
}
