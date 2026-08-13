import { NextResponse } from "next/server";

import { MAX_CATALOGUE_GENERATIONS } from "@galaxy-farm/module-cattle";

import { currentActor } from "@/lib/auth";
import { registryGraph } from "@/lib/registry";

/**
 * /api/registry/animal — one animal and, on request, what is above it (§5.2).
 *
 * The pedigree walk is the one query the graph is genuinely better at than a
 * table, and it is what makes "bring this bull across with four generations
 * behind him" a single request rather than thirty.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const graph = registryGraph();
  if (graph === undefined) {
    return NextResponse.json({ error: "The association catalogue is not set up." }, { status: 503 });
  }

  const url = new URL(request.url);
  const association = url.searchParams.get("association");
  const regNumber = url.searchParams.get("regNumber");
  if (association === null || regNumber === null) {
    return NextResponse.json(
      { error: "Ask for an animal by its association and registration number." },
      { status: 400 },
    );
  }

  const generations = Number(url.searchParams.get("generations") ?? 0);

  try {
    const [animal, pedigree] = await Promise.all([
      graph.get(association, regNumber),
      generations > 0
        ? graph.pedigree(association, regNumber, Math.min(generations, MAX_CATALOGUE_GENERATIONS))
        : Promise.resolve([]),
    ]);

    if (animal === undefined) {
      return NextResponse.json(
        { error: `${association} ${regNumber} is not in the catalogue.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ animal, pedigree });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The catalogue could not be read." },
      { status: 502 },
    );
  }
}
