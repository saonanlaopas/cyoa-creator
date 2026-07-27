import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "node apps/server/dist/main.js",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: "3100",
      NODE_ENV: "test",
      E2E_FAKE_MODEL_PROVIDER: "1",
    },
  },
});
