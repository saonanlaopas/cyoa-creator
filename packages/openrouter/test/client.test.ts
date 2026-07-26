import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EnvironmentCredentialStore,
  OpenRouterClient,
  OpenRouterError,
} from "../src/index.js";

const key = "sk-or-v1-test-secret-key-0123456789";
const credentials = () => new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: key } });
const model = { id: "test/model", name: "Test", contextLength: 1, pricing: { prompt: 0.1, completion: 0.2 }, supportedParameters: ["response_format"] };

describe("OpenRouterClient", () => {
  it("authenticates, requires parameters, validates usage, and repairs once", async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    const client = new OpenRouterClient({
      credentialStore: credentials(),
      fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
        bodies.push(JSON.parse(String(init?.body)));
        calls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: calls === 1 ? "{bad" : '{"title":"ok"}' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.8 } }));
      },
    });
    const result = await client.generateStructured({ model: model.id, modelCapabilities: model, messages: [{ role: "user", content: "go" }] }, z.object({ title: z.string() }));
    expect(result).toMatchObject({ data: { title: "ok" }, repaired: true, usage: { totalTokens: 8 }, cost: { total: 0.8 } });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ provider: { require_parameters: true }, response_format: { json_schema: { strict: true } } });
  });

  it.each([[401, "UNAUTHENTICATED"], [429, "RATE_LIMITED"], [500, "PROVIDER_FAILURE"]] as const)("maps HTTP %s", async (status, code) => {
    const client = new OpenRouterClient({ credentialStore: credentials(), fetch: async () => new Response("failed", { status }) });
    await expect(client.listModels()).rejects.toMatchObject<Partial<OpenRouterError>>({ code });
  });

  it("reports timeout and cancellation", async () => {
    const hangingFetch: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    await expect(new OpenRouterClient({ credentialStore: credentials(), fetch: hangingFetch, timeoutMs: 1 }).listModels()).rejects.toMatchObject({ code: "TIMEOUT" });
    const controller = new AbortController();
    controller.abort();
    await expect(new OpenRouterClient({ credentialStore: credentials(), fetch: hangingFetch }).listModels(controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
