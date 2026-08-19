import {
  PhotoUploadRefused,
  presignedUploadSchema,
  validate,
  type PhotoUploadTransport,
  type PresignUploadRequest,
  type PresignedUpload,
} from "@galaxy-farm/core";

/**
 * The uploader's transport, over HTTP (spec §4.2).
 *
 * Small on purpose, like `local/transport.ts` beside it. The uploader owns the
 * judgement — what to retry, in what order, how long to wait — and this only
 * carries bytes and classifies what came back.
 *
 * That classification is the one thing here worth arguing about, and the rule
 * is: **4xx counts against the photograph, 5xx does not.** A 422 means this
 * file will never be accepted however many times it is offered, so it has to
 * be retired into the stuck list rather than retried forever; a 500 or a 503
 * means somebody has a bucket to configure or a deploy to fix, and retiring a
 * morning's photographs for that would be punishing them for it.
 */

export interface PhotoTransportOptions {
  /** Overridden in tests; the real thing is `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly presignUrl?: string;
}

export function httpPhotoTransport(options: PhotoTransportOptions = {}): PhotoUploadTransport {
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const presignUrl = options.presignUrl ?? "/api/storage/presign";

  return {
    async presign(request: PresignUploadRequest): Promise<PresignedUpload> {
      const response = await call(presignUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => undefined)) as
          { error?: string } | undefined;
        throw refusalOrOutage(
          response.status,
          detail?.error ?? `${presignUrl} responded ${response.status}`,
        );
      }

      // Parsed, not cast. The `key` on the way back is written onto a record
      // somebody is already looking at, and an absent one would show as a
      // photograph that uploaded to nowhere.
      const parsed = validate(presignedUploadSchema, await response.json());
      if (!parsed.ok) {
        throw new PhotoUploadRefused(502, "The presign response was not in the expected shape");
      }

      return parsed.value;
    },

    async put(upload: PresignedUpload, body: Uint8Array): Promise<void> {
      const response = await call(upload.url, {
        method: upload.method,
        headers: { ...upload.headers },
        // A fresh buffer rather than the view: a `Uint8Array` read out of
        // IndexedDB can sit on a larger backing buffer, and handing that to
        // fetch uploads the whole of it.
        body: body.slice().buffer as ArrayBuffer,
      });

      if (!response.ok) {
        throw refusalOrOutage(response.status, `The bucket answered ${response.status}`);
      }
    },
  };
}

/**
 * A refusal, or something to try again later.
 *
 * Anything below 500 is a verdict on this request and is thrown as a refusal;
 * everything else is thrown as a plain `Error`, which the uploader reads as an
 * outage and defers without counting an attempt.
 */
function refusalOrOutage(status: number, message: string): Error {
  return status < 500 ? new PhotoUploadRefused(status, message) : new Error(message);
}
