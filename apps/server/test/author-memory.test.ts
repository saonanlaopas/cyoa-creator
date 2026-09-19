import { describe, expect, it } from "vitest";
import type { OpenRouterClient, StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";
import { AUTHOR_MEMORY_BUDGETS, CONVERSATION_MESSAGE_BUDGETS } from "@story-to-cyoa/persistence";
import { buildApp } from "../src/app.js";

function capturingClient(log: string[]): OpenRouterClient {
  return { async generateStructuredStream<T>(request: StructuredGenerationStreamRequest, schema: { parse(value: unknown): T }) {
    log.push(request.messages.at(-1)?.content ?? "");
    return { data: schema.parse({ message: "Decision acknowledged.", proposal: null }),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: null, repaired: false, attempts: [] };
  } } as unknown as OpenRouterClient;
}

describe("Foundation 8C author-memory API", () => {
  it("keeps decisions durable, scoped, versioned, and provider-free to inspect", async () => {
    const prompts: string[] = [];
    const app = buildApp({ openRouterClient: capturingClient(prompts) });
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Memory" } })).json() as
      { project: { id: string }; brief: { id: string }; creativeDirection: { id: string } };
    await app.inject({ method: "POST", url: `/api/long-form/projects/${created.project.id}/creative-direction/approve`,
      payload: { versionId: created.creativeDirection.id } });
    const conversation = (await app.inject({ method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations`, payload: {} })).json() as { id: string; scope: unknown };
    const pinned = await app.inject({ method: "POST", url: `/api/long-form/projects/${created.project.id}/pinned-decisions`,
      payload: { scope: { kind: "artifact", artifactId: "brief" }, content: "Forgiveness must remain possible.", relatedIds: ["ending-mercy"] } });
    expect(pinned.statusCode).toBe(201);
    const decision = pinned.json() as { stableId: string; id: string };

    const context = await app.inject({ method: "GET",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/author-memory/context?scope=${encodeURIComponent(JSON.stringify({ kind: "artifact", projectId: created.project.id, stage: "brief", artifactId: "brief", versionId: created.brief.id }))}` });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({ authority: "non-canonical-author-memory",
      decisions: [{ stableId: decision.stableId, content: "Forgiveness must remain possible." }],
      diagnostics: { omittedDecisionCount: 0 } });
    expect(prompts).toHaveLength(0);

    const sent = await app.inject({ method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "How should the ending feel?", intent: "discuss", model: "offline/test" } });
    expect(sent.statusCode).toBe(201);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Forgiveness must remain possible.");
    expect(prompts[0]).toContain("non-canonical author memory");

    const withdrawn = await app.inject({ method: "PATCH",
      url: `/api/long-form/projects/${created.project.id}/pinned-decisions/${decision.stableId}`,
      payload: { status: "withdrawn" } });
    expect(withdrawn.json()).toMatchObject({ version: 2, status: "withdrawn", supersedesVersionId: decision.id });
    const history = (await app.inject({ method: "GET",
      url: `/api/long-form/projects/${created.project.id}/pinned-decisions?history=true` })).json() as unknown[];
    expect(history).toHaveLength(2);
    await app.close();
  });

  it("rejects an oversized current message before persistence, proposal creation, or provider execution", async () => {
    const prompts: string[] = [];
    const app = buildApp({ openRouterClient: capturingClient(prompts) });
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects",
      payload: { name: "Bounded memory" } })).json() as { project: { id: string } };
    const conversation = (await app.inject({ method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations`, payload: {} })).json() as { id: string };
    const oversized = "😀".repeat(Math.floor(CONVERSATION_MESSAGE_BUDGETS.maximumUserMessageBytes / 4) + 1);
    const response = await app.inject({ method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: oversized, intent: "propose", model: "offline/test" } });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toMatch(/16[.,]000-byte limit/);
    expect(prompts).toHaveLength(0);
    const reloaded = (await app.inject({ method: "GET",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}` })).json();
    expect(reloaded.messages).toEqual([]);
    expect(reloaded.proposals).toEqual([]);
    await app.close();
  });

  it("reports a deterministic provider-conversation byte ceiling", async () => {
    const prompts: string[] = [];
    const app = buildApp({ openRouterClient: capturingClient(prompts) });
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects",
      payload: { name: "Context ceiling" } })).json() as { project: { id: string }; creativeDirection: { id: string } };
    await app.inject({ method: "POST", url: `/api/long-form/projects/${created.project.id}/creative-direction/approve`,
      payload: { versionId: created.creativeDirection.id } });
    const conversation = (await app.inject({ method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations`, payload: {} })).json() as { id: string };
    const sent = await app.inject({ method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Keep this request bounded.", intent: "discuss", model: "offline/test" } });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().contextDiagnostics).toMatchObject({
      currentMessageBytes: Buffer.byteLength("Keep this request bounded.", "utf8"),
      authorMemory: { omittedRecentMessageCount: 0 },
    });
    expect(sent.json().contextDiagnostics.providerConversationBytes)
      .toBeLessThanOrEqual(AUTHOR_MEMORY_BUDGETS.providerConversationBytes);
    expect(prompts).toHaveLength(1);
    await app.close();
  });
});
