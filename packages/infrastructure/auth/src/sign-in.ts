import {
  actorFromUser,
  isWithinAccessWindow,
  isLive,
  type Actor,
  type Clock,
  type User,
} from "@galaxy-farm/core";

import { hashPassword, needsRehash, verifyPassword } from "./password.js";

/**
 * Signing in (spec §4.3).
 *
 * The rule running through all of this: **every failure looks the same from
 * outside.** Unknown email, wrong password, deactivated account, housesitter
 * whose week ended — all of them return the same refusal and all of them cost
 * the same time, because a sign-in form that answers faster for an address it
 * has never seen is an account enumerator.
 */

export interface StoredCredential {
  readonly user: User;
  readonly passwordHash: string;
}

/**
 * How the adapter finds someone. Implemented over Postgres in the app's
 * composition root — this package must not import another adapter (§4.1).
 */
export interface CredentialStore {
  findByEmail(email: string): Promise<StoredCredential | undefined>;
  /** Called after a successful sign-in when the hash was made with old parameters. */
  updatePasswordHash?(userId: string, hash: string): Promise<void>;
  recordSignIn?(userId: string, at: Date): Promise<void>;
}

export type SignInFailure =
  | { readonly kind: "invalid-credentials" }
  | { readonly kind: "outside-access-window"; readonly from: Date; readonly to: Date };

export type SignInResult =
  | { readonly ok: true; readonly actor: Actor; readonly user: User }
  | { readonly ok: false; readonly failure: SignInFailure };

/**
 * A hash of a value nobody knows, verified against when no user is found.
 *
 * Returning early on an unknown email skips ~100ms of scrypt, and that
 * difference is measurable over the network — it turns the sign-in form into a
 * way to ask "does this person have an account here?" So we always do the
 * work.
 */
let decoyHash: Promise<string> | undefined;

function decoy(): Promise<string> {
  decoyHash ??= hashPassword("password-that-matches-nothing");
  return decoyHash;
}

export async function signIn(
  store: CredentialStore,
  credentials: { readonly email: string; readonly password: string },
  clock: Clock,
): Promise<SignInResult> {
  const email = credentials.email.trim().toLowerCase();
  const found = await store.findByEmail(email);

  if (found === undefined) {
    await verifyPassword(credentials.password, await decoy());
    return { ok: false, failure: { kind: "invalid-credentials" } };
  }

  const matches = await verifyPassword(credentials.password, found.passwordHash);
  if (!matches) return { ok: false, failure: { kind: "invalid-credentials" } };

  // Checked after the password, deliberately. Answering "that account is
  // deactivated" to someone who has not proved they own it tells them the
  // account exists.
  if (!found.user.active || !isLive(found.user)) {
    return { ok: false, failure: { kind: "invalid-credentials" } };
  }

  const now = clock.now();
  if (!isWithinAccessWindow(actorFromUser(found.user), now)) {
    // This one is worth naming: the password was right, so nothing is being
    // leaked, and "your access ran out on the 20th" is the only message that
    // lets a housesitter do something about it.
    return {
      ok: false,
      failure: {
        kind: "outside-access-window",
        from: found.user.accessFrom!,
        to: found.user.accessTo!,
      },
    };
  }

  // The one moment the plaintext exists is the one moment an old hash can be
  // upgraded, so raising the cost parameters later costs nobody a reset.
  if (needsRehash(found.passwordHash) && store.updatePasswordHash !== undefined) {
    await store.updatePasswordHash(found.user.id, await hashPassword(credentials.password));
  }

  await store.recordSignIn?.(found.user.id, now);

  return { ok: true, actor: actorFromUser(found.user), user: found.user };
}
