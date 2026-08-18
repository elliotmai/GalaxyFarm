import { NextResponse } from "next/server";

import type { Actor } from "@galaxy-farm/core";
import {
  keyBelongsToProperty,
  presignDownloadSchema,
  presignUploadSchema,
  uploadKeyFor,
  validate,
} from "@galaxy-farm/core";

import { currentActor } from "@/lib/auth";
import { fileStorage, storageConfig } from "@/lib/storage";

/**
 * /api/storage/presign — an address to PUT a photo to, and one to read it back
 * from (spec §4.2, §4.5).
 *
 * Presigned URLs rather than bytes through the app: §4.2 has photos
 * "compressed client-side, queued, uploaded to R2 via presigned URLs", and a
 * phone in a barn uploading through a serverless function would pay for the
 * round trip twice — once on the way up and once on the way across.
 *
 * **The key is derived here, never accepted.** The body names the record the
 * photo belongs to; the property comes from the session, and the two are put
 * together by the same `uploadKeyFor` the device used to fill in the record's
 * key locally. A caller that could name its own key could write into another
 * property's prefix — the identical hole `/api/sync/push` closes by taking the
 * property from the session and never from the payload.
 *
 * A signed URL is a bearer token, so it is short-lived by default (the
 * adapter's fifteen minutes) and is signed for exactly one key, one method,
 * and — through the schema §4.5 clause 2 shares with the client — one size and
 * type of thing.
 */

export const dynamic = "force-dynamic";

/**
 * Storage is not configured.
 *
 * 503 rather than 500, and a sentence naming the unset variables rather than
 * an apology: photographs are already safe on the device and will upload when
 * this is fixed, so this is a configuration message, not a failure of the
 * upload path. A 5xx is also what the device reads as an outage rather than as
 * a verdict on the photograph, so nothing is retired from its queue while
 * somebody goes and sets the variables.
 */
function unconfigured(reason: string): NextResponse {
  return NextResponse.json({ error: reason, kind: "storage-unconfigured" }, { status: 503 });
}

/**
 * Photos are ordinary records, so writing one needs an account that writes.
 *
 * Returns either the actor or the refusal to send back, rather than throwing:
 * a route handler reads better when the unhappy path is a value it returns
 * than when it is an exception something further out has to recognise.
 */
async function writer(): Promise<Actor | NextResponse> {
  const actor = await currentActor();
  if (actor === undefined) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // §4.3: a kiosk's writes are three whitelisted actions through dedicated
  // server actions, and taking photographs is not one of them. A housesitter
  // reads the guide and ticks off chores.
  if (actor.role !== "owner" && actor.role !== "member") {
    return NextResponse.json({ error: "Not permitted to upload" }, { status: 403 });
  }

  return actor;
}

export async function POST(request: Request) {
  const caller = await writer();
  if (caller instanceof NextResponse) return caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  // The same schema the client validated against before it queued anything —
  // §4.5 clause 2 is explicit that data is not trusted for having come from
  // our own client, and a size limit enforced only on the device is a bucket
  // anybody with a signed-in session can fill.
  const parsed = validate(presignUploadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: "That is not something we can store",
        issues: parsed.error.kind === "validation" ? parsed.error.issues : [],
      },
      { status: 422 },
    );
  }

  const config = storageConfig();
  const storage = fileStorage();
  if (storage === undefined)
    return unconfigured(config.ok ? "Storage is unavailable" : config.reason);

  const upload = await storage.presignUpload({
    key: uploadKeyFor(parsed.value, caller.propertyId),
    contentType: parsed.value.contentType,
    bytes: parsed.value.bytes,
  });

  return NextResponse.json({
    url: upload.url,
    method: upload.method,
    headers: upload.headers,
    expiresAt: upload.expiresAt.toISOString(),
    key: upload.key,
  });
}

/**
 * Reading one back.
 *
 * The bucket is private, so even rendering a photo on a screen needs a signed
 * URL. Every role that can see a record can see its photographs — a
 * housesitter looking at the pen board, a customer looking at their own calf —
 * so this asks only for a session, and then for the one thing that actually
 * matters: that the key belongs to the property the caller is signed in to.
 * Keys begin with the property id, so that is answerable without a lookup.
 */
export async function GET(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = validate(presignDownloadSchema, {
    key: url.searchParams.get("key") ?? "",
    ...(url.searchParams.get("downloadAs") === null
      ? {}
      : { downloadAs: url.searchParams.get("downloadAs") }),
  });

  if (!parsed.ok) return NextResponse.json({ error: "A key is required" }, { status: 422 });

  if (!keyBelongsToProperty(parsed.value.key, actor.propertyId)) {
    // 404 rather than 403. Which keys exist in somebody else's property is not
    // a question this endpoint should answer either way.
    return NextResponse.json({ error: "No such object" }, { status: 404 });
  }

  const config = storageConfig();
  const storage = fileStorage();
  if (storage === undefined)
    return unconfigured(config.ok ? "Storage is unavailable" : config.reason);

  const signed = await storage.presignDownload(parsed.value);
  return NextResponse.json({ url: signed });
}
