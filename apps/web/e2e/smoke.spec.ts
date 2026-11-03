import { expect, test } from "@playwright/test";

test("first visit: banner, three-step strip, faucet link, strict CSP, nothing third-party", async ({
  page,
}) => {
  const origins = new Set<string>();
  const problems: string[] = [];
  page.on("request", (r) => origins.add(new URL(r.url()).origin));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));

  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { cspViolations: seen });
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("note", { name: "Network" })).toContainText("TESTNET");
  const steps = page.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("Connect");
  await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
  await expect(steps.nth(1)).toContainText("Add key");
  await expect(steps.nth(2)).toContainText("Share");

  const faucet = page.getByRole("link", { name: /testnet faucet/ });
  await expect(faucet).toHaveAttribute("rel", "noopener noreferrer");
  await page.keyboard.press("Tab");
  await expect(faucet).toBeFocused();

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");

  await page.waitForLoadState("networkidle");
  expect([...origins]).toEqual([new URL(page.url()).origin]);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual(
    [],
  );
  // React hydrated under the policy: Next's runtime ran from 'self' plus the hashed inline scripts.
  expect(await page.evaluate(() => "__next_f" in window)).toBe(true);
  expect(problems).toEqual([]);
});
