import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { builtinFictionCraft, sha256, type AuthoringInstructions } from "@story-to-cyoa/domain";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { OpenRouterPassageDraftingProvider } from "../src/services/openrouter-passage-drafting-provider.js";
import { OpenRouterPassagePlanningProvider } from "../src/services/openrouter-passage-planning-provider.js";
import { OpenRouterNarrativeReviewProvider } from "../src/services/openrouter-narrative-review-provider.js";
import { OpenRouterRepairProposalProvider } from "../src/services/openrouter-repair-proposal-provider.js";
import { OpenRouterEditProvider } from "../src/services/conversational-edit-provider.js";
const guide = builtinFictionCraft(), instruction = "Present tense. Prioritize the project's spare voice.";
function instructions(enabled: boolean): AuthoringInstructions { return { schemaVersion: 1, policy: "fiction-craft-v1", settingsVersionId: "settings-1", enabled, origin: "author-choice", selectedGuide: { id: guide.id, version: guide.version, sha256: guide.sha256 }, appliedGuide: enabled ? guide : null, customInstructions: [{ id: "custom-1", name: "Voice", scope: "project", instruction, sha256: sha256(instruction), position: 0 }] }; }
const captured: Array<{ path: string; enabled: boolean; mode: string; body: unknown }> = [];
describe("actual provider request instruction delivery, mocked HTTP only", () => {
  for (const [path, Provider] of [["draft", OpenRouterPassageDraftingProvider], ["plan", OpenRouterPassagePlanningProvider], ["review", OpenRouterNarrativeReviewProvider], ["prose-revision", OpenRouterRepairProposalProvider]] as const) {
    it.each([true, false])(`${path} pins on/off and exact custom preferences for generate and format repair: %s`, async enabled => {
      for (const mode of ["generate", "repair"] as const) {
        let body: any;
        const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "mock-only" } }), fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })); } });
        const request = { mode, modelId: "neutral-mock", providerId: "mock", jobId: "job", unitId: "unit", inputFingerprint: "a".repeat(64), contextFingerprint: "b".repeat(64), boundedContext: { authoringInstructions: instructions(enabled), task: "A neutral room." }, context: { authoringInstructions: instructions(enabled), task: "A neutral room." }, maximumOutputTokens: 500, signal: new AbortController().signal, categories: [], repair: { malformedOutput: '{"prose":"Leave."', validationIssues: ["wrapper"] } };
        await new Provider(client).generate(request as any);
        const serialized = JSON.stringify(body.messages);
        expect(body.messages.filter((m: any) => m.content.includes(guide.text))).toHaveLength(enabled ? 1 : 0);
        expect(serialized).toContain(instruction); expect(serialized).toContain(guide.sha256);
        expect(body.messages[0].role).toBe("system"); expect(body.messages.at(-1).role).toBe("user");
        expect(body.max_tokens).toBe(500); expect(body.messages.at(-1).content).toContain("A neutral room.");
        if (mode === "repair") expect(body.messages.at(-1).content).toContain("Leave.");
        captured.push({ path, enabled, mode, body });
      }
    });
  }
  it.each([true,false])("A6 creative editing uses the same guide edition while preserving fixed edit authority: %s", async enabled => {
    let body: any;
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "mock-only" } }), fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"A scoped draft","groups":[]}' } }] })); } });
    await new OpenRouterEditProvider(client).generate({ request: { modelId: "neutral-mock", intent: "discuss", message: "Keep the room quiet" }, context: { authoringInstructions: instructions(enabled), approvedDirection: { versionId: "direction-1", context: { prose: { customGuidance: "Spare and warm" } } } } } as any, new AbortController().signal);
    expect(body.messages.filter((m: any) => m.content.includes(guide.text))).toHaveLength(enabled ? 1 : 0);
    expect(body.messages[0].content).toContain("Never change IDs"); expect(body.messages.at(-1).content).toContain("Spare and warm");
    captured.push({ path: "A6", enabled, mode: "discuss", body });
  });
  it("publishes sanitized captured requests when an evidence directory is selected", () => { if (process.env.CYOA_CRAFT_EVIDENCE) { mkdirSync(process.env.CYOA_CRAFT_EVIDENCE, { recursive: true }); writeFileSync(process.env.CYOA_CRAFT_EVIDENCE+"/provider-requests.json", JSON.stringify(captured, null, 2)+"\n"); } expect(captured).toHaveLength(18); });
});

