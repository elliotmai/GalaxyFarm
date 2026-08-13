import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth";
import { registryGraph } from "@/lib/registry";

/**
 * /api/registry/search — find an animal anywhere in the associations (§5.2).
 *
 * On the server for two reasons. The graph's credentials must never reach a
 * browser, and the catalogue is a hundred thousand animals — far too many to
 * ship to a phone, which is why this one screen is the exception to the
 * offline-first rule the rest of the site keeps.
 *
 * Read-only by construction: the port this calls has no write on it at all.
 * The crawl is somebody else's data and this app's job is to search it and
 * copy from it, never to edit it.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const graph = registryGraph();
  if (graph === undefined) {
    return NextResponse.json(
      {
        error:
          "The association catalogue is not set up on this server. Add the NEO4J_ settings and restart.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const sex = url.searchParams.get("sex");

  try {
    const result = await graph.search({
      ...(url.searchParams.get("text") === null ? {} : { text: url.searchParams.get("text") as string }),
      ...(url.searchParams.get("association") === null
        ? {}
        : { association: url.searchParams.get("association") as string }),
      ...(sex === "male" || sex === "female" ? { sex } : {}),
      ...(url.searchParams.get("limit") === null
        ? {}
        : { limit: Number(url.searchParams.get("limit")) }),
    });

    return NextResponse.json(result);
  } catch (error) {
    // The adapter puts the graph's own reason in the message, and it is worth
    // passing on: a wrong database name and an expired password look identical
    // from the outside and are fixed in different places.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The catalogue could not be searched." },
      { status: 502 },
    );
  }
}
