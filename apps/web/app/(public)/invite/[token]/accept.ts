"use server";

import { MINIMUM_PASSWORD_LENGTH } from "@galaxy-farm/core";
import { hashPassword } from "@galaxy-farm/infra-auth";

import { acceptInvitation } from "@/lib/user-store";

/**
 * Accepting an invitation (spec §4.3).
 *
 * Unauthenticated by necessity — the whole point is that they cannot sign in
 * yet — so the token is the only thing standing here, and everything hangs on
 * it being unguessable, single-use, and short-lived.
 *
 * Note what this action deliberately does **not** do: it does not sign them
 * in. Setting a password and proving you know one are different acts, and
 * pairing them would mean a link, on its own, produces a session. They set it
 * and then sign in, like anybody else.
 */

export type AcceptResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export async function acceptInvite(token: string, password: string): Promise<AcceptResult> {
  // Normalised the same way the hashing does, so a length checked here is the
  // length that gets hashed.
  const chosen = password.normalize("NFKC");

  if (chosen.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${MINIMUM_PASSWORD_LENGTH} characters. A phrase you will remember beats a word you will not.`,
    };
  }

  const accepted = await acceptInvitation(token, await hashPassword(chosen), new Date());

  if (!accepted) {
    // One message for every reason — spent, lapsed, deleted, switched off.
    // This endpoint is reachable by anyone holding a URL, and distinguishing
    // "already used" from "never existed" tells them which links are real.
    return {
      ok: false,
      error:
        "This link no longer works. Invitations last a week and can only be used once — ask for a fresh one.",
    };
  }

  return { ok: true };
}
