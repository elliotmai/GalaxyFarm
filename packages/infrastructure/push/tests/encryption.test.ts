import { describe, expect, it } from "vitest";

import { MAX_PAYLOAD_BYTES, encryptPayload } from "../src/encryption.js";
import { decrypt, receiver, recordSizeOf } from "./receiver.js";

/**
 * Payload encryption (RFC 8291).
 *
 * Two kinds of assertion here, and they are worth different things. The
 * round-trips prove the subscriber can read what was sent, against a receiver
 * written from the RFC rather than from the implementation. The frozen vector
 * proves the bytes have not quietly changed shape — it was produced by this
 * code and then decrypted by `http_ece`, the implementation the rest of the
 * ecosystem uses, so it is a check against something other than ourselves.
 */

const SUBSCRIBER = receiver("a".repeat(64), "0123456789abcdef");

/** Fixed so the output is deterministic; nothing in the app passes either. */
const SALT = Buffer.from("galaxy-farm-salt");
const SENDER_KEY = Buffer.from("b".repeat(64), "hex");

const PAYLOAD = JSON.stringify({
  title: "Andromeda is calving",
  body: "Day 279.",
  url: "/admin",
});

/**
 * The same payload, the same salt, the same sender key — and the exact body
 * this produced when it was checked against an independent implementation.
 * A change here is either a bug or a deliberate change to the wire format, and
 * either way it should be looked at rather than absorbed.
 */
const FROZEN =
  "Z2FsYXh5LWZhcm0tc2FsdAAAEABBBHYKBshY3BflxTbegR9xB7-iTU_uOdZK_ZFY7rqrPPJbxO3PNMLAjRaw3NuIHYRwFLhAKusNb8UweMqU884c5M5wQem9IGoDQNhscZH4PTH9tNZOgvrKyQdGbckCxodYubXbO8YHlsQKVDbZDBS4P9bLxGhce8mKKspwqlI68g3FZ0_D3mzcV_3ZfCdrEha6psiX";

describe("encryptPayload", () => {
  it("produces a body the subscriber can read", () => {
    const { body } = encryptPayload(PAYLOAD, SUBSCRIBER);

    expect(decrypt(body, SUBSCRIBER)).toBe(PAYLOAD);
  });

  it("matches the body an independent implementation was checked against", () => {
    const { body } = encryptPayload(PAYLOAD, SUBSCRIBER, {
      salt: SALT,
      senderPrivateKey: SENDER_KEY,
    });

    expect(body.toString("base64url")).toBe(FROZEN);
  });

  it("writes RFC 8188's header — salt, record size, then the sender's key", () => {
    const { body } = encryptPayload(PAYLOAD, SUBSCRIBER, { salt: SALT });

    expect(body.subarray(0, 16)).toEqual(SALT);
    expect(recordSizeOf(body)).toBe(4096);
    // The uncompressed P-256 point, and its length in the byte before it.
    expect(body.readUInt8(20)).toBe(65);
    expect(body.readUInt8(21)).toBe(0x04);
  });

  it("encrypts the same message differently every time", () => {
    // The salt and the sender key are per message. Two identical alerts that
    // produced identical bytes would tell a push service, which can read
    // neither, that they were the same alert.
    const first = encryptPayload(PAYLOAD, SUBSCRIBER).body;
    const second = encryptPayload(PAYLOAD, SUBSCRIBER).body;

    expect(first.equals(second)).toBe(false);
    expect(decrypt(first, SUBSCRIBER)).toBe(decrypt(second, SUBSCRIBER));
  });

  it("cannot be read by a subscriber it was not encrypted for", () => {
    const eavesdropper = receiver("c".repeat(64), "0123456789abcdef");
    const { body } = encryptPayload(PAYLOAD, SUBSCRIBER);

    expect(() => decrypt(body, eavesdropper)).toThrow();
  });

  it("carries a payload right up to the documented limit", () => {
    const long = "x".repeat(MAX_PAYLOAD_BYTES);

    expect(decrypt(encryptPayload(long, SUBSCRIBER).body, SUBSCRIBER)).toBe(long);
  });

  it("refuses a payload past it, rather than letting a push service refuse it", () => {
    expect(() => encryptPayload("x".repeat(MAX_PAYLOAD_BYTES + 1), SUBSCRIBER)).toThrow(
      /at most 3993 bytes/,
    );
  });

  it("refuses keys that are not the sizes a browser gives", () => {
    expect(() =>
      encryptPayload("hi", {
        p256dh: Buffer.alloc(64).toString("base64url"),
        auth: SUBSCRIBER.auth,
      }),
    ).toThrow(/p256dh key should be 65 bytes/);

    expect(() =>
      encryptPayload("hi", {
        p256dh: SUBSCRIBER.p256dh,
        auth: Buffer.alloc(8).toString("base64url"),
      }),
    ).toThrow(/auth secret should be 16 bytes/);
  });
});
