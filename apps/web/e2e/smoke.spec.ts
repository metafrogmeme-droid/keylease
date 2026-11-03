import { expect, test, type Page } from "@playwright/test";

/** Records requests, console errors and CSP violations from the first script on. */
async function watch(page: Page) {
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
    document.addEventListener("securitypolicyviolation", (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return {
    origins,
    problems,
    /**
     * Violations other than blocked `eval`. Two libraries in the wallet bundle probe for eval inside
     * try/catch (zod's JIT check, is-generator-function) and fall back; the policy blocks them on purpose.
     */
    violations: async () =>
      (await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).filter(
        (v) => v !== "script-src eval",
      ),
  };
}

test("first visit: banner, three-step strip, faucet link, strict CSP, nothing third-party", async ({
  page,
}) => {
  const w = await watch(page);
  await page.goto("/");
  await expect(page.getByRole("note", { name: "Network" })).toContainText("TESTNET");
  const steps = page.getByRole("list", { name: "Steps" }).getByRole("listitem");
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
  expect(csp).not.toContain("walletconnect"); // not configured in this build

  await page.waitForLoadState("networkidle");
  expect([...w.origins]).toEqual([new URL(page.url()).origin]);
  expect(await w.violations()).toEqual([]);
  // React hydrated under the policy: Next's runtime ran from 'self' plus the hashed inline scripts.
  expect(await page.evaluate(() => "__next_f" in window)).toBe(true);
  expect(w.problems).toEqual([]);
});

test("wallet picker: keyboard only, six wallets, WalletConnect says not configured", async ({ page }) => {
  const w = await watch(page);
  await page.goto("/");
  const connect = page.getByRole("button", { name: "Connect wallet", exact: true });
  await connect.focus();
  await page.keyboard.press("Enter");
  await expect(connect).toHaveAttribute("aria-expanded", "true");

  const list = page.getByRole("list", { name: "Wallets" });
  const names = ["MyNearWallet", "Meteor", "HOT", "Intear", "WalletConnect", "MetaMask"];
  for (const name of names)
    await expect(list.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();

  // Wallet code loaded under the CSP: every configured wallet becomes clickable.
  await expect(list.getByRole("button", { name: /^MyNearWallet/ })).toBeEnabled();
  await expect(list.getByRole("button", { name: /^MetaMask/ })).toBeEnabled();
  const wc = list.getByRole("button", { name: /^WalletConnect/ });
  await expect(wc).toBeDisabled();
  await expect(wc).toHaveAccessibleDescription(/not configured/);

  // MetaMask without an injected wallet: a plain message, no crash.
  await list.getByRole("button", { name: /^MetaMask/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(/wallet/i);

  expect(await w.violations()).toEqual([]);
  expect(w.problems.filter((p) => !/wallet|ethereum|provider/i.test(p))).toEqual([]);
});

test("pubkey relay on the app's own origin: refuses a key value and other origins, before any upstream call", async ({
  request,
}) => {
  const body = {
    accessor: { type: "WasmHash", hash: "ab".repeat(32) },
    owner: "alice.testnet",
    profile: "kl-000000000000",
    secrets_json: JSON.stringify({ KL_API_KEY: "not-empty" }),
  };
  const withValue = await request.post("/api/secrets/pubkey", { data: body });
  expect(withValue.status()).toBe(400);
  expect(await withValue.text()).toContain("values must be empty");
  const crossSite = await request.post("/api/secrets/pubkey", {
    data: { ...body, secrets_json: '{"KL_API_KEY":""}' },
    headers: { origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);
  expect((await request.get("/api/secrets/pubkey")).status()).toBe(405);
});

test("lease page: a bad link says so plainly, under the same CSP", async ({ page }) => {
  const w = await watch(page);
  await page.goto("/lease/?id=abc");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("no valid lease id");
  await expect(page.getByRole("note", { name: "Network" })).toContainText("TESTNET");
  await page.waitForLoadState("networkidle");
  expect([...w.origins]).toEqual([new URL(page.url()).origin]);
  expect(await w.violations()).toEqual([]);
});
