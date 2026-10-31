import { NextResponse } from "next/server";

import type { Actor } from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";

/**
 * Who may put a photo in the bucket (spec §4.3).
 *
 * Shared by the two routes on the upload path — the one that names the key and
 * the one the bytes go through — so the rule cannot drift between them. A
 * kiosk's writes are three whitelisted actions through dedicated server
 * actions, and taking photographs is not one of them; a housesitter reads the
 * guide and ticks off chores.
 */
export async function storageWriter(): Promise<Actor | NextResponse> {
  const actor = await currentActor();
  if (actor === undefined) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (actor.role !== "owner" && actor.role !== "member") {
    return NextResponse.json({ error: "Not permitted to upload" }, { status: 403 });
  }

  return actor;
}
