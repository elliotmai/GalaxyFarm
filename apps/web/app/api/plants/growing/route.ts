import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth";
import { plantGrowing } from "@/lib/plant-growing";

/**
 * /api/plants/growing?name=&scientific= — how a picked plant is grown (§5.5).
 *
 * Asked by the crop and variety forms after a plant the built-in table does
 * not know is picked from the search. Session-checked and server-side like
 * `/api/plants/search`; see `lib/plant-growing.ts` for the sources.
 *
 * Always 200 for a signed-in request with a name: nothing known is an empty
 * `growing`, and the form keeps whatever was typed.
 */

export const dynamic = "force-dynamic";

const MAX_NAME = 160;

export async function GET(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const name = (params.get("name") ?? "").trim().slice(0, MAX_NAME);
  const scientific = (params.get("scientific") ?? "").trim().slice(0, MAX_NAME);
  if (name === "" && scientific === "") {
    return NextResponse.json({ growing: {}, source: "none", online: true });
  }

  return NextResponse.json(await plantGrowing(name, scientific), {
    headers: { "cache-control": "private, max-age=3600" },
  });
}
