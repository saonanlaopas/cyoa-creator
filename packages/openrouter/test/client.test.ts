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
const jsonResponse = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
};
const clientWithResponse = (response: Response) => new OpenRouterClient({
  credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: key } }),
  fetch: async () => response.clone(),
});
const rejectedError = async (client: OpenRouterClient): Promise<OpenRouterError> => {
  try {
    await client.listModels();
    throw new Error("Expected OpenRouterClient to reject");
  } catch (error) {
    if (!(error instanceof OpenRouterError)) throw error;
    return error;
  }
};

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

  it("streams structured JSON, enables requested reasoning, and repairs invalid JSON once", async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    const client = new OpenRouterClient({
      credentialStore: credentials(),
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        calls += 1;
        const content = calls === 1 ? "{bad" : '{"title":"ok"}';
        return new Response([
          `data: ${JSON.stringify({ choices: [{ delta: { content } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.8 } })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""), { headers: { "content-type": "text/event-stream" } });
      },
    });
    const repairs: number[] = [];
    const result = await client.generateStructuredStream(
      { model: model.id, modelCapabilities: model, messages: [{ role: "user", content: "go" }], reasoning: { enabled: true, effort: "low" } },
      z.object({ title: z.string() }),
      { onRepair: (attempt) => repairs.push(attempt) },
    );
    expect(result).toMatchObject({ data: { title: "ok" }, repaired: true, usage: { totalTokens: 8 }, cost: { total: 0.8 } });
    expect(repairs).toEqual([1]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ stream: true, reasoning: { enabled: true, exclude: false, effort: "low" } });
    expect(bodies[1]).toMatchObject({ messages: expect.arrayContaining([{ role: "system", content: "Return only repaired JSON matching the requested schema." }]) });
  });

  it("can disable a second structured repair while retaining completed-attempt metadata", async () => {
    let calls = 0;
    const client = new OpenRouterClient({
      credentialStore: credentials(),
      fetch: async () => {
        calls += 1;
        return new Response(`data: ${JSON.stringify({ id: `gen-${calls}`, provider: "test-provider", choices: [{ delta: { content: "{bad" } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.8 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      },
    });

    await expect(client.generateStructuredStream(
      { model: model.id, modelCapabilities: model, messages: [{ role: "user", content: "go" }], maxRepairAttempts: 0 },
      z.object({ title: z.string() }),
    )).rejects.toMatchObject({ code: "COMPLETION_JSON_INVALID", diagnostic: { provider: "test-provider", generationId: "gen-1" } });
    expect(calls).toBe(1);
  });

  it.each([[401, "UNAUTHENTICATED"], [429, "RATE_LIMITED"], [500, "PROVIDER_FAILURE"]] as const)("maps HTTP %s", async (status, code) => {
    const client = new OpenRouterClient({ credentialStore: credentials(), fetch: async () => jsonResponse({}, { status }) });
    await expect(client.listModels()).rejects.toMatchObject<Partial<OpenRouterError>>({ code });
  });

  it.each([
    ["", "OPENROUTER_ENVELOPE_INVALID"],
    ["<html>bad gateway</html>", "OPENROUTER_ENVELOPE_INVALID"],
  ] as const)("preserves a redacted non-JSON response", async (body, code) => {
    const client = clientWithResponse(new Response(body, {
      status: 200,
      headers: { "content-type": "text/html", "x-request-id": "req-123" },
    }));
    await expect(client.listModels()).rejects.toMatchObject({
      code,
      diagnostic: {
        status: 200,
        contentType: "text/html",
        requestId: "req-123",
      },
    });
  });

  it("preserves an invalid 500 response as an envelope error", async () => {
    const error = await rejectedError(clientWithResponse(new Response("<html>bad gateway</html>", {
      status: 500,
      headers: { "content-type": "text/html" },
    })));
    expect(error).toMatchObject({ code: "OPENROUTER_ENVELOPE_INVALID", diagnostic: { status: 500 } });
  });

  it("maps a typed OpenRouter error returned with HTTP 200", async () => {
    const client = clientWithResponse(jsonResponse({
      error: { code: 402, message: "Insufficient credits", metadata: { error_type: "insufficient_credits" } },
    }));
    await expect(client.listModels()).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });

  it("redacts secrets from full response evidence", async () => {
    const error = await rejectedError(clientWithResponse(new Response(`bad ${key}`, { status: 200 })));
    expect(JSON.stringify(error.diagnostic)).not.toContain(key);
  });

  it("returns a sanitized completion JSON error after the bounded repair", async () => {
    const completion = `{"token":"${key}"`;
    const client = new OpenRouterClient({
      credentialStore: credentials(),
      fetch: async () => jsonResponse({ choices: [{ message: { content: completion } }] }),
    });
    try {
      await client.generateStructured({ model: model.id, messages: [{ role: "user", content: "go" }] }, z.object({ title: z.string() }));
      throw new Error("Expected OpenRouterClient to reject");
    } catch (error) {
      if (!(error instanceof OpenRouterError)) throw error;
      expect(error).toMatchObject({ code: "COMPLETION_JSON_INVALID" });
      expect(error).not.toHaveProperty("cause");
      expect(error.message).not.toContain(completion);
      expect(error.message).not.toContain(key);
      expect(JSON.stringify(error)).not.toContain(key);
    }
  });

  it("returns a schema error after the bounded repair for valid completion JSON", async () => {
    const client = new OpenRouterClient({
      credentialStore: credentials(),
      fetch: async () => jsonResponse({ choices: [{ message: { content: '{"title":4}' } }] }),
    });
    const generation = client.generateStructured(
      { model: model.id, messages: [{ role: "user", content: "go" }] },
      z.object({ title: z.string() }),
    );
    await expect(generation).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    const error = await generation.catch((reason: unknown) => reason);
    expect(error).not.toHaveProperty("cause");
  });

  it.each([
    [jsonResponse({ error: { metadata: { error_type: "provider_timeout" } } }), "TIMEOUT"],
    [jsonResponse({}, { status: 504 }), "TIMEOUT"],
  ] as const)("maps provider timeout evidence to TIMEOUT", async (response, code) => {
    await expect(clientWithResponse(response).listModels()).rejects.toMatchObject({ code });
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
