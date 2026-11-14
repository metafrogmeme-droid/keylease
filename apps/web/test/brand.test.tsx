import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../app/layout.tsx";
import Home from "../app/page.tsx";

const app = (f: string) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");
const html = renderToStaticMarkup(
  <RootLayout>
    <Home />
  </RootLayout>,
);

describe("RUNECLAW branding", () => {
  it("shows the official wordmark with alt text, after the testnet banner", () => {
    expect(html).toContain('src="/runeclaw/runeclaw-wordmark.png"');
    expect(html).toContain('alt="RUNECLAW"');
    for (const f of ["runeclaw-wordmark.png", "runeclaw-mark.png", "runeclaw-mark-64.png"]) {
      const file = new URL(`../public/runeclaw/${f}`, import.meta.url);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    expect(html.indexOf("<strong>TESTNET</strong>")).toBeLessThan(html.indexOf("<img"));
  });

  it("keeps the TESTNET banner, the contract and the no-real-value line on every page", () => {
    expect(html).toMatch(/<div class="banner banner--bar" role="note" aria-label="Network">/);
    expect(html).toContain("<strong>TESTNET</strong>");
    expect(html).toContain("keylease.testnet");
    expect(html).toContain("test tokens only, no real value");
    expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf("<main"));
  });

  it("keeps the home copy: the pitch and the three steps with their security promises", () => {
    expect(html).toContain("Lend the call, never the key.");
    expect(html).toContain("Your API key stays sealed in an enclave");
    expect(html).toContain("Start in three steps");
    expect(html).toContain("It is encrypted in this browser before it leaves the page.");
    expect(html).toContain("The link holds a lease id, never the key.");
  });

  it("loads the shared design system in order, before the app styles", () => {
    const layout = app("layout.tsx");
    const order = ["rc-tokens.css", "rc-theme.css", "rc-base.css", "globals.css", "ethereum-wallets.css"];
    const at = order.map((f) => layout.indexOf(`import "./${f}";`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("never hides or dims the banner, and loads nothing from another origin", () => {
    const css = ["rc-base.css", "globals.css"].map(app).join("\n");
    for (const [, , body] of css.matchAll(/([^{}]*\.banner[^{}]*)\{([^{}]*)\}/g))
      expect(body).not.toMatch(
        /display:\s*none|visibility:\s*hidden|opacity:\s*0?\.[0-8]|clip|font-size:\s*0/,
      );
    for (const f of ["rc-tokens.css", "rc-theme.css", "rc-base.css", "globals.css"]) {
      expect(app(f)).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//);
    }
  });

  it("styles keyboard focus and respects reduced motion", () => {
    const base = app("rc-base.css");
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--rc-focus\)/);
    expect(base).toContain("prefers-reduced-motion");
  });
});
