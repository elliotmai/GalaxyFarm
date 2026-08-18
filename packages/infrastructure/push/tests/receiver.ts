import { createDecipheriv, createECDH, createHmac } from "node:crypto";

/**
 * The other half of RFC 8291 — a browser, in about forty lines.
 *
 * The encryption in `src/encryption.ts` has one honest test: can the device it
 * was encrypted for read it? Asserting on the bytes alone proves that the code
 * does what it did yesterday, which is a different and much weaker claim. So
 * this is the receiving side, written from the RFC rather than from the
 * implementation, and every test that matters runs one against the other.
 *
 * Only for tests. Nothing in the app ever decrypts a push payload — that
 * happens in a service worker, on somebody's phone, with a private key this
 * server has never seen.
 */

function hmac(key: Buffer, input: Buffer): Buffer {
  return createHmac("sha256", key).update(input).digest();
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/** A subscriber: its keypair and the auth secret it shared. */
export interface Receiver {
  readonly ecdh: ReturnType<typeof createECDH>;
  readonly p256dh: string;
  readonly auth: string;
}

export function receiver(privateKeyHex: string, authSecret: string): Receiver {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKeyHex, "hex"));

  return {
    ecdh,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.from(authSecret).toString("base64url"),
  };
}

/** Read an `aes128gcm` body the way the browser does, and throw if it does not verify. */
export function decrypt(body: Buffer, subscriber: Receiver): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);

  const authSecret = Buffer.from(subscriber.auth, "base64url");
  const ikm = hkdf(
    authSecret,
    subscriber.ecdh.computeSecret(senderPublic),
    Buffer.concat([
      Buffer.from("WebPush: info\0", "ascii"),
      subscriber.ecdh.getPublicKey(),
      senderPublic,
    ]),
    32,
  );

  const key = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);

  // The last byte is the record delimiter, not content.
  return plaintext.subarray(0, plaintext.length - 1).toString("utf8");
}

/** The record size the header claims, so a test can assert on it by name. */
export function recordSizeOf(body: Buffer): number {
  return body.readUInt32BE(16);
}
