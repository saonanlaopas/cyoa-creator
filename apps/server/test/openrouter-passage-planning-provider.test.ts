import { describe, expect, it } from "vitest";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { OpenRouterPassagePlanningProvider } from "../src/services/openrouter-passage-planning-provider.js";

describe("OpenRouterPassagePlanningProvider", () => {
  it("requests bounded strict structured output through stubbed HTTP without exposing credentials", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const secret = "sk-or-v1-super-secret-test-value";
    const candidate = {
      schemaId: "cyoa.passage-planning-unit-candidate",
      schemaVersion: 1,
      jobId: "job-a",
      unitId: "unit-a",
      inputFingerprint: "a".repeat(64),
      passages: [{
        id: "passage-a", sequenceId: "sequence-a", title: "A", kind: "scene", purpose: "", summary: "",
        wordTarget: 500, routeIds: [], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
        requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
        choiceIds: [], terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned", position: 0,
      }],
      choices: [], threads: [], generatedIds: [],
    };
    const fetchStub: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(candidate) } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const credentials = new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: secret } });
    const provider = new OpenRouterPassagePlanningProvider(new OpenRouterClient({ credentialStore: credentials, fetch: fetchStub }));
    const result = await provider.generate({
      mode: "generate", jobId: "job-a", unitId: "unit-a", providerId: "openrouter", modelId: "fixture/model",
      inputFingerprint: "a".repeat(64), boundedContext: { selected: ["passage-a"] },
      outputSchema: { id: "cyoa.passage-planning-unit-candidate", version: 1 },
      capabilityRequirements: { structuredOutput: true, localValidation: true },
      maximumOutputTokens: 8000, signal: new AbortController().signal,
    });
    expect(JSON.parse(result.output)).toEqual(candidate);
    expect(result).toMatchObject({ usage: { inputTokens: 120, outputTokens: 80 }, providerRepairCount: 0 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: "fixture/model", max_tokens: 8000, temperature: 0, response_format: { type: "json_object" } });
    expect(JSON.stringify({ result, bodies })).not.toContain(secret);
  });
});
