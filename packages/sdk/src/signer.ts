/**
 * Holder signers for signed calls (E-021): an EVM or Solana holder signs, a relayer account sends. A
 * signer only ever signs the text the contract's `signed_call_message` view returns; it never sees a
 * transaction. Wallets plug in by implementing `HolderSigner`; `evmKeySigner` / `solanaKeySigner` are for
 * agents and tests with a throwaway key read from env.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";

export interface EvmSigner {
  readonly kind: "evm";
  /** The 0x address, in any letter case. */
  readonly address: string;
  /** EIP-191 `personal_sign` of `text`: `0x` + 130 hex (r, s, v = 27/28), as wallets return it. */
  signMessage(text: string): Promise<string>;
}

export interface SolanaSigner {
  readonly kind: "solana";
  /** The base58 address (ed25519 public key). */
  readonly address: string;
  /** ed25519 over the UTF-8 bytes of `text` (Solana `signMessage`), base58. */
  signMessage(text: string): Promise<string>;
}

export type HolderSigner = EvmSigner | SolanaSigner;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** An EVM signer from a `0x` + 64 hex private key. Keep the key in env; it is never printed. */
export function evmKeySigner(privateKey: string): EvmSigner {
  if (!privateKey.startsWith("0x")) throw new Error("KeyLease SDK: an EVM private key is 0x + 64 hex");
  if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey))
    throw new Error("KeyLease SDK: an EVM private key is a 32-byte 0x hex string");
  const secret = hexToBytes(privateKey.slice(2));
  const pub = secp256k1.getPublicKey(secret, false); // 65 bytes, 0x04 || x || y
  const address = `0x${bytesToHex(keccak_256(pub.subarray(1)).subarray(12))}`;
  return {
    kind: "evm",
    address,
    signMessage(text) {
      const body = utf8(text);
      const prefix = utf8(`\x19Ethereum Signed Message:\n${String(body.length)}`);
      const digest = keccak_256(new Uint8Array([...prefix, ...body]));
      // 'recovered' is the recovery bit followed by r and s; Ethereum wants r, s, v = 27 + bit.
      const sig = secp256k1.sign(digest, secret, { prehash: false, lowS: true, format: "recovered" });
      const rs = sig.subarray(1);
      const v = 27 + (sig[0] ?? 0);
      return Promise.resolve(`0x${bytesToHex(rs)}${v.toString(16)}`);
    },
  };
}

/** A Solana signer from a base58 secret: the 32-byte seed or the 64-byte keypair (seed + public key). */
export function solanaKeySigner(secret: string): SolanaSigner {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(secret);
  } catch {
    throw new Error("KeyLease SDK: a Solana secret key is base58");
  }
  if (bytes.length !== 32 && bytes.length !== 64)
    throw new Error("KeyLease SDK: a Solana secret key is 32 or 64 bytes of base58");
  const seed = bytes.subarray(0, 32);
  const address = base58.encode(ed25519.getPublicKey(seed));
  return {
    kind: "solana",
    address,
    signMessage: (text) => Promise.resolve(base58.encode(ed25519.sign(utf8(text), seed))),
  };
}
