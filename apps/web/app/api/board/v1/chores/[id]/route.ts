import { revalidatePath } from "next/cache";

import { boardCaller, boardJson, NOT_FOUND, UNAVAILABLE } from "@/lib/board-http";
import { tickBoardChore } from "@/lib/board-store";

/**
 * POST /api/board/v1/chores/{id} — tick one of today's chores done or undone
 * from a connected app (spec §4.3 "Connected apps", §4.4).
 *
 * `{ "done": true | false }`. `id` is a chore id from `GET /api/board/v1`.
 * The write is the kiosk's own — `tickChore` through `applyPushAndMark` — so
 * it lands in the sync audit attributed to the app, bumps the change stamp,
 * and reaches every screen on the farm on its next pull.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const now = new Date();
  const caller = await boardCaller(request, now);
  if ("response" in caller) return caller.response;

  const { id: raw } = await context.params;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return NOT_FOUND();
  }
  if (id === "" || id.length > 200) return NOT_FOUND();

  let done: unknown;
  try {
    done = ((await request.json()) as Record<string, unknown> | null)?.["done"];
  } catch {
    done = undefined;
  }
  if (typeof done !== "boolean") {
    return boardJson(
      { error: "bad_request", detail: 'Send { "done": true } or { "done": false }.' },
      400,
    );
  }

  let outcome: Awaited<ReturnType<typeof tickBoardChore>>;
  try {
    outcome = await tickBoardChore(caller.token, id, done, now);
  } catch (error) {
    console.error("[board:tick]", error);
    return UNAVAILABLE();
  }

  if (outcome.kind === "not_found") return NOT_FOUND();
  if (outcome.kind === "refused") {
    return boardJson({ error: "refused", detail: outcome.reason }, 409);
  }

  // The same pages the kiosk's own tick refreshes. After the write, and never
  // allowed to turn a saved tick into an error.
  try {
    revalidatePath("/kiosk/chores");
    revalidatePath("/kiosk/housesitter");
  } catch (error) {
    console.error("[board:revalidate]", error);
  }
  return boardJson({ ok: true, done: outcome.done });
}
