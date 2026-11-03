/**
 * Time to first lease (brief §4): connect → paste key → preset → share in ≤ 60 s. Runs against a build made
 * with NEXT_PUBLIC_KL_E2E=1 (test wallet, no chain), with the RPC and the keystore relay answered here.
 * Two numbers must stay under 60 s: the measured run, and a human estimate of the same steps
 * (4 s per click or field, pasting the key counts as one field).
 */
import { generateKeyPairSync } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const HUMAN_SECONDS_PER_ACTION = 4;

async function fakeChain(page: Page) {
  const pub = generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  let keys: unknown[] = [];
  await page.route("**/api/secrets/pubkey", (r) => r.fulfill({ json: { pubkey: pub.toString("hex") } }));
  await page.route("https://rpc.testnet.near.org/**", async (r) => {
    const body = r.request().postDataJSON() as { params: { method_name: string } };
    const answer: Record<string, unknown> = {
      get_config: { outlayer: "outlayer.testnet", proxy_hash: "ab".repeat(32) },
      estimate_storage_cost: "1000000000000000000000",
      list_keys_by_owner: keys,
      list_leases_by_owner: [],
    };
    const value = answer[body.params.method_name] ?? null;
    if (body.params.method_name === "estimate_storage_cost")
      keys = [
        { key_id: "0", provider: "NearAiCloud", base_url: "https://cloud-api.near.ai/v1", label: "my key" },
      ];
    await r.fulfill({ json: { result: { result: [...Buffer.from(JSON.stringify(value))] } } });
  });
}

test("time to first lease is under 60 s", async ({ page }) => {
  await fakeChain(page);
  let actions = 0;
  const act = async (f: () => Promise<void>) => {
    actions += 1;
    await f();
  };
  const start = Date.now();
  await page.goto("/");

  await act(() => page.getByRole("button", { name: "Connect wallet", exact: true }).click());
  await act(() => page.getByRole("button", { name: /^MyNearWallet/ }).click());
  await expect(page.getByText("judge.testnet")).toBeVisible();

  await act(() => page.getByLabel("API key").fill("demo-paste-not-a-real-key"));
  await act(() => page.getByRole("button", { name: "Seal and add key" }).click());
  await expect(page.getByText("✓ Key added.")).toBeVisible();
  await expect(page.getByLabel("API key")).toHaveValue("");

  await act(() => page.getByRole("button", { name: "Share key my key" }).click());
  await act(() => page.getByLabel(/Grantee/).fill("agent.testnet"));
  await act(() => page.getByRole("button", { name: "Create lease and share" }).click());
  await expect(page.getByRole("group", { name: "Share lease 0" })).toBeVisible();
  await act(() => page.getByRole("button", { name: "Copy MCP" }).click());

  const measured = (Date.now() - start) / 1000;
  const human = actions * HUMAN_SECONDS_PER_ACTION;
  test.info().annotations.push({
    type: "timing",
    description: `measured ${measured.toFixed(1)} s, human estimate ${String(human)} s, ${String(actions)} actions`,
  });
  console.warn(
    `time to first lease: measured ${measured.toFixed(1)} s, human estimate ${String(human)} s (${String(actions)} actions)`,
  );
  expect(measured).toBeLessThan(60);
  expect(human).toBeLessThanOrEqual(60);
  // The onboarding strip now shows Connect, Add key and Share as done.
  const steps = page.getByRole("list", { name: "Steps" }).getByRole("listitem");
  for (let i = 0; i < 3; i += 1) await expect(steps.nth(i)).toContainText("(done)");
});
