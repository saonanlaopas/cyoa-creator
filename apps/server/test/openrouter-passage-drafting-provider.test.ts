import { describe, expect, it } from "vitest";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { passageDraftingUnitOutputSchema } from "@story-to-cyoa/pipeline";
import { OpenRouterPassageDraftingProvider } from "../src/services/openrouter-passage-drafting-provider.js";

describe("OpenRouterPassageDraftingProvider", () => {
  it("uses server credentials and exact structured-output/token/cancellation controls through stubbed HTTP", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const secret = "sk-or-v1-drafting-secret";
    const output = {
      schemaId: passageDraftingUnitOutputSchema.id,
      schemaVersion: passageDraftingUnitOutputSchema.version,
      passages: [{ passageId: "passage-a", basedOnPassagePlanVersionId: "version-a", proseMarkdown: "Draft prose." }],
    };
    const fetchStub: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 90, completion_tokens: 40, total_tokens: 130 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const signal = new AbortController().signal;
    const client = new OpenRouterClient({
      credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: secret } }),
      fetch: fetchStub,
    });
    const provider = new OpenRouterPassageDraftingProvider(client, {
      id: "fixture/model", name: "Fixture", contextLength: 32_000,
      pricing: { prompt: 0, completion: 0 }, supportedParameters: ["response_format"],
    });
    const result = await provider.generate({
      mode: "generate", jobId: "job-a", unitId: "unit-a", providerId: provider.id,
      modelId: "fixture/model", inputFingerprint: "a".repeat(64), contextFingerprint: "b".repeat(64),
      boundedContext: { targets: [{ passageId: "passage-a", passagePlanVersionId: "version-a" }] },
      outputSchema: passageDraftingUnitOutputSchema,
      capabilityRequirements: { structuredOutput: true, localValidation: true },
      maximumOutputTokens: 2_500, signal,
    });
    expect(JSON.parse(result.output)).toEqual(output);
    expect(result).toMatchObject({ usage: { inputTokens: 90, outputTokens: 40 }, providerRepairCount: 0 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "fixture/model", max_tokens: 2_500, temperature: 0,
      provider: { require_parameters: true }, response_format: {
        type: "json_schema", json_schema: {
          strict: true,
          schema: {
            properties: {
              schemaId: { type: "string", const: passageDraftingUnitOutputSchema.id },
              schemaVersion: { type: "number", const: passageDraftingUnitOutputSchema.version },
            },
          },
        },
      },
    });
    expect(JSON.stringify({ result, bodies })).not.toContain(secret);
  });

  it("normalizes aborted stubbed HTTP without leaking the credential", async () => {
    const secret = "sk-or-v1-cancel-secret";
    const controller = new AbortController();
    const fetchStub: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      controller.abort();
    });
    const provider = new OpenRouterPassageDraftingProvider(new OpenRouterClient({
      credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: secret } }), fetch: fetchStub,
    }));
    await expect(provider.generate({
      mode: "generate", jobId: "job", unitId: "unit", providerId: provider.id, modelId: "fixture/model",
      inputFingerprint: "a".repeat(64), contextFingerprint: "b".repeat(64), boundedContext: {},
      outputSchema: passageDraftingUnitOutputSchema, capabilityRequirements: { structuredOutput: true, localValidation: true },
      maximumOutputTokens: 100, signal: controller.signal,
    })).rejects.not.toThrow(secret);
  });
});
