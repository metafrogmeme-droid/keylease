import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { open, rawPublic, x25519Private, x25519Public } from "../src/ecies.ts";
import { sealWeb } from "../src/seal-web.ts";

function recipient() {
  const pair = generateKeyPairSync("x25519");
  const raw = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  return { scalar: raw, pubHex: rawPublic(pair.publicKey).toString("hex") };
}

describe("browser keystore envelope (noble)", () => {
  it("is opened by the node:crypto implementation", () => {
    const r = recipient();
    const msg = new TextEncoder().encode('{"KL_API_KEY":"x"}');
    const env = sealWeb(r.pubHex, msg);
    expect(open(r.scalar, env).toString("utf8")).toBe('{"KL_API_KEY":"x"}');
    const blob = Buffer.from(env, "base64");
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 32 + 12 + msg.length + 16);
  });

  it("matches node:crypto byte for byte for the same ephemeral key and nonce", () => {
    const r = recipient();
    const eph = Buffer.alloc(32, 7);
    const nonce = Buffer.alloc(12, 9);
    const draws = [Uint8Array.from(eph), Uint8Array.from(nonce)];
    const msg = Buffer.from('{"KL_API_KEY":"known answer"}');
    const web = sealWeb(r.pubHex, msg, () => draws.shift() ?? new Uint8Array());

    const privateKey = x25519Private(eph);
    const shared = diffieHellman({ privateKey, publicKey: x25519Public(Buffer.from(r.pubHex, "hex")) });
    const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), "outlayer-keystore-v1", 32));
    const c = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    const body = Buffer.concat([c.update(msg), c.final(), c.getAuthTag()]);
    const ephPub = rawPublic(createPublicKey(privateKey));
    const expected = Buffer.concat([Buffer.from([1]), ephPub, nonce, body]).toString("base64");
    expect(web).toBe(expected);
  });

  it("zeroes the ephemeral secret it was given", () => {
    const r = recipient();
    const eph = new Uint8Array(32).fill(5);
    sealWeb(r.pubHex, new Uint8Array([1]), (n) => (n === 32 ? eph : new Uint8Array(12)));
    expect(eph.every((b) => b === 0)).toBe(true);
  });

  it("uses fresh randomness each time and refuses a bad public key", () => {
    const r = recipient();
    expect(sealWeb(r.pubHex, new Uint8Array([1]))).not.toBe(sealWeb(r.pubHex, new Uint8Array([1])));
    expect(() => sealWeb("zz", new Uint8Array([1]))).toThrow(/64 hex/u);
  });

  it("keeps the browser entry free of Node APIs", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/from "node:/u);
      for (const m of src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from "\.\/([\w-]+\.ts)"/gmu))
        if (m[1]) visit(m[1]);
    };
    visit("web.ts");
    expect([...seen].sort()).toEqual(["conditions.ts", "seal-web.ts", "secrets.ts", "web.ts"]);
  });
});
