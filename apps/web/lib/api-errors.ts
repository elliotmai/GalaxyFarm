import { NextResponse } from "next/server";

import { describeDrift, schemaDrift } from "@galaxy-farm/infra-db";

import { database } from "@/lib/credential-store";
import { SCHEMA_CODES, sqlState } from "@/lib/database-failure";

/**
 * What to say when a sync request fails (spec §4.2).
 *
 * The app survives a broken server — every read is local — so a failing sync
 * is invisible from the barn. That makes the *shape* of the failure the whole
 * problem: work piles up in an outbox nobody has been told is not draining.
 *
 * The route used to let a database error escape as a bare 500 with no body.
 * That happened for real, from a deploy whose migrations had not been run, and
 * the only evidence was a red line in a browser console. So a failure here
 * answers the first question somebody will ask, which is always "what do I do
 * about it".
 */

export async function syncErrorResponse(error: unknown, operation: string): Promise<NextResponse> {
  const message = error instanceof Error ? error.message : String(error);
  const state = sqlState(error);

  // Logged whatever happens: a 500 the client shows and nothing the server
  // recorded is a failure that can only be diagnosed by reproducing it.
  console.error(`[sync:${operation}] ${state ?? "error"}: ${message}`);

  if (state !== undefined && SCHEMA_CODES.has(state)) {
    // Only worth the extra round trip once we know it is a schema error.
    try {
      const explanation = describeDrift(await schemaDrift(database()));
      if (explanation !== undefined) {
        console.error(`[sync:${operation}] ${explanation}`);
        return NextResponse.json({ error: explanation, kind: "schema-drift" }, { status: 503 });
      }
    } catch {
      // The drift check needs the same database that just failed. If it cannot
      // run either, fall through — the original error is the useful one.
    }
  }

  return NextResponse.json(
    { error: `Sync ${operation} failed: ${message}`, kind: "server-error" },
    { status: 500 },
  );
}
