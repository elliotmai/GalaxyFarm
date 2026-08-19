import type { ReactNode } from "react";

import { Callout } from "@galaxy-farm/ui";
import { DEFAULT_ROTATION_YEARS, type RotationWarning } from "@galaxy-farm/module-garden";

import { formatDate } from "@/app/(admin)/admin/garden/_components/labels";

/**
 * The rotation guard, said out loud (spec §5.5).
 *
 * Two screens raise this warning — the plantings form and the layout designer —
 * and §5.5 asks for one warning, not two that word the same fact differently.
 * The rule itself is `rotationWarning` in the garden domain; this is only how it
 * reads, kept in one place for the same reason `labels.ts` keeps `direct_sow`
 * spelled one way.
 *
 * What to do about it is the caller's, because the two screens genuinely differ:
 * the form has a notes field to explain yourself in, and the designer has
 * another bed one tap away. It is a warning either way — a gardener who knows
 * they are breaking rotation and is doing it anyway is not making a mistake.
 */
export function RotationCallout({
  warning,
  bedName,
  children,
}: {
  readonly warning: RotationWarning;
  readonly bedName: string;
  readonly children?: ReactNode;
}) {
  return (
    <Callout tone="danger" title="Rotation warning">
      <p>
        {warning.family} was last in {bedName} on {formatDate(warning.lastPlantedOn)} —{" "}
        {warning.yearsSince.toFixed(1)} years ago, inside the {DEFAULT_ROTATION_YEARS}-year
        rotation. Same family means the same soil-borne diseases and the same feeders.
      </p>
      {children === undefined ? null : <p className="mt-2 text-sm">{children}</p>}
    </Callout>
  );
}
