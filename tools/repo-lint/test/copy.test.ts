import { describe, expect, it } from "vitest";
import { lintText, isBinary, isSkipped } from "../src/lint.ts";

/** Join fragments so this test file never contains the words it checks for. */
const j = (...parts: string[]): string => parts.join("");

const rulesOf = (text: string, allowed: Parameters<typeof lintText>[3] = []) =>
  lintText("x.md", text, undefined, allowed).map((f) => f.rule);

describe("banned words", () => {
  it.each([
    j("This is ", "sa", "fe"),
    j("Totally ", "Sa", "fe", "!"),
    j("call it ", "sa", "fely"),
    j("type-", "sa", "fe API"),
    j("a ", "sc", "am"),
    j("SC", "AMMER alert"),
  ])("flags %s", (text) => {
    expect(rulesOf(text)).toContain("banned-word");
  });

  it.each(["unsafe_code is forbidden", "#![forbid(unsafe_code)]", "we scan the key", "a sample"])(
    "allows %s",
    (text) => {
      expect(rulesOf(text)).toEqual([]);
    },
  );

  it("reports the line number", () => {
    const f = lintText("doc.md", j("ok\nok\nis ", "sa", "fe"));
    expect(f).toHaveLength(1);
    expect(f[0]?.line).toBe(3);
  });

  it("honours a line marker for that rule only", () => {
    expect(rulesOf(j("word: ", "sa", "fe <!-- copy-lint-allow: banned-word -->"))).toEqual([]);
    expect(rulesOf(j("word: ", "sa", "fe <!-- copy-lint-allow: promo -->"))).toEqual(["banned-word"]);
    expect(rulesOf(j("next line ", "sa", "fe"), [])).toEqual(["banned-word"]);
  });
});

describe("tool attribution labels", () => {
  it.each([
    j("Co-Authored", "-By: Cl", "aude <x@y>"),
    j("co-authored", "-by: GitHub Co", "pilot <x@y>"),
    j("Gene", "rated with [Cl", "aude Code](https://x)"),
    j("gene", "rated by Chat", "GPT"),
    j("This file is A", "I-gene", "rated."),
    j("Wri", "tten by an A", "I"),
    j("no", "reply@anth", "ropic.com"),
    j("https://cl", "aude.ai/code/session_1"),
    j("Cl", "aude-Session: abc"),
    j("Done ", String.fromCodePoint(0x1f916)),
  ])("flags %s", (text) => {
    expect(rulesOf(text)).toContain("ai-label");
  });

  it.each([
    "Paste the MCP block into your Claude Desktop or Cursor config.",
    "Co-authored-by: Patrick Baur <p@example.com>",
    "Generated with pnpm",
    "NEAR AI Cloud private inference",
  ])("allows %s", (text) => {
    expect(rulesOf(text)).toEqual([]);
  });
});

describe("verdict wording", () => {
  it.each([j("Allo", "wed by your rule"), j("BLO", "CKED BY POLICY"), j("Allo", "wed / Blo", "cked")])(
    "flags %s",
    (text) => {
      expect(rulesOf(text)).toContain("verdict-wording");
    },
  );

  it("can be switched off per file", () => {
    expect(rulesOf(j("Blo", "cked by your rule"), ["verdict-wording"])).toEqual([]);
  });

  it("allows lease vocabulary", () => {
    expect(rulesOf("Call refused: endpoint_not_in_lease. Revoke, expiry, receipt.")).toEqual([]);
  });
});

describe("promo", () => {
  it.each([j("buy $RC", "LAW"), j("our price ", "target is 2x")])("flags %s", (text) => {
    expect(rulesOf(text)).toContain("promo");
  });
});

describe("file selection", () => {
  it("skips lockfiles", () => {
    expect(isSkipped("pnpm-lock.yaml")).toBe(true);
    expect(isSkipped("contracts/Cargo.lock")).toBe(true);
    expect(isSkipped("docs/README.md")).toBe(false);
  });

  it("detects binary buffers", () => {
    expect(isBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true);
    expect(isBinary(new TextEncoder().encode("plain text"))).toBe(false);
  });
});
