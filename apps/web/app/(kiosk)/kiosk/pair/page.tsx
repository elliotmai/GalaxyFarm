import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";
import { Logomark } from "@galaxy-farm/ui";

import { PairForm } from "@/app/(kiosk)/kiosk/pair/pair-form";

export const metadata = { title: "Pair This Screen" };

/**
 * Pairing a barn screen (spec §4.4).
 *
 * The only page under `/kiosk` a signed-out visitor can reach — `middleware.ts`
 * carries a matching exception for exactly this path, because pairing is how a
 * fresh screen gets a session in the first place. Everything else about this
 * page is deliberately plain: it is read once, from across a barn, by whoever
 * is holding the code from Settings.
 */
export default function KioskPairPage() {
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-density p-6">
      <div className="flex flex-col items-center gap-2">
        <Logomark size="large" decorative />
        <h1 className="text-ink">{farmName}</h1>
        <p className="text-muted">Pair this screen</p>
      </div>

      <PairForm />

      <p className="max-w-sm text-center text-sm text-muted">
        Get a code from Settings → Kiosk devices on any signed-in phone or laptop, then type it in
        above. The code is good for fifteen minutes and works once.
      </p>
    </div>
  );
}
