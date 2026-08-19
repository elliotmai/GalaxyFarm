import { createCipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

/**
 * Encrypting a push payload (RFC 8291, over RFC 8188's `aes128gcm`).
 *
 * A push service is a courier that must not be able to read the parcel. The
 * browser generates a keypair and a 16-byte authentication secret when it
 * subscribes and hands us the public halves; everything below turns those into
 * a key only that browser can derive, so the service — Google's, Mozilla's,
 * Apple's — forwards bytes it cannot open. That is not a nicety on a farm app:
 * the payload is "Andromeda is calving" with a link into the herd records.
 *
 * The derivation, in the order it happens:
 *
 * 1. An ephemeral P-256 keypair per message, and ECDH against the browser's
 *    public key. Per message, not per subscription — the salt and the sender
 *    key are the only things making two identical notifications encrypt
 *    differently.
 * 2. HKDF with the *auth secret* as the salt over that shared secret, with
 *    `WebPush: info\\0 ‖ ua_public ‖ as_public` as the info. Binding both public
 *    keys into the info is what stops a substituted key going unnoticed.
 * 3. HKDF again with a random 16-byte salt to get the content encryption key
 *    and the nonce, exactly as RFC 8188 specifies for any `aes128gcm` body.
 *
 * The body is then one record: the plaintext, a `0x02` delimiter saying it is
 * the last one, and the GCM tag — behind a header carrying the salt, the record
 * size, and the sender's public key, which is how the browser knows what to
 * derive against.
 *
 * A single record is deliberate. Splitting into more is only useful for a
 * payload larger than one record, and a payload larger than one record is a
 * notification longer than any push service will accept anyway (`MAX_PAYLOAD`).
 */

/** Everything the browser handed over when it subscribed. */
export interface SubscriptionKeys {
  /** The browser's public key, base64url, 65 bytes. */
  readonly p256dh: string;
  /** The browser's authentication secret, base64url, 16 bytes. */
  readonly auth: string;
}

export interface EncryptOptions {
  /**
   * The 16-byte salt, and the sender's own private key.
   *
   * Both are random per message and both are injectable for exactly one
   * reason: RFC 8291 §5 publishes a worked example, and reproducing it byte for
   * byte is the difference between "this produces bytes" and "this produces the
   * right bytes". Nothing in the app passes either.
   */
  readonly salt?: Buffer;
  readonly senderPrivateKey?: Buffer;
}

/**
 * The record size written into the header.
 *
 * 4096 is what every implementation uses and what the header of a
 * single-record body is expected to carry. The payload cap below is what
 * actually bounds a notification.
 */
const RECORD_SIZE = 4096;

/**
 * The most a payload may be before encryption.
 *
 * RFC 8291 guarantees 4096 octets of encrypted body, and the header (86) plus
 * the delimiter and tag (17) come out of that. A notification anywhere near
 * this is one nobody is reading on a phone screen anyway — the cap exists so
 * an oversized one fails here, with a sentence, rather than as a 413 from a
 * push service.
 */
export const MAX_PAYLOAD_BYTES = 3993;

const HEADER_LENGTH_BYTES = 5;
const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
const SALT_LENGTH = 16;

function hmac(key: Buffer, input: Buffer): Buffer {
  return createHmac("sha256", key).update(input).digest();
}

/**
 * HKDF (RFC 5869) with SHA-256, expanded to at most one block.
 *
 * Every output here is 16, 12 or 32 bytes, so the counter never passes 1 and
 * the general loop would be code no case reaches. Written as the single block
 * it is, rather than a general implementation with an untested branch.
 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/** `Content-Encoding: <name>\0`, RFC 8188's info strings. */
function contentEncodingInfo(name: string): Buffer {
  return Buffer.from(`Content-Encoding: ${name}\0`, "ascii");
}

export interface EncryptedPayload {
  /** The whole `aes128gcm` body: header, then the single record. */
  readonly body: Buffer;
}

/**
 * Encrypt one payload for one subscription.
 *
 * Throws on a payload too large and on keys that are not the sizes the browser
 * gives, because both are programming errors here rather than conditions to
 * degrade through — a subscription row with a 12-byte auth secret is corrupt,
 * and sending it anyway produces an opaque rejection from the push service
 * hours later.
 */
export function encryptPayload(
  payload: string,
  keys: SubscriptionKeys,
  options: EncryptOptions = {},
): EncryptedPayload {
  const plaintext = Buffer.from(payload, "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `A push payload may be at most ${MAX_PAYLOAD_BYTES} bytes and this one is ${plaintext.length}.`,
    );
  }

  const uaPublic = Buffer.from(keys.p256dh, "base64url");
  if (uaPublic.length !== 65) {
    throw new Error(
      `A subscription's p256dh key should be 65 bytes and this one is ${uaPublic.length}.`,
    );
  }

  const authSecret = Buffer.from(keys.auth, "base64url");
  if (authSecret.length !== KEY_LENGTH) {
    throw new Error(
      `A subscription's auth secret should be ${KEY_LENGTH} bytes and this one is ${authSecret.length}.`,
    );
  }

  const sender = createECDH("prime256v1");
  if (options.senderPrivateKey === undefined) sender.generateKeys();
  else sender.setPrivateKey(options.senderPrivateKey);
  const senderPublic = sender.getPublicKey();

  // Step 1 and 2: the shared secret, stretched with the auth secret and bound
  // to both public keys.
  const ikm = hkdf(
    authSecret,
    sender.computeSecret(uaPublic),
    Buffer.concat([Buffer.from("WebPush: info\0", "ascii"), uaPublic, senderPublic]),
    32,
  );

  // Step 3: the content encryption key and nonce, per RFC 8188.
  const salt = options.salt ?? randomBytes(SALT_LENGTH);
  const key = hkdf(salt, ikm, contentEncodingInfo("aes128gcm"), KEY_LENGTH);
  const nonce = hkdf(salt, ikm, contentEncodingInfo("nonce"), NONCE_LENGTH);

  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    // The padding delimiter, and the reason a receiver knows the record ended
    // rather than was truncated.
    cipher.update(Buffer.from([0x02])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const lengths = Buffer.alloc(HEADER_LENGTH_BYTES);
  lengths.writeUInt32BE(RECORD_SIZE, 0);
  lengths.writeUInt8(senderPublic.length, 4);

  return { body: Buffer.concat([salt, lengths, senderPublic, ciphertext]) };
}
