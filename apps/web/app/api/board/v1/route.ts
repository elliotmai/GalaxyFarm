import { boardCaller, boardJson, UNAVAILABLE } from "@/lib/board-http";
import { boardSnapshot } from "@/lib/board-store";

/**
 * GET /api/board/v1 — the farm's location, today's chores and the
 * housesitter guide, for a connected app (spec §4.3 "Connected apps").
 *
 * `Authorization: Bearer <token>`, minted under Settings → Connected apps and
 * scoped to one property. The chores are the kiosk's Today's Chores board,
 * derived the same way; see `lib/board-api.ts`.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const now = new Date();
  const caller = await boardCaller(request, now);
  if ("response" in caller) return caller.response;

  try {
    return boardJson(await boardSnapshot(caller.token, now));
  } catch (error) {
    console.error("[board:snapshot]", error);
    return UNAVAILABLE();
  }
}
