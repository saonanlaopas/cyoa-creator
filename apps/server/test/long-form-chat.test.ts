import { describe, expect, it } from "vitest";
import type { OpenRouterClient, StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";
import { defaultLongFormStoryBible, defaultProjectBrief } from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";

function fakeChatClient(): OpenRouterClient {
  return {
    async generateStructuredStream<T>(
      request: StructuredGenerationStreamRequest,
      schema: { parse(value: unknown): T },
      callbacks: { onReasoning?: (event: { kind: "summary" }) => void },
    ) {
      callbacks.onReasoning?.({ kind: "summary" });
      const prompt = request.messages.at(-1)?.content ?? "";
      const proposing = prompt.includes("User intent: propose");
      const bibleScope = prompt.includes("Selected story bible:");
      const candidate = bibleScope
        ? {
            ...defaultLongFormStoryBible({ title: "Chat Project" }),
            characters: [{
              id: "character-mara",
              name: "Mara",
              role: "Protagonist",
              summary: "A wary student.",
              motivations: ["Learn the truth"],
              knowledge: [],
              plannedArc: "Trust selectively.",
            }],
          }
        : { ...defaultProjectBrief("Chat Project"), routeTarget: 6 };
      return {
        data: schema.parse({
          message: bibleScope
            ? proposing ? "I added Mara for review." : "The bible needs a protagonist entry."
            : proposing ? "I prepared a six-route brief." : "Five routes is a sensible starting point.",
          proposal: proposing
            ? {
                summary: bibleScope ? "Add Mara to the bible" : "Expand to six routes",
                rationale: bibleScope ? "The protagonist needs a canonical record." : "Adds room for the requested branch.",
                candidate,
              }
            : null,
        }),
        usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        cost: null,
        repaired: false,
        attempts: [],
      };
    },
  } as unknown as OpenRouterClient;
}

describe("long-form scoped chat", () => {
  it("persists discussion and applies a version-bound brief proposal", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Chat Project" },
    });
    const project = created.json() as { project: { id: string }; brief: { id: string } };
    const conversationResponse = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${project.project.id}/conversations`,
      payload: {},
    });
    expect(conversationResponse.statusCode).toBe(201);
    const conversation = conversationResponse.json() as { id: string; scope: { versionId: string } };
    expect(conversation.scope.versionId).toBe(project.brief.id);

    const discussion = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${project.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Is five routes enough?", intent: "discuss", model: "offline/chat" },
    });
    expect(discussion.statusCode).toBe(201);
    expect(discussion.json()).toMatchObject({
      assistantMessage: { content: "Five routes is a sensible starting point." },
      proposal: null,
      activity: [{ kind: "summary" }],
    });

    const proposed = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${project.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Make it six routes.", intent: "propose", model: "offline/chat" },
    });
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.json().proposal as { id: string; baseVersionId: string; candidate: { routeTarget: number } };
    expect(proposal).toMatchObject({ baseVersionId: project.brief.id, candidate: { routeTarget: 6 } });

    const applied = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${project.project.id}/conversations/${conversation.id}/proposals/${proposal.id}/apply`,
    });
    expect(applied.statusCode).toBe(201);
    const appliedBody = applied.json() as { version: { id: string } };
    expect(appliedBody).toMatchObject({
      changeSet: { status: "applied" },
      version: { version: 2, content: { routeTarget: 6 } },
    });

    const continued = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${project.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "What should we plan next?", intent: "discuss", model: "offline/chat" },
    });
    expect(continued.json()).toMatchObject({
      userMessage: {
        scope: { kind: "artifact", versionId: appliedBody.version.id },
        context: { briefVersionId: appliedBody.version.id },
      },
    });

    const reloaded = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${project.project.id}/conversations/${conversation.id}`,
    });
    expect(reloaded.json()).toMatchObject({
      messages: [
        { role: "user", intent: "discuss" },
        { role: "assistant", intent: "discuss" },
        { role: "user", intent: "propose" },
        { role: "assistant", intent: "propose" },
        { role: "user", intent: "discuss" },
        { role: "assistant", intent: "discuss" },
      ],
      proposals: [{ status: "applied", appliedVersionId: expect.any(String) }],
    });
    await app.close();
  });

  it("refuses a proposal after a newer direct brief edit", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Conflict Project" },
    })).json() as { project: { id: string } };
    const conversation = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations`,
      payload: {},
    })).json() as { id: string };
    const proposed = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Make it six routes.", intent: "propose" },
    })).json() as { proposal: { id: string } };

    await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${created.project.id}/brief`,
      payload: { ...defaultProjectBrief("Conflict Project"), endingTarget: 12 },
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/proposals/${proposed.proposal.id}/apply`,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toContain("older brief version");
    await app.close();
  });

  it("scopes a proposal to the current story-bible version", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Bible Chat" },
    })).json() as { project: { id: string }; brief: { id: string } };
    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/bible`,
    })).json() as { bible: { id: string } };
    const conversation = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations`,
      payload: {},
    })).json() as { id: string };
    const scope = await app.inject({
      method: "PATCH",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/scope`,
      payload: {
        scope: {
          kind: "artifact",
          projectId: created.project.id,
          stage: "bible",
          artifactId: "bible",
          versionId: bible.bible.id,
        },
      },
    });
    expect(scope.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Add the protagonist.", intent: "propose", model: "offline/chat" },
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json().proposal as {
      id: string; artifactId: string; baseVersionId: string; candidate: { characters: unknown[] };
    };
    expect(proposal).toMatchObject({
      artifactId: "bible",
      baseVersionId: bible.bible.id,
      candidate: { characters: [expect.objectContaining({ name: "Mara" })] },
    });
    const applied = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/proposals/${proposal.id}/apply`,
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toMatchObject({
      version: { artifactId: "bible", version: 2, content: { characters: [{ name: "Mara" }] } },
    });
    await app.close();
  });
});
