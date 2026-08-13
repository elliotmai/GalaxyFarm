"use server";

import { revalidatePath } from "next/cache";

import { can, isUlid, type Ulid } from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";
import { tickChore } from "@/lib/sitter-store";

/**
 * Ticking a chore off, from `/sitter` (spec §4.3, §5.10).
 *
 * A server action rather than a write through the local store, because this
 * surface has no local store: a housesitter's device holds nothing (see
 * `lib/sitter-store.ts`). The row goes into Postgres and reaches every admin
 * screen on the farm by the ordinary pull.
 *
 * **The capability is re-checked here.** Not because the page is unreachable
 * without it — §4.3 is explicit that a hidden button is not a permission check
 * — but because a server action is a POST endpoint with a generated name, and
 * anything that can be posted to has to answer for itself. `chores.complete`
 * is granted to a housesitter *inside their window*, and `can` is what makes
 * the window real: outside it this refuses, whatever the session cookie still
 * says.
 */

export type ChoreActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface SetChoreDoneInput {
  /** The stored row, when the chore has one. */
  readonly taskId?: string | undefined;
  /** The template behind an occurrence nobody has touched yet. */
  readonly templateId?: string | undefined;
  /** The day being ticked, as `yyyy-mm-dd`. */
  readonly day: string;
  readonly done: boolean;
}

/** A ULID off the wire is checked before it is used as one. */
const asUlid = (value: string | undefined): Ulid | undefined =>
  value !== undefined && isUlid(value) ? value : undefined;

export async function setChoreDone(input: SetChoreDoneInput): Promise<ChoreActionResult> {
  const now = new Date();
  const actor = await currentActor();

  if (actor === undefined || !can(actor, "chores.complete", now)) {
    return {
      ok: false,
      // The same sentence for "not signed in", "wrong role", and "your window
      // has closed": three states a caller has no business telling apart.
      error: "You cannot change chores here. Your access may have ended.",
    };
  }

  const taskId = asUlid(input.taskId);
  const templateId = asUlid(input.templateId);
  if (taskId === undefined && templateId === undefined) {
    return { ok: false, error: "That chore is not on the list any more." };
  }

  // Midday, so the day is the day whatever the timezone: parsing a bare date
  // as UTC midnight lands on the day before for anybody west of Greenwich,
  // which is everybody here.
  const date = new Date(`${input.day}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "That day is not a day." };
  }

  const result = await tickChore({
    propertyId: actor.propertyId,
    actorId: actor.id,
    ...(taskId === undefined ? {} : { taskId }),
    ...(templateId === undefined ? {} : { templateId }),
    date,
    at: now,
    done: input.done,
  });

  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/sitter");
  return { ok: true };
}
