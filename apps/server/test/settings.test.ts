import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { type CredentialStore, EnvironmentCredentialStore } from "../../../packages/openrouter/src/index.js";
import { buildApp } from "../src/app.js";
import { InMemorySettingsStore, registerSettingsRoutes } from "../src/routes/settings.js";

class MemoryCredentialStore implements CredentialStore {
  private key: string | null = null;

  public async getOpenRouterKey(): Promise<string | null> { return this.key; }
  public async setOpenRouterKey(value: string): Promise<void> { this.key = value; }
  public async deleteOpenRouterKey(): Promise<void> { this.key = null; }
}

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

  it("uses the injected credential store across app rebuilds", async () => {
    const key = "sk-or-v1-never-return-this-key-across-restarts";
    const secureStore = new MemoryCredentialStore();
    const first = buildApp({ credentials: secureStore });

    await first.inject({ method: "PUT", url: "/api/settings/openrouter", payload: { apiKey: key } });
    await first.close();

    const second = buildApp({ credentials: secureStore });
    expect((await second.inject({ method: "GET", url: "/api/settings/openrouter" })).json())
      .toEqual({ configured: true });
    await second.close();
  });
});
