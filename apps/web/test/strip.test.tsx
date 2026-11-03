// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OnboardingStrip, stepStates } from "../components/OnboardingStrip.tsx";
import { TestnetBanner } from "../components/TestnetBanner.tsx";
import { FAUCET_URL } from "../lib/config.ts";

afterEach(cleanup);

describe("onboarding strip", () => {
  it("walks Connect · Add key · Share in order", () => {
    const none = { connected: false, hasKey: false, hasLease: false };
    expect(stepStates(none)).toEqual(["current", "next", "next"]);
    expect(stepStates({ ...none, connected: true })).toEqual(["done", "current", "next"]);
    expect(stepStates({ connected: true, hasKey: true, hasLease: false })).toEqual([
      "done",
      "done",
      "current",
    ]);
    expect(stepStates({ connected: true, hasKey: true, hasLease: true })).toEqual(["done", "done", "done"]);
    // a key or lease without a connected wallet does not count
    expect(stepStates({ connected: false, hasKey: true, hasLease: true })).toEqual([
      "current",
      "next",
      "next",
    ]);
  });

  it("marks the current step for screen readers and links the faucet in a new tab", () => {
    render(<OnboardingStrip progress={{ connected: true, hasKey: false, hasLease: false }} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => within(li).getByText(/^(Connect|Add key|Share)$/).textContent)).toEqual([
      "Connect",
      "Add key",
      "Share",
    ]);
    expect(items[0]?.textContent).toContain("(done)");
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    const faucet = screen.getByRole("link", { name: /testnet faucet/ });
    expect(faucet.getAttribute("href")).toBe(FAUCET_URL);
    expect(faucet.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("says the key is encrypted in the browser and the link never holds the key", () => {
    render(<OnboardingStrip progress={{ connected: false, hasKey: false, hasLease: false }} />);
    expect(screen.getByText(/encrypted in this browser/)).toBeTruthy();
    expect(screen.getByText(/never the key/)).toBeTruthy();
  });
});

describe("testnet banner", () => {
  it("names the network and the contract", () => {
    render(<TestnetBanner contractId="keylease.testnet" />);
    const banner = screen.getByRole("note", { name: "Network" });
    expect(banner.textContent).toContain("TESTNET");
    expect(banner.textContent).toContain("keylease.testnet");
  });
});
