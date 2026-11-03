import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const vars = new Map<string, string>();
for (const m of css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)) if (m[1] && m[2]) vars.set(m[1], m[2]);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("WCAG AA contrast (≥ 4.5:1) for every text colour pair", () => {
  const pairs: [string, string][] = [
    ["fg", "bg"],
    ["muted", "bg"],
    ["accent", "bg"],
    ["banner-fg", "banner-bg"],
    ["bg", "done"],
    ["done", "bg"],
    ["bad", "bg"],
  ];
  it.each(pairs)("%s on %s", (fg, bg) => {
    const a = vars.get(fg);
    const b = vars.get(bg);
    if (a === undefined || b === undefined) throw new Error(`missing --${fg} or --${bg}`);
    expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
  });
});
