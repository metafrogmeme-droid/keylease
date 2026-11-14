import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../app/layout.tsx";
import Home from "../app/page.tsx";
import { FAUCET_URL } from "../lib/config.ts";

const html = renderToStaticMarkup(
  <RootLayout>
    <Home />
  </RootLayout>,
);

describe("How it works / Help panel", () => {
  it("is present, collapsed by default, and uses native details", () => {
    expect(html).toContain(">How it works / Help</summary>");
    expect(html).toMatch(/<details class="rc-help">/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("contains the steps: connect, add key, share, revoke and the faucet", () => {
    expect(html).toContain("Connect a wallet.");
    expect(html).toContain("Add a key.");
    expect(html).toContain("Share a lease.");
    expect(html).toContain("Revoke.");
    expect(html).toContain("Testnet faucet.");
    expect(html).toContain(FAUCET_URL);
    expect(html).toContain("get some from the testnet faucet");
  });

  it("states how the key is sealed and that this app is testnet only", () => {
    expect(html).toContain("Does the API key leave this device unencrypted?");
    expect(html).toContain("encrypted in this browser to OutLayer");
    expect(html).toContain("keystore before it leaves the page");
    expect(html).toContain("Only the sealed envelope is sent");
    expect(html).toContain("Is this mainnet?");
    expect(html).toContain("The banner at the top says TESTNET");
    expect(html).toContain("This page does not talk to NEAR mainnet");
  });

  it("keeps the TESTNET banner verbatim and above the help panel and the forms", () => {
    expect(html).toContain("<strong>TESTNET</strong>");
    expect(html).toContain("test tokens only, no real value");
    expect(html).toContain("keylease.testnet");
    const banner = html.indexOf("<strong>TESTNET</strong>");
    const strip = html.indexOf("Start in three steps");
    const help = html.indexOf("How it works / Help");
    const form = html.indexOf("Connect wallet");
    expect(banner).toBeGreaterThanOrEqual(0);
    expect(banner).toBeLessThan(strip);
    expect(strip).toBeLessThan(help);
    expect(help).toBeLessThan(form);
  });
});
