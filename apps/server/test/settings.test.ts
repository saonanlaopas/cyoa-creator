import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { EnvironmentCredentialStore } from "../../../packages/openrouter/src/index.js";
import { InMemorySettingsStore, registerSettingsRoutes } from "../src/routes/settings.js";

describe("settings routes", () => {
  it("keeps keys out of responses while storing non-secret preferences", async () => {
    const key = "sk-or-v1-never-return-this-key-0123456789";
    const app = fastify({ logger: false });
    const credentials = new EnvironmentCredentialStore({ environment: {} });
    await registerSettingsRoutes(app, {
      credentials,
      client: { listModels: async () => [] },
      settings: new InMemorySettingsStore(),
    });
    const set = await app.inject({ method: "PUT", url: "/api/settings/openrouter", payload: { apiKey: key } });
    expect(set.json()).toEqual({ configured: true });
    expect(set.body).not.toContain(key);
    expect((await app.inject({ method: "GET", url: "/api/settings/openrouter" })).json()).toEqual({ configured: true });
    expect((await app.inject({ method: "PUT", url: "/api/settings/preset", payload: { preset: "fast" } })).json()).toEqual({ preset: "fast" });
    expect((await app.inject({ method: "PUT", url: "/api/settings/spending-cap", payload: { spendingCap: 2.5 } })).json()).toEqual({ spendingCap: 2.5 });
    await app.close();
  });
});
