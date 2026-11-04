/**
 * The page CSP (style-src 'self') blocks the inline <style> ethereum-wallets injects for its MetaMask
 * confirm box, so app/ethereum-wallets.css ships the same rules from this origin. Fails if the installed
 * library's styles drift from the copy, or if the copy stops being loaded.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { policy } from "../lib/csp.ts";

const css = fs.readFileSync(new URL("../app/ethereum-wallets.css", import.meta.url), "utf8");
const lib = fs.readFileSync(
  createRequire(import.meta.url).resolve("@near-wallet-selector/ethereum-wallets"),
  "utf8",
);
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`markers ${a} / ${b} not found`);
  return s.slice(i + a.length, j);
};

describe("ethereum-wallets modal styles", () => {
  it("the page CSP still refuses inline styles, which is why the copy is needed", () => {
    expect(policy([])).toContain("style-src 'self';");
    expect(policy([])).not.toContain("unsafe-inline");
  });

  it("app/ethereum-wallets.css holds the installed library's modalStyles verbatim", () => {
    const m = /const modalStyles = `([\s\S]*?)`;/.exec(lib);
    expect(m?.[1]).toBeTruthy();
    const copy = between(
      css,
      "/* BEGIN ethereum-wallets 10.1.4 modalStyles */",
      "/* END ethereum-wallets 10.1.4 modalStyles */",
    );
    expect(copy).toBe(m?.[1]);
    // The rules that make it an overlay instead of a block at the end of the page.
    expect(copy).toMatch(/\.ethereum-wallet-modal-backdrop \{\s*position: fixed;/);
    expect(copy).toMatch(/\.ethereum-wallet-modal-wrapper \{\s*position: fixed;/);
  });

  it("the root layout loads it", () => {
    const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('import "./ethereum-wallets.css";');
  });
});
