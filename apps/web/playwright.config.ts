import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  forbidOnly: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${String(PORT)}`, browserName: "chromium" },
  webServer: {
    command: `node scripts/serve.ts out ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
  },
});
