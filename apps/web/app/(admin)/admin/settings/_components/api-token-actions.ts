"use server";

import { revalidatePath } from "next/cache";

import { can, isUlid, type Ulid } from "@galaxy-farm/core";

import { createApiToken, findApiToken, revokeApiToken, type ApiToken } from "@/lib/api-token-store";
import { currentActor } from "@/lib/auth";

/**
 * Connected apps (spec §4.3 "Connected apps", §7 `/admin/settings`).
 *
 * The same shape as `device-actions.ts`: `api_tokens` never reaches a local
 * store, so this is a server-action screen that re-reads afterwards.
 *
 * `integrations.manage` — owner-only, the capability the Wander connector
 * already uses: a token is a standing key to this farm's chores and guide
 * held by another app, which is the same class of decision. Every action
 * re-checks it, because a server action is a POST endpoint with a generated
 * name.
 */

export type ApiTokenActionResult =
  | {
      readonly ok: true;
      readonly message: string;
      /** The plaintext, exactly once — on creation — to show and paste. */
      readonly token?: string;
    }
  | { readonly ok: false; readonly error: string; readonly field?: string };

const REFUSED: ApiTokenActionResult = {
  ok: false,
  error: "You do not have permission to manage connected apps.",
};

async function managingActor() {
  const actor = await currentActor();
  if (actor === undefined) return undefined;
  return can(actor, "integrations.manage", new Date()) ? actor : undefined;
}

async function owned(id: string, propertyId: string): Promise<ApiToken | undefined> {
  if (!isUlid(id)) return undefined;
  const token = await findApiToken(id as Ulid);
  return token !== undefined && token.propertyId === propertyId ? token : undefined;
}

export async function addApiToken(label: string): Promise<ApiTokenActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const trimmed = label.trim();
  if (trimmed === "") return { ok: false, error: "Name the app it is for.", field: "label" };
  if (trimmed.length > 80) {
    return { ok: false, error: "Keep the name under 80 characters.", field: "label" };
  }

  const { apiToken, token } = await createApiToken(
    { propertyId: actor.propertyId, label: trimmed, createdBy: actor.id },
    new Date(),
  );

  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: `Token minted for ${apiToken.label}. Copy it now — it is not shown again.`,
    token,
  };
}

/** Irreversible (§4.5 clause 3): the app is refused from its very next request. */
export async function revokeApiTokenAction(id: string): Promise<ApiTokenActionResult> {
  const actor = await managingActor();
  if (actor === undefined) return REFUSED;

  const token = await owned(id, actor.propertyId);
  if (token === undefined) return { ok: false, error: "That token is not on this property." };
  if (token.revokedAt !== undefined) {
    return { ok: false, error: `${token.label}'s token is already revoked.` };
  }

  // The write half of an Elevated confirmation connected-apps-screen.tsx's
  // client component already showed before calling revokeApiTokenAction.
  // crud-guard: allow-unconfirmed — confirmed client-side before this runs
  await revokeApiToken(token.id, new Date());
  revalidatePath("/admin/settings");
  return { ok: true, message: `${token.label}'s token revoked. It stops working immediately.` };
}
