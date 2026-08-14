"use server";

import { redeemPairing } from "@/lib/device-store";

/**
 * Redeeming a pairing code (spec §4.4).
 *
 * The one server action on this surface reachable by somebody with no
 * session at all — pairing is how a barn screen *gets* one. Deliberately
 * unauthenticated rather than gated: `middleware.ts` carries the same
 * exception for `/kiosk/pair` itself, for the same reason. Nothing here is
 * sensitive on its own — a code is single-use and expires in minutes either
 * way — but the token this hands back is not: it is the credential the screen
 * holds from now on, so it crosses the wire exactly once and the caller's
 * very next move has to be trading it in for a session, not stashing it.
 */

export type RedeemResult =
  | { readonly ok: true; readonly token: string; readonly deviceId: string; readonly name: string }
  | { readonly ok: false; readonly error: string };

export async function redeemPairingCode(code: string): Promise<RedeemResult> {
  if (code.trim() === "") {
    return { ok: false, error: "Enter the code shown in Settings." };
  }

  const result = await redeemPairing(code, new Date());
  if (result === undefined) {
    return { ok: false, error: "That code is wrong or has expired. Ask for a new one." };
  }

  return {
    ok: true,
    token: result.token,
    deviceId: result.device.id,
    name: result.device.name,
  };
}
