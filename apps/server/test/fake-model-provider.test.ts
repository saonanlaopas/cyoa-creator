import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentCredentialStore, type CredentialStore } from "@story-to-cyoa/openrouter";
import { buildApp } from "../src/app.js";

const source = "Mara returns to the flooded station before dawn, carrying the brass key her father hid years ago. She knows the town will blame her if the archive burns, but the last train still waits beyond the broken platform.";
const savedEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  fakeProvider: process.env.E2E_FAKE_MODEL_PROVIDER,
};

afterEach(() => {
  setEnvironment("NODE_ENV", savedEnvironment.nodeEnv);
  setEnvironment("E2E_FAKE_MODEL_PROVIDER", savedEnvironment.fakeProvider);
});

describe("offline E2E model provider gate", () => {
  it("does not select the fake provider from the flag alone", async () => {
    process.env.NODE_ENV = "production";
    process.env.E2E_FAKE_MODEL_PROVIDER = "1";
    const app = buildApp({ credentials: emptyCredentials() });
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;

    const response = await app.inject({
      method: "POST",
      url: "/api/quick/generate",
      payload: { projectId, source, model: "e2e/offline" },
    });

    expect(response.body).toContain('"code":"UNAUTHENTICATED"');
    expect(response.body).not.toContain("offline-flooded-station");
    await app.close();
  });

  it("selects the fake provider only when the explicit test runtime is also set", async () => {
    process.env.NODE_ENV = "test";
    process.env.E2E_FAKE_MODEL_PROVIDER = "1";
    const app = buildApp({ credentials: emptyCredentials() });
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;

    const response = await app.inject({
      method: "POST",
      url: "/api/quick/generate",
      payload: { projectId, source, model: "e2e/offline" },
    });

    expect(response.body).toContain('"type":"result"');
    expect(response.body).toContain("offline-flooded-station");
    await app.close();
  });
});

function emptyCredentials(): CredentialStore {
  return new EnvironmentCredentialStore({ environment: {} });
}

function setEnvironment(name: "NODE_ENV" | "E2E_FAKE_MODEL_PROVIDER", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
