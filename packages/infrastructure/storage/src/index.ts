/**
 * Object storage (spec §3, §9).
 *
 * Cloudflare R2 now, a NAS or MinIO at the farm later — plain S3 signatures
 * rather than a vendor SDK, so §10's move is a change of endpoint.
 */

export * from "./r2.js";
