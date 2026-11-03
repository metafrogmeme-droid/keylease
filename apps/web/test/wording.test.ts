import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROXY_ERRORS, REFUSALS, refusalIn } from "../lib/wording.ts";

const md = readFileSync(new URL("../../../docs/WORDING.md", import.meta.url), "utf8");

describe("web wording matches docs/WORDING.md", () => {
  it("has every refusal code with the same sentence", () => {
    const rows = [...md.matchAll(/^\| `([a-z_]+)` +\| (.+?) +\|$/gmu)].map((m) => [m[1], m[2]]);
    expect(rows.length).toBe(9);
    expect(Object.entries(REFUSALS)).toEqual(rows);
  });

  it("has every proxy error with the same sentence", () => {
    const section = md.slice(md.indexOf("## Proxy errors"), md.indexOf("## Forbidden"));
    const rows = [...section.matchAll(/^- \*\*([a-z_]+)\*\*: (.+)$/gmu)].map((m) => [m[1], m[2]]);
    expect(Object.entries(PROXY_ERRORS)).toEqual(rows);
  });

  it("finds a refusal inside a wallet error, ignores other panics", () => {
    const err =
      'Error: {"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: quota_used: All calls in this lease are used; ask the key owner for more calls."}}}}';
    expect(refusalIn(err)).toEqual({
      code: "quota_used",
      hint: "All calls in this lease are used; ask the key owner for more calls.",
    });
    expect(refusalIn("Smart contract panicked: too many keys for this owner")).toBeNull();
    expect(refusalIn("network down")).toBeNull();
  });
});
