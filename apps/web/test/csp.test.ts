import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes, policy, withCsp } from "../lib/csp.ts";

const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const PAGE =
  '<!DOCTYPE html><html><head><meta charSet="utf-8"/><script src="/_next/a.js" async=""></script></head>' +
  "<body><script>self.__next_f=[]</script><script>a()</script><script>a()</script><script> </script></body></html>";

describe("CSP for the static export (T8)", () => {
  it("hashes each distinct inline script and skips external and empty ones", () => {
    expect(inlineScriptHashes(PAGE)).toEqual([sha("self.__next_f=[]"), sha("a()")]);
  });

  it("allows scripts only from this origin and listed hashes, nothing inline-unsafe", () => {
    const p = policy(["'sha256-x'"], {
      connect: ["'self'", "https://rpc.testnet.near.org"],
      frame: [],
      img: [],
    });
    expect(p).toContain("default-src 'none'");
    expect(p).toContain("script-src 'self' 'sha256-x'");
    expect(p).toContain("connect-src 'self' https://rpc.testnet.near.org");
    expect(p).not.toContain("outlayer");
    expect(p).not.toMatch(/unsafe-(inline|eval)/);
    expect(p).toContain("base-uri 'none'");
    expect(p).toContain("form-action 'none'");
  });

  it("puts the policy right after the charset and before any script", () => {
    const out = withCsp(PAGE);
    expect(out.indexOf("Content-Security-Policy")).toBeGreaterThan(out.indexOf('charSet="utf-8"'));
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script"));
    expect(out).toContain(sha("a()"));
  });

  it("refuses a page without <head> or one that already has a policy", () => {
    expect(() => withCsp("<html><body></body></html>")).toThrow(/no <head>/);
    expect(() => withCsp(withCsp(PAGE))).toThrow(/already has a CSP/);
  });
});
