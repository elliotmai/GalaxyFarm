import { createHash, createHmac } from "node:crypto";

import type {
  DownloadRequest,
  FileStorage,
  PresignedUpload,
  UploadRequest,
} from "@galaxy-farm/core";

/**
 * Cloudflare R2 (spec §3, §9).
 *
 * S3-compatible, which is the whole reason it was chosen: §10's move to a NAS
 * or MinIO at the farm is a change of endpoint. So this signs plain AWS
 * Signature Version 4 rather than using a Cloudflare SDK — the same code works
 * against R2, MinIO, and S3 itself, and adding a vendor SDK here would undo the
 * portability the choice was made for.
 *
 * Query-string signing, so the browser can PUT the bytes directly with no
 * headers to remember. §4.2: the record stores the key immediately and renders
 * a placeholder until the upload lands.
 */

export interface R2Options {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Overridable for MinIO, S3, or a test double. */
  readonly endpoint?: string;
  /** R2 has no regions; SigV4 insists on one and `auto` is what R2 expects. */
  readonly region?: string;
  /** Injected so tests are deterministic and so §4.2's clock stays testable. */
  readonly now?: () => Date;
}

export const DEFAULT_EXPIRY_SECONDS = 900;
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac("sha256", key).update(value, "utf8").digest();

/** ISO8601 basic format, which is what SigV4 wants: `20260811T120000Z`. */
export function amzDate(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Percent-encode for a signed URL.
 *
 * `encodeURIComponent` leaves `!'()*` alone and SigV4 does not, so a filename
 * with a bracket in it would sign one way and be sent another — a 403 that
 * looks like a credentials problem and is not.
 */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Each path segment is encoded; the separators are not. */
export function encodeKey(key: string): string {
  return key.split("/").map(rfc3986).join("/");
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), "aws4_request");
}

export interface SignOptions {
  readonly method: "GET" | "PUT" | "DELETE";
  readonly host: string;
  readonly path: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly at: Date;
  readonly expiresIn: number;
  readonly extraQuery?: Readonly<Record<string, string>>;
}

/**
 * A presigned URL, signed by hand.
 *
 * Exported so the signature can be tested against known inputs without a
 * network or a bucket — the failure mode of a signer is a 403 hours later, and
 * that is not something to discover from a phone in a barn.
 */
export function presign(options: SignOptions): string {
  const service = "s3";
  const stamp = amzDate(options.at);
  const dateStamp = stamp.slice(0, 8);
  const scope = `${dateStamp}/${options.region}/${service}/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${options.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(options.expiresIn),
    "X-Amz-SignedHeaders": "host",
    ...options.extraQuery,
  };

  // Canonical query strings are sorted by encoded key, and the sort is part of
  // what is signed — an unsorted one produces a signature the server will not
  // reproduce.
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${rfc3986(key)}=${rfc3986(query[key] as string)}`)
    .join("&");

  const canonicalRequest = [
    options.method,
    options.path,
    canonicalQuery,
    `host:${options.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(
    signingKey(options.secretAccessKey, dateStamp, options.region, service),
    toSign,
  ).toString("hex");

  return `https://${options.host}${options.path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function r2Storage(options: R2Options): FileStorage {
  const endpoint = options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`;
  const host = new URL(endpoint).host;
  const region = options.region ?? "auto";
  const now = options.now ?? (() => new Date());

  const sign = (
    method: SignOptions["method"],
    key: string,
    expiresIn: number,
    extraQuery?: Record<string, string>,
  ): { url: string; expiresAt: Date } => {
    const at = now();
    const url = presign({
      method,
      host,
      path: `/${options.bucket}/${encodeKey(key)}`,
      region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      at,
      expiresIn,
      ...(extraQuery === undefined ? {} : { extraQuery }),
    });

    return { url, expiresAt: new Date(at.getTime() + expiresIn * 1000) };
  };

  return {
    name: "cloudflare-r2",

    async presignUpload(request: UploadRequest): Promise<PresignedUpload> {
      const expiresIn = request.expiresIn ?? DEFAULT_EXPIRY_SECONDS;
      const { url, expiresAt } = sign("PUT", request.key, expiresIn);

      return {
        url,
        method: "PUT",
        // Content-Type is sent but not signed: signing it would mean a browser
        // that normalises the header differently gets a 403 it cannot explain.
        headers: { "Content-Type": request.contentType },
        expiresAt,
        key: request.key,
      };
    },

    async presignDownload(request: DownloadRequest): Promise<string> {
      const extra =
        request.downloadAs === undefined
          ? undefined
          : {
              "response-content-disposition": `attachment; filename="${request.downloadAs.replace(/"/g, "")}"`,
            };

      return sign("GET", request.key, request.expiresIn ?? DEFAULT_EXPIRY_SECONDS, extra).url;
    },

    async delete(key: string): Promise<void> {
      const { url } = sign("DELETE", key, 60);
      const response = await fetch(url, { method: "DELETE" });
      // 404 is success here: §4.5's purge is meant to be idempotent, and an
      // object already gone is the state the caller asked for.
      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 delete failed: ${response.status} ${response.statusText}`);
      }
    },
  };
}
