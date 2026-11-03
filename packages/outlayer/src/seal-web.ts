/**
 * The keystore envelope (same format as ecies.ts) for browsers. WebCrypto has no ChaCha20-Poly1305, so
 * this uses the audited noble libraries; no Node APIs, no eval. Randomness comes from
 * `crypto.getRandomValues`.
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const VERSION = 0x01;
const INFO = new TextEncoder().encode("outlayer-keystore-v1");

export type Random = (n: number) => Uint8Array;
const secureRandom: Random = (n) => crypto.getRandomValues(new Uint8Array(n));

function hexBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/iu.test(hex)) throw new Error("keystore public key must be 64 hex chars");
  return Uint8Array.from(hex.match(/../gu) ?? [], (h) => parseInt(h, 16));
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Encrypt `plaintext` to the keystore public key (hex); returns the base64 envelope. The ephemeral
 * secret and the derived key are zeroed before returning. `random` exists for known-answer tests only.
 */
export function sealWeb(recipientHex: string, plaintext: Uint8Array, random: Random = secureRandom): string {
  const recipient = hexBytes(recipientHex);
  const eph = random(32);
  const nonce = random(12);
  const shared = x25519.getSharedSecret(eph, recipient);
  const key = hkdf(sha256, shared, undefined, INFO, 32);
  try {
    const body = chacha20poly1305(key, nonce).encrypt(plaintext);
    const out = new Uint8Array(1 + 32 + 12 + body.length);
    out[0] = VERSION;
    out.set(x25519.getPublicKey(eph), 1);
    out.set(nonce, 33);
    out.set(body, 45);
    return base64(out);
  } finally {
    eph.fill(0);
    shared.fill(0);
    key.fill(0);
  }
}