describe("Creator HTTP paths through a real client with mocked provider responses", () => {
  it("Quick rejects full-envelope overflow before any provider request", async () => {
    const { buildApp } = await import("../src/app.js"); let calls = 0;
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "mock-only" } }), fetch: async () => { calls++; throw new Error("No provider request permitted"); } });
    const app = buildApp({ openRouterClient: client });
    try {
      const { projectId } = (await app.inject({ method: "POST", url: "/api/quick/drafts" })).json();
      const result = await app.inject({ method: "POST", url: "/api/quick/generate", payload: { projectId, source: "A visitor considers a quiet invitation. Nothing has been promised, and leaving remains possible. The room is warm and ordinary.", instructions: "x".repeat(250_001) } });
      const events = result.body.trim().split("\n").map(line => JSON.parse(line));
      expect(events.find(e => e.type === "error").error).toMatchObject({ code: "AUTHORING_CONTEXT_OVERFLOW", retryable: false });
      expect(events.some(e => e.type === "result")).toBe(false); expect(calls).toBe(0);
    } finally { await app.close(); }
  });

  it.each([true, false])("Quick schema repair retains instructions and rejects changed fiction with guide=%s", async enabled => {
    const { ProjectSchema } = await import("@story-to-cyoa/domain"), { buildApp } = await import("../src/app.js");
    const project = ProjectSchema.parse({ id: "neutral", name: "A Quiet Room", startPassageId: "end", mechanics: {}, passages: [{ id: "end", title: "The room", prose: "I will not promise.\n\nThe room is quiet.", ending: "success" }] });
    const requests: any[] = [];
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "mock-only" } }), fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const content = requests.length === 1 ? JSON.stringify(project).slice(0,-1) : JSON.stringify({ ...project, passages: [{ ...project.passages[0], prose: "I promise." }] });
      return new Response("data: "+JSON.stringify({ choices: [{ delta: { content } }] })+"\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    } });
    const app = buildApp({ openRouterClient: client });
    try {
      const { projectId } = (await app.inject({ method: "POST", url: "/api/quick/drafts" })).json();
      const url = `/api/projects/${projectId}/authoring/`;
      if (!enabled) { const current = (await app.inject({ method: "POST", url: url+"read_authoring_settings", payload: {} })).json(), input = { expectedVersionId: current.versionId, enabled: false };
        const review = (await app.inject({ method: "POST", url: url+"review_authoring_settings", payload: input })).json();
        expect((await app.inject({ method: "POST", url: url+"apply_authoring_settings", payload: { ...input, fingerprint: review.fingerprint, operationId: crypto.randomUUID(), approved: true } })).statusCode).toBe(200);
      }
      await app.inject({ method: "POST", url: `/api/projects/${projectId}/commands`, payload: { name: "Voice", instruction } });
      const response = await app.inject({ method: "POST", url: "/api/quick/generate", payload: { projectId, source: "A visitor sits in a quiet room and considers an invitation. The invitation can be refused without punishment. Nothing has yet been promised.", instructions: "Preserve the refusal." } });
      const events = response.body.trim().split("\n").map(line => JSON.parse(line));
      expect(events.find(e => e.type === "error").error.code).toBe("format_repair_content_changed"); expect(events.some(e => e.type === "result")).toBe(false); expect(requests).toHaveLength(2);
      for (const request of requests) { expect(request.messages.filter((m: any) => m.content.includes(guide.text))).toHaveLength(enabled ? 1 : 0); expect(JSON.stringify(request.messages)).toContain(instruction); expect(JSON.stringify(request.messages)).toContain("Preserve the refusal."); }
      if (process.env.CYOA_CRAFT_EVIDENCE) writeFileSync(process.env.CYOA_CRAFT_EVIDENCE+`/quick-${enabled}-requests.json`, JSON.stringify(requests,null,2)+"\n");
    } finally { await app.close(); }
  });
  it.each([true, false])("A2 Ask/propose sends exact enabled-state instructions through mocked HTTP: %s", async enabled => {
    const { buildApp } = await import("../src/app.js"), { offlineSetupResponse } = await import("../src/services/offline-setup-provider.js");
    const requests: any[] = [];
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "mock-only" } }), fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); requests.push(request);
      const content = JSON.stringify(offlineSetupResponse(request.messages.at(-1).content));
      return new Response("data: "+JSON.stringify({ choices: [{ delta: { content } }] })+"\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    } });
    const app = buildApp({ openRouterClient: client });
    try {
      const created = (await app.inject({ method: "POST", url: "/api/long-form/setup-projects", payload: { name: "A Quiet Mystery" } })).json(), projectId = created.project.id;
      const root = `/api/long-form/projects/${projectId}/setup/sessions/${created.conversation.id}`, url = `/api/projects/${projectId}/authoring/`;
      if (!enabled) { const current = (await app.inject({ method: "POST", url: url+"read_authoring_settings", payload: {} })).json(), input = { expectedVersionId: current.versionId, enabled: false };
        const review = (await app.inject({ method: "POST", url: url+"review_authoring_settings", payload: input })).json();
        expect((await app.inject({ method: "POST", url: url+"apply_authoring_settings", payload: { ...input, fingerprint: review.fingerprint, operationId: crypto.randomUUID(), approved: true } })).statusCode).toBe(200);
      }
      await app.inject({ method: "POST", url: `/api/projects/${projectId}/commands`, payload: { name: "Voice", instruction } });
      const asked = await app.inject({ method: "POST", url: root+"/ask", payload: { content: "A 20k cozy mystery set in a village where a retired librarian investigates a stolen painting. Third-person past tense, tense but gentle. No romance." } }); expect(asked.statusCode).toBe(201);
      const preview = (await app.inject({ method: "POST", url: root+"/proposal-preview", payload: {} })).json();
      const proposed = await app.inject({ method: "POST", url: root+"/proposals", payload: { expectedContextFingerprint: preview.contextFingerprint } }); expect(proposed.statusCode).toBe(201);
      expect(proposed.json().assistantMessage.metadata.authoringInstructions.enabled).toBe(enabled);
      expect(preview.diagnostics.serializedRequestBytes).toBe(Buffer.byteLength(JSON.stringify(requests[1].messages)));
      expect(requests).toHaveLength(2); for (const request of requests) { expect(request.messages.filter((m: any) => m.content.includes(guide.text))).toHaveLength(enabled ? 1 : 0); expect(JSON.stringify(request.messages)).toContain(instruction); }
      if (process.env.CYOA_CRAFT_EVIDENCE) writeFileSync(process.env.CYOA_CRAFT_EVIDENCE+`/setup-${enabled}-requests.json`, JSON.stringify(requests,null,2)+"\n");
    } finally { await app.close(); }
  });
});
