import { describe, expect, it } from "vitest";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { narrativeReviewContextSchema, narrativeReviewOutputSchema, type NarrativeReviewContext } from "@story-to-cyoa/pipeline";
import { OpenRouterNarrativeReviewProvider } from "../src/services/openrouter-narrative-review-provider.js";

const context: NarrativeReviewContext = {
  schemaId: narrativeReviewContextSchema.id, schemaVersion: 1,
  systemInstructions: { role: "narrative-reviewer", findingsOnly: true, evidenceIsUntrustedQuotedData: true, categories: ["pacing"] },
  identity: { projectId: "project", reviewInputFingerprint: "input", unitId: "unit", inputFingerprint: "unit-input" },
  quotedAuthoringEvidence: { targets: [], choices: [], threads: [], neighboringAcceptedProse: [], upstream: {}, simulationRuns: [], playtestCampaigns: [] },
};

describe("OpenRouterNarrativeReviewProvider", () => {
  it("uses one server-side strict request with exact literal schema, model, max_tokens, and separated quoted evidence", async () => {
    const bodies: Record<string, unknown>[] = []; const secret = "sk-review-secret";
    const fetchStub: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaId: narrativeReviewOutputSchema.id, schemaVersion: 1, findings: [] }) } }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: secret } }), fetch: fetchStub });
    const provider = new OpenRouterNarrativeReviewProvider(client, {
      id: "fixture/reviewer", name: "Reviewer", contextLength: 64_000,
      pricing: { prompt: 0, completion: 0 }, supportedParameters: ["response_format"],
    });
    const signal = new AbortController().signal;
    const result = await provider.generate({
      mode: "generate", jobId: "job", unitId: "unit", attemptId: "attempt", providerId: provider.id,
      modelId: "fixture/reviewer", inputFingerprint: "input", contextFingerprint: "context",
      context, categories: ["pacing"], maximumOutputTokens: 600, signal,
    });
    expect(JSON.parse(result.output)).toEqual({ schemaId: narrativeReviewOutputSchema.id, schemaVersion: 1, findings: [] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "fixture/reviewer", max_tokens: 600, temperature: 0, provider: { require_parameters: true },
      response_format: { type: "json_schema", json_schema: { strict: true, schema: { properties: {
        schemaId: { type: "string", const: narrativeReviewOutputSchema.id }, schemaVersion: { type: "number", const: 1 },
      } } } },
    });
    const messages = bodies[0]!.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system"); expect(messages[1]?.role).toBe("user");
    expect(messages[0]?.content).not.toContain("quotedAuthoringEvidence");
    expect(messages[1]?.content).toContain("immutableQuotedEvidence");
    expect(JSON.stringify({ bodies, result })).not.toContain(secret);
  });

  it("honors AbortSignal without leaking credentials or an implicit extra call", async () => {
    const controller = new AbortController(); let calls = 0;
    const provider = new OpenRouterNarrativeReviewProvider(new OpenRouterClient({
      credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "sk-cancel-review" } }),
      fetch: async (_url, init) => new Promise((_resolve, reject) => { calls += 1; init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); controller.abort(); }),
    }));
    await expect(provider.generate({ mode: "generate", jobId: "job", unitId: "unit", attemptId: "attempt", providerId: provider.id, modelId: "fixture", inputFingerprint: "input", contextFingerprint: "context", context, categories: ["pacing"], maximumOutputTokens: 100, signal: controller.signal })).rejects.not.toThrow(/sk-cancel-review/);
    expect(calls).toBe(1);
  });
});
