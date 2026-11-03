import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROXY_ERRORS, REFUSALS } from "../src/wording.ts";

const md = readFileSync(new URL("../../../docs/WORDING.md", import.meta.url), "utf8");

describe("SDK wording matches docs/WORDING.md", () => {
  it("refusals", () => {
    const rows = [...md.matchAll(/^\| `([a-z_]+)` +\| (.+?) +\|$/gmu)].map((m) => [m[1], m[2]]);
    expect(Object.entries(REFUSALS)).toEqual(rows);
  });
  it("proxy errors", () => {
    const section = md.slice(md.indexOf("## Proxy errors"), md.indexOf("## Forbidden"));
    const rows = [...section.matchAll(/^- \*\*([a-z_]+)\*\*: (.+)$/gmu)].map((m) => [m[1], m[2]]);
    expect(Object.entries(PROXY_ERRORS)).toEqual(rows);
  });
});
