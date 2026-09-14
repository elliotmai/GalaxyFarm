"use server";

import { revalidatePath } from "next/cache";

import { can, type Ulid } from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";
import { fetchTravel, fetchTrips, WanderError, type WanderTripSummary } from "@/lib/wander-client";
import {
  connectionFor,
  disconnect as forgetConnection,
  recordPull,
  saveConnection,
  setLinkedTrip,
  tokenFor,
} from "@/lib/wander-store";
import { upsertTripFromWander } from "@/lib/wander-trip-writer";

/**
 * Connecting the farm to Wander (spec §5.10, §4.3).
 *
 * Server actions rather than `useMutations`, for the reason `device-actions.ts`
 * beside it gives: `wander_connections` never reaches a local store, so the
 * screen reads on the server and re-reads after each write.
 *
 * **The token is write-only from the browser's side.** It arrives once, in
 * `connect`, and nothing here ever sends it back — `connectionFor` has no
 * `token` field at all, and the two calls that need the secret (`listTrips`,
 * `pull`) fetch it on the server and use it there. A screen that could read it
 * back is a screen one `console.log` away from putting somebody's Wander
 * credential in a browser extension's reach.
 *
 * `integrations.manage` is owner-only (§4.3). Re-checked here rather than only
 * in the UI for the reason every sibling file repeats: a server action is a
 * POST endpoint with a generated name.
 */

export type ActionResult =
  { readonly ok: true; readonly message: string } | { readonly ok: false; readonly error: string };

export type TripsResult =
  | { readonly ok: true; readonly trips: readonly WanderTripSummary[] }
  | { readonly ok: false; readonly error: string };

const REFUSED = "Only an owner can change how the farm connects to Wander.";

async function connectingActor() {
  const actor = await currentActor();
  if (actor === undefined) return undefined;
  return can(actor, "integrations.manage", new Date()) ? actor : undefined;
}

function revalidated(): void {
  revalidatePath("/admin/housesitter");
}

/** Everything a caller is allowed to know about the link. Never the token. */
export async function wanderConnection(propertyId: Ulid) {
  const actor = await connectingActor();
  if (actor === undefined || actor.propertyId !== propertyId) return undefined;
  return connectionFor(propertyId);
}

export async function connect(token: string, baseUrl: string): Promise<ActionResult> {
  const actor = await connectingActor();
  if (actor === undefined) return { ok: false, error: REFUSED };

  const trimmedToken = token.trim();
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (trimmedToken === "") return { ok: false, error: "Paste the token from Wander." };
  if (!/^https:\/\/[^\s]+$/.test(trimmedUrl)) {
    // https only, and checked here rather than trusted from a form: the token
    // is sent on every call, and over http it is sent in the clear.
    return { ok: false, error: "The Wander functions URL must start with https://." };
  }

  // Proven before it is stored, so "connected" never means "we wrote down
  // something that does not work" — the next thing this screen does is show a
  // trip list, and a bad token there reads as the integration being broken
  // rather than the token being wrong.
  try {
    await fetchTrips(trimmedUrl, trimmedToken);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof WanderError ? error.message : "Could not reach Wander.",
    };
  }

  await saveConnection(actor.propertyId, trimmedToken, trimmedUrl);
  revalidated();
  return { ok: true, message: "Connected to Wander. Pick which trip the farm follows." };
}

export async function listTrips(): Promise<TripsResult> {
  const actor = await connectingActor();
  if (actor === undefined) return { ok: false, error: REFUSED };

  const held = await tokenFor(actor.propertyId);
  if (held === undefined) return { ok: false, error: "Not connected to Wander yet." };

  try {
    return { ok: true, trips: await fetchTrips(held.functionsBaseUrl, held.token) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof WanderError ? error.message : "Could not reach Wander.",
    };
  }
}

/** Follow a trip, and pull it straight away so the board is not empty. */
export async function linkTrip(tripId: string, tripName: string): Promise<ActionResult> {
  const actor = await connectingActor();
  if (actor === undefined) return { ok: false, error: REFUSED };
  if (tripId.trim() === "") return { ok: false, error: "Pick a trip." };

  await setLinkedTrip(actor.propertyId, tripId.trim(), tripName.trim());
  return pull();
}

export async function pull(): Promise<ActionResult> {
  const actor = await connectingActor();
  if (actor === undefined) return { ok: false, error: REFUSED };

  const held = await tokenFor(actor.propertyId);
  if (held === undefined) return { ok: false, error: "Not connected to Wander yet." };
  if (held.tripId === undefined) return { ok: false, error: "No trip is linked yet." };

  try {
    const travel = await fetchTravel(held.functionsBaseUrl, held.token, held.tripId);
    const written = await upsertTripFromWander(actor.propertyId, held.tripId, travel);

    await recordPull(actor.propertyId);
    revalidated();

    const dropped =
      travel.droppedLegs === 0
        ? ""
        : ` ${travel.droppedLegs} leg${travel.droppedLegs === 1 ? "" : "s"} had no usable time and ${travel.droppedLegs === 1 ? "was" : "were"} left off.`;

    return {
      ok: true,
      message: `${written.name} pulled — ${written.legs.length} leg${written.legs.length === 1 ? "" : "s"}.${dropped}`,
    };
  } catch (error) {
    const message = error instanceof WanderError ? error.message : "Could not reach Wander.";
    await recordPull(actor.propertyId, message);
    revalidated();
    return { ok: false, error: message };
  }
}

export async function disconnect(): Promise<ActionResult> {
  const actor = await connectingActor();
  if (actor === undefined) return { ok: false, error: REFUSED };

  await forgetConnection(actor.propertyId);
  revalidated();
  return {
    ok: true,
    message: "Disconnected. The trips already pulled stay on the farm's records.",
  };
}
