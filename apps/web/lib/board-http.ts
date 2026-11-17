import { retryOnDroppedConnection } from "@galaxy-farm/infra-db";

import type { ApiToken } from "@/lib/api-token-store";
import { authorizeBoardRequest } from "@/lib/board-store";

/**
 * The board API's HTTP edges (spec §4.3 "Connected apps"), shared by its two
 * route handlers so both refuse in exactly the same words.
 *
 * Server-to-server only: the caller is another app's function, never a
 * browser, so there is no CORS and no cookie — a bearer token or nothing.
 */

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export function boardJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const UNAUTHORIZED = () => boardJson({ error: "unauthorized" }, 401);
export const NOT_FOUND = () => boardJson({ error: "not_found" }, 404);
export const UNAVAILABLE = () => boardJson({ error: "unavailable" }, 503);

/**
 * The token, or the response to send instead.
 *
 * A database that cannot be reached is a 503, not a 401: telling a caller
 * its perfectly good token is bad would have it alarm somebody for nothing.
 */
export async function boardCaller(
  request: Request,
  now: Date,
): Promise<{ readonly token: ApiToken } | { readonly response: Response }> {
  try {
    const token = await retryOnDroppedConnection(() =>
      authorizeBoardRequest(request.headers.get("authorization"), now),
    );
    return token === undefined ? { response: UNAUTHORIZED() } : { token };
  } catch (error) {
    console.error("[board:auth]", error);
    return { response: UNAVAILABLE() };
  }
}
