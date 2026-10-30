import { NextResponse } from "next/server";

import { keyBelongsToProperty, MAX_UPLOAD_BYTES } from "@galaxy-farm/core";

import { fileStorage, storageConfig } from "@/lib/storage";
import { storageWriter } from "@/lib/storage-writer";

/**
 * /api/storage/upload — the bytes of one photo, relayed to the bucket
 * (spec §4.2, decision 43).
 *
 * `/api/storage/presign` names the key and hands back this route as the place
 * to PUT to. The device sends the compressed photo here; this signs a bucket
 * URL for the same key and forwards the bytes server to server. Done in the
 * browser, that PUT is cross-origin and needs a CORS rule on the bucket for
 * every origin the app runs on — without one, every photo sat queued on the
 * phone and never arrived.
 *
 * **The same rules as naming the key.** Only an owner or member may write; the
 * key must sit under the caller's own property, so a session cannot write into
 * another farm's prefix by editing the query; and nothing larger than storage
 * accepts gets through, whatever the device claimed when it asked.
 *
 * Refusals from the bucket come back as the same status, so the uploader's
 * refused-or-outage rule (`PhotoUploadRefused` under 500) still holds: a 403
 * from R2 is a photo to set aside, a 502 here is a retry.
 */

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const caller = await storageWriter();
  if (caller instanceof NextResponse) return caller;

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (key === "" || !keyBelongsToProperty(key, caller.propertyId)) {
    // Not "forbidden": whether another property's key exists is not this
    // caller's business.
    return NextResponse.json({ error: "No such upload" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Only photographs are stored" }, { status: 415 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That photo is too large" }, { status: 413 });
  }

  const config = storageConfig();
  const storage = fileStorage();
  if (storage === undefined) {
    return NextResponse.json(
      { error: config.ok ? "Storage is unavailable" : config.reason, kind: "storage-unconfigured" },
      { status: 503 },
    );
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) {
    return NextResponse.json({ error: "The photo arrived empty" }, { status: 400 });
  }
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That photo is too large" }, { status: 413 });
  }

  const signed = await storage.presignUpload({ key, contentType, bytes: body.byteLength });

  let answer: Response;
  try {
    answer = await fetch(signed.url, {
      method: signed.method,
      headers: { ...signed.headers, "Content-Type": contentType },
      body,
    });
  } catch (error) {
    console.error("[storage:upload] the bucket could not be reached", error);
    return NextResponse.json({ error: "The photo store could not be reached" }, { status: 502 });
  }

  if (!answer.ok) {
    console.error("[storage:upload] the bucket refused", answer.status, await answer.text());
    // Passed through below 500 so a refusal stays a refusal; anything else is
    // an outage the device should simply try again later.
    const status = answer.status < 500 ? answer.status : 502;
    return NextResponse.json({ error: `The photo store answered ${answer.status}` }, { status });
  }

  return NextResponse.json({ ok: true, key });
}
