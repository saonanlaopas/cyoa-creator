import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: "node apps/server/dist/main.js",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: true,
  },
});
