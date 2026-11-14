import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG AA for the RUNECLAW theme: every text colour pair is ≥ 4.5:1, the focus ring and the edge of an
 * input or button are ≥ 3:1. Reads the active theme (rc-theme.css) and the meaning colours (rc-tokens.css),
 * so a theme swap is checked by the same test.
 */
const read = (f: string) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");
const vars = new Map<string, string>();
for (const f of ["rc-tokens.css", "rc-theme.css"])
  for (const m of read(f).matchAll(/--(rc-[a-z0-9-]+):\s*([^;]+);/g))
    if (m[1] && m[2]) vars.set(m[1], m[2].trim());

const v = (name: string): string => {
  const hex = /^#[0-9a-f]{6}$/i.exec(vars.get(name) ?? "")?.[0];
  if (hex === undefined) throw new Error(`--${name} is not a #rrggbb colour`);
  return hex;
};
const stops = (name: string): string[] => vars.get(name)?.match(/#[0-9a-f]{6}\b/gi) ?? [];

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

const SURFACES = ["rc-bg", "rc-raised", "rc-surface", "rc-surface-2"] as const;

describe("WCAG AA contrast (≥ 4.5:1) for every text colour pair", () => {
  const pairs: [string, string, string][] = [];
  for (const s of SURFACES)
    for (const t of ["rc-text", "rc-muted", "rc-link", "rc-ok", "rc-danger", "rc-warn"])
      pairs.push([`${t} on ${s}`, v(t), v(s)]);
  pairs.push(["banner text", v("rc-warn-text"), v("rc-warn-bg")]);
  pairs.push(["banner bold text", "#ffffff", v("rc-warn-bg")]);
  pairs.push(["danger box text", "#ffe6e3", v("rc-danger-bg")]);
  pairs.push(["danger on its box", v("rc-danger"), v("rc-danger-bg")]);
  pairs.push(["ok on its box", v("rc-ok"), v("rc-ok-bg")]);
  pairs.push(["warn on its box", v("rc-warn"), v("rc-warn-bg")]);
  for (const c of stops("rc-btn-bg")) pairs.push([`primary button text on ${c}`, v("rc-on-accent"), c]);
  for (const c of stops("rc-title-gradient")) pairs.push([`title gradient ${c} on bg`, c, v("rc-bg")]);

  it.each(pairs)("%s", (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("WCAG 1.4.11 non-text contrast (≥ 3:1)", () => {
  it.each(["rc-bg", "rc-surface", "rc-surface-2"])("focus ring on %s", (s) => {
    expect(contrast(v("rc-focus"), v(s))).toBeGreaterThanOrEqual(3);
  });
  it.each(SURFACES)("the edge of an input or button on %s", (s) => {
    expect(contrast(v("rc-control"), v(s))).toBeGreaterThanOrEqual(3);
  });
});
