/**
 * OutLayer keystore envelope, written from its documented format:
 * base64(0x01 | ephemeral X25519 public key (32) | nonce (12) | ChaCha20-Poly1305 ciphertext + tag),
 * key = HKDF-SHA256(shared secret, no salt, info "outlayer-keystore-v1", 32 bytes).
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

const VERSION = 0x01;
const INFO = "outlayer-keystore-v1";
// DER prefixes for raw 32-byte X25519 keys (RFC 8410).
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export function x25519Public(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error("X25519 public key must be 32 bytes");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export function x25519Private(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error("X25519 private key must be 32 bytes");
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
}

export function rawPublic(key: KeyObject): Buffer {
  return key.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length);
}

function deriveKey(shared: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), INFO, 32));
}

/** Encrypt `plaintext` to the keystore public key (hex). Returns the base64 envelope. */
export function seal(recipientHex: string, plaintext: Uint8Array): string {
  if (!/^[0-9a-f]{64}$/iu.test(recipientHex)) throw new Error("keystore public key must be 64 hex chars");
  const eph = generateKeyPairSync("x25519");
  const key = deriveKey(
    diffieHellman({ privateKey: eph.privateKey, publicKey: x25519Public(Buffer.from(recipientHex, "hex")) }),
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from([VERSION]), rawPublic(eph.publicKey), nonce, body]).toString("base64");
}

/** Decrypt an envelope with the recipient's raw private key. Used by tests only. */
export function open(recipientPrivate: Uint8Array, envelope: string): Buffer {
  const blob = Buffer.from(envelope, "base64");
  if (blob.length < 1 + 32 + 12 + 16 || blob[0] !== VERSION) throw new Error("bad envelope");
  const eph = blob.subarray(1, 33);
  const nonce = blob.subarray(33, 45);
  const body = blob.subarray(45, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const key = deriveKey(
    diffieHellman({ privateKey: x25519Private(recipientPrivate), publicKey: x25519Public(eph) }),
  );
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
