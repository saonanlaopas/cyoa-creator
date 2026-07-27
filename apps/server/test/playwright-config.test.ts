import { describe, expect, it } from "vitest";
import { createE2EWebServerEnv } from "../../../playwright.config.js";

describe("createE2EWebServerEnv", () => {
  it("forwards only runtime variables needed to launch the test server", () => {
    const environment = createE2EWebServerEnv({
      PATH: "C:\\runtime",
      SYSTEMROOT: "C:\\Windows",
      OPENROUTER_API_KEY: "secret-key",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      DATABASE_URL: "postgres://secret",
      ARBITRARY_PARENT_VALUE: "must-not-pass",
    });

    expect(environment).toEqual({
      PATH: "C:\\runtime",
      SYSTEMROOT: "C:\\Windows",
      PORT: "3100",
      NODE_ENV: "test",
      E2E_FAKE_MODEL_PROVIDER: "1",
    });
  });
});
