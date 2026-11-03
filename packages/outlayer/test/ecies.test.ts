import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, rawPublic, seal } from "../src/ecies.ts";

// Throwaway test vector made with an independent Python (pyca/cryptography) implementation of the
// documented envelope. Not a credential: the recipient scalar exists only for this test.
const VECTOR = {
  recipientScalarHex: "f08e9b066814a84b52f3bb41ea1d392697dc840138640e54b5c295cafb78327e",
  envelopeB64:
    "AW6TXWkgp5dm8ABHap7shp4sQddaDoCt/LMAKuhPwQx9ADAx/38ZgUHiC/rO2ugRlI2mWNZASy0ZklKzp4TKzdpt8gsupEtQiZhvtKt4AU5i/pg8/iIfu746EZ/XXNQaXsLLyekQtkh5fAvs",
  plaintext: '{"SPIKE_SECRET":"test-vector-not-a-real-value"}',
};

function recipient() {
  const pair = generateKeyPairSync("x25519");
  const raw = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  return { scalar: raw, pubHex: rawPublic(pair.publicKey).toString("hex") };
}

describe("keystore envelope", () => {
  it("opens an envelope made by an independent implementation", () => {
    const out = open(Buffer.from(VECTOR.recipientScalarHex, "hex"), VECTOR.envelopeB64);
    expect(out.toString("utf8")).toBe(VECTOR.plaintext);
  });

  it("round-trips and has the documented layout", () => {
    const r = recipient();
    const msg = Buffer.from('{"SPIKE_SECRET":"x"}');
    const env = seal(r.pubHex, msg);
    const blob = Buffer.from(env, "base64");
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 32 + 12 + msg.length + 16);
    expect(open(r.scalar, env).equals(msg)).toBe(true);
  });

  it("uses a fresh ephemeral key and nonce each time", () => {
    const r = recipient();
    expect(seal(r.pubHex, Buffer.from("a"))).not.toBe(seal(r.pubHex, Buffer.from("a")));
  });

  it("refuses a tampered envelope", () => {
    const r = recipient();
    const blob = Buffer.from(seal(r.pubHex, Buffer.from("abc")), "base64");
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 1;
    expect(() => open(r.scalar, blob.toString("base64"))).toThrow();
  });

  it("refuses the wrong recipient", () => {
    const a = recipient();
    const b = recipient();
    expect(() => open(b.scalar, seal(a.pubHex, Buffer.from("abc")))).toThrow();
  });

  it("rejects a malformed public key", () => {
    expect(() => seal("zz", Buffer.from("a"))).toThrow(/64 hex/u);
  });
});
