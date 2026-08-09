import { defineConfig } from "playwright/test";

const webServerRuntimeVariables = [
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

export function createE2EWebServerEnv(environment: NodeJS.ProcessEnv) {
  const runtimeEnvironment = Object.fromEntries(
    webServerRuntimeVariables.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );

  return {
    ...runtimeEnvironment,
    PORT: "3100",
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    E2E_FAKE_MODEL_PROVIDER: "1",
    E2E_PASSAGE_PLANNING_DELAY_MS: "60",
    E2E_PASSAGE_PLANNING_FAIL_FIRST: "1",
    E2E_PASSAGE_PLANNING_MALFORMED: "1",
  };
}

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "node apps/server/dist/main.js",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: createE2EWebServerEnv(process.env),
  },
});
