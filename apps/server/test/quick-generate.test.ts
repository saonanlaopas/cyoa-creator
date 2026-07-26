import { describe, expect, it } from "vitest";
import type { Project } from "@story-to-cyoa/domain";
import { OpenRouterError, type OpenRouterClient, type OpenRouterDiagnostic } from "@story-to-cyoa/openrouter";
import { buildApp } from "../src/app.js";
import { GenerationDiagnosticStore } from "../src/services/generation-diagnostic-store.js";

const apiKey = "sk-or-v1-test-secret-key-0123456789";
const source = "Mara returns to the flooded station before dawn, carrying the brass key her father hid years ago. She knows the town will blame her if the archive burns, but the last train still waits beyond the broken platform.";

const validProject: Project = {
  id: "generated-story",
  name: "Flooded Station",
  schemaVersion: 1,
  startPassageId: "p1",
  metadata: { protagonist: "Mara" },
  mechanics: { visibleStats: {}, relationships: {}, hiddenFlags: {}, inventory: [], protagonistTendencies: [], divergenceMode: "balanced", randomness: false },
  passages: [
    { id: "p1", title: "Platform", purpose: "choice", prose: "Mara waits.", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: null, choices: [{ id: "to-end", label: "Board", destinationId: "p2", conditions: [], effects: [], hardGate: false }] },
    { id: "p2", title: "Train", purpose: "ending", prose: "The train leaves.", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "success", choices: [] },
  ],
};

const graphInvalidProject: Project = {
  ...validProject,
  passages: [{ ...validProject.passages[0], choices: [{ ...validProject.passages[0].choices[0], destinationId: "missing" }] }, validProject.passages[1]],
};

const htmlDiagnostic: OpenRouterDiagnostic = {
  status: 502,
  contentType: "text/html",
  requestId: "req-test",
  retryAfter: null,
  body: { text: `<html>bad gateway ${apiKey} ${source.repeat(10)}</html>`, originalBytes: 1, truncated: false },
  providerError: { message: `nested ${apiKey}` },
};

type Request = { messages: Array<{ role: string; content: string }> };

class FakeStreamClient {
  public readonly requests: Request[] = [];
  public failure: OpenRouterError | undefined;
  public projects: Project[] = [graphInvalidProject, validProject];

  async generateStructuredStream(
    request: Request,
    _schema: unknown,
    callbacks: { onReasoning?: (event: { kind: "summary"; text: string }) => void; onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void; onRepair?: (attempt: number) => void },
  ) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    callbacks.onReasoning?.({ kind: "summary", text: "Mapped the route." });
    callbacks.onUsage?.({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    if (this.requests.length === 1) callbacks.onRepair?.(1);
    return { data: this.projects.shift() ?? validProject, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, cost: null, repaired: false };
  }
}

const parseNdjson = (body: string): Array<Record<string, unknown>> => body.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);

describe("quick generation stream", () => {
  it("streams ordered stages, provider reasoning, repairs, and the final result", async () => {
    const fakeClient = new FakeStreamClient();
    const app = buildApp({ openRouterClient: fakeClient as unknown as OpenRouterClient });
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    await app.inject({ method: "POST", url: "/api/commands/global", payload: { name: "Canon", instruction: "Preserve characterization." } });

    const response = await app.inject({ method: "POST", url: "/api/quick/generate", payload: { projectId, source, model: "test/model", targetPassages: 8, showReasoning: true } });
    const events = parseNdjson(response.body);
    const types = events.map((event) => event.type);

    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(types).toEqual(expect.arrayContaining(["status", "reasoning", "usage", "validation", "repair", "result"]));
    expect(events.find((event) => event.type === "repair")).toMatchObject({ phase: "structured-output" });
    expect(events.filter((event) => event.type === "repair")).toEqual(expect.arrayContaining([expect.objectContaining({ phase: "graph", attempt: 1 })]));
    expect(events.at(-1)).toMatchObject({ type: "result" });
    expect(fakeClient.requests).toHaveLength(2);
    expect(fakeClient.requests.every((request) => request.messages.map((message) => message.content).join("\n").includes("Preserve characterization."))).toBe(true);
    expect(fakeClient.requests[0].messages.map((message) => message.content).join("\n")).toContain("<source>");
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/artifacts/source/versions` })).json()).toHaveLength(1);
    await app.close();
  });

  it("stores one redacted, bounded diagnostic with a submitted-source warning", async () => {
    const fakeClient = new FakeStreamClient();
    fakeClient.failure = new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "Non-JSON response", { diagnostic: htmlDiagnostic });
    const app = buildApp({ openRouterClient: fakeClient as unknown as OpenRouterClient });
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;

    const events = parseNdjson((await app.inject({ method: "POST", url: "/api/quick/generate", payload: { projectId, source, model: "test/model" } })).body);
    const failure = events.at(-1)!;
    const diagnosticId = failure.diagnosticId as string;
    const diagnostic = await app.inject({ method: "GET", url: `/api/quick/diagnostics/${diagnosticId}` });

    expect(failure).toMatchObject({ type: "error", error: { code: "OPENROUTER_ENVELOPE_INVALID" } });
    expect(diagnostic.statusCode).toBe(200);
    expect(diagnostic.json()).toMatchObject({ containsSourceText: true, body: { truncated: true } });
    expect(diagnostic.body).toContain("bad gateway");
    expect(diagnostic.body).not.toContain(apiKey);
    await app.close();
  });

  it("replaces the previous diagnostic and rejects requests without a project", async () => {
    const fakeClient = new FakeStreamClient();
    fakeClient.failure = new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "Non-JSON response", { diagnostic: htmlDiagnostic });
    const app = buildApp({ openRouterClient: fakeClient as unknown as OpenRouterClient });
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    const first = parseNdjson((await app.inject({ method: "POST", url: "/api/quick/generate", payload: { projectId, source, model: "test/model" } })).body).at(-1)!;
    const second = parseNdjson((await app.inject({ method: "POST", url: "/api/quick/generate", payload: { projectId, source, model: "test/model" } })).body).at(-1)!;

    expect(await app.inject({ method: "GET", url: `/api/quick/diagnostics/${first.diagnosticId}` })).toMatchObject({ statusCode: 404 });
    expect(await app.inject({ method: "GET", url: `/api/quick/diagnostics/${second.diagnosticId}` })).toMatchObject({ statusCode: 200 });
    expect((await app.inject({ method: "POST", url: "/api/quick/generate", payload: { source, model: "test/model" } })).statusCode).toBe(400);
    await app.close();
  });
});

describe("generation diagnostic retention", () => {
  it("recursively redacts nested secrets and caps retained bodies", () => {
    const store = new GenerationDiagnosticStore();
    const id = store.replace({
      model: "test/model",
      provider: null,
      generationId: null,
      containsSourceText: false,
      response: htmlDiagnostic,
    }, source);
    const stored = store.get(id)!;

    expect(stored.response.body.truncated).toBe(true);
    expect(stored.response.body.text).not.toContain(apiKey);
    expect(stored.response.providerError?.message).not.toContain(apiKey);
    expect(stored.containsSourceText).toBe(true);
  });
});
