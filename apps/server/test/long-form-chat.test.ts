import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenRouterClient, StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";
import { defaultCreativeDirection } from "@story-to-cyoa/domain";
import { ArtifactRepository, openDatabase, ProjectRepository, WorkflowRepository } from "@story-to-cyoa/persistence";
import {
  defaultLongFormRoutePlan,
  defaultLongFormEndingPlan,
  defaultLongFormStoryBible,
  defaultProjectBrief,
} from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";

function fakeChatClient(onRequest?: (request: StructuredGenerationStreamRequest) => void): OpenRouterClient {
  return {
    async generateStructuredStream<T>(
      request: StructuredGenerationStreamRequest,
      schema: { parse(value: unknown): T },
      callbacks: { onReasoning?: (event: { kind: "summary" }) => void },
    ) {
      onRequest?.(request);
      callbacks.onReasoning?.({ kind: "summary" });
      const prompt = request.messages.at(-1)?.content ?? "";
      const proposing = prompt.includes("User intent: propose");
      const bibleScope = prompt.includes("Selected story bible section:");
      const routesScope = prompt.includes("Selected route architecture section:");
      const endingsScope = prompt.includes("Selected ending architecture section:");
      const baseRoutes = defaultLongFormRoutePlan(defaultProjectBrief("Chat Project"));
      const targetId = endingsScope
        ? defaultLongFormEndingPlan(baseRoutes).endings[0]!.id
        : routesScope
          ? baseRoutes.routes[0]!.id
          : "root";
      const operation = bibleScope
        ? {
            kind: "add-item",
            targetId: "root",
            collection: "characters",
            item: {
              id: "character-mara",
              name: "Mara",
              role: "Protagonist",
              summary: "A wary student.",
              motivations: ["Learn the truth"],
              knowledge: [],
              plannedArc: "Trust selectively.",
          }
        }
        : {
            kind: "set-fields",
            targetId,
            changes: endingsScope ? { title: "Forgiveness" } : routesScope ? { name: "Forgiveness route" } : { routeTarget: 6 },
          };
      return {
        data: schema.parse({
          message: endingsScope
            ? proposing ? "I developed the forgiveness ending for review." : "The first ending needs an earned payoff."
            : routesScope
            ? proposing ? "I renamed the first route for review." : "The first route needs a distinct promise."
            : bibleScope
            ? proposing ? "I added Mara for review." : "The bible needs a protagonist entry."
            : proposing ? "I prepared a six-route brief." : "Five routes is a sensible starting point.",
          proposal: proposing
            ? {
                summary: endingsScope ? "Develop forgiveness ending" : routesScope ? "Name the forgiveness route" : bibleScope ? "Add Mara to the bible" : "Expand to six routes",
                rationale: endingsScope ? "The outcome needs a clear thematic identity." : routesScope ? "The route needs a legible identity." : bibleScope ? "The protagonist needs a canonical record." : "Adds room for the requested branch.",
                groups: [{
                  id: "requested-change",
                  label: "Requested change",
                  summary: "Apply the requested scoped edit.",
                  dependsOnGroupIds: [],
                  safeToApplyIndependently: true,
                  operations: [operation],
                }],
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

function delayedChatClient() {
  let begin!: () => void; let release!: () => void;
  const started = new Promise<void>((resolve) => { begin = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const delegate = fakeChatClient();
  const client = {
    async generateStructuredStream<T>(request: StructuredGenerationStreamRequest, schema: { parse(value: unknown): T }, callbacks: never) {
      begin(); await released;
      return delegate.generateStructuredStream(request, schema, callbacks as never);
    },
  } as unknown as OpenRouterClient;
  return { client, started, release };
}

async function approveCreativeDirection(
  app: ReturnType<typeof buildApp>,
  created: { project: { id: string }; creativeDirection: { id: string } },
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${created.project.id}/creative-direction/approve`,
    payload: { versionId: created.creativeDirection.id },
  });
  expect(response.statusCode).toBe(200);
}

describe("long-form scoped chat", () => {
  it("rejects provider completion after material Creative Direction changes in flight", async () => {
    const delayed = delayedChatClient(); const app = buildApp({ openRouterClient: delayed.client });
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Chat race" } })).json();
    await approveCreativeDirection(app, created);
    const conversation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/conversations`, payload: {},
    })).json();
    const pending = app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Propose a route change.", intent: "propose", model: "offline/chat" },
    });
    await delayed.started;
    const changed = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${created.project.id}/creative-direction`,
      payload: { ...created.creativeDirection.content, tone: { ...created.creativeDirection.content.tone, descriptors: ["material-race-change"] } },
    })).json().creativeDirection;
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/creative-direction/approve`, payload: { versionId: changed.id },
    })).statusCode).toBe(200);
    delayed.release(); const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("changed materially");
    const state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}`,
    })).json();
    expect(state.messages.map((message: { role: string }) => message.role)).toEqual(["user"]);
    expect(state.proposals).toEqual([]);
    await app.close();
  });

  it("accepts provider completion after provenance-only Creative Direction reapproval", async () => {
    const delayed = delayedChatClient(); const app = buildApp({ openRouterClient: delayed.client });
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Chat provenance race" } })).json();
    await approveCreativeDirection(app, created);
    const conversation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/conversations`, payload: {},
    })).json();
    const pending = app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Discuss this direction.", intent: "discuss", model: "offline/chat" },
    });
    await delayed.started;
    const provenanceOnly = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${created.project.id}/creative-direction`, payload: {
        ...created.creativeDirection.content, fieldProvenance: [{
          fieldPath: "/tone", reference: { kind: "manual-edit", versionId: created.creativeDirection.id, excerpt: "Explanation only" },
        }],
      },
    })).json().creativeDirection;
    expect(provenanceOnly.content.materialFingerprint).toBe(created.creativeDirection.content.materialFingerprint);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/creative-direction/approve`, payload: { versionId: provenanceOnly.id },
    })).statusCode).toBe(200);
    delayed.release(); expect((await pending).statusCode).toBe(201);
    const state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}`,
    })).json();
    expect(state.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);
    await app.close();
  });

  it("projects whole Brief and Bible provider context through Creative Direction authority", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-authority-chat-")); const databasePath = join(directory, "story.sqlite");
    const database = openDatabase(databasePath); const project = new ProjectRepository(database).create("Authority chat", "authority-chat", "long-form");
    const artifacts = new ArtifactRepository(database); const workflow = new WorkflowRepository(database);
    const briefContent = { ...defaultProjectBrief("Authority chat"), tone: "LEGACY_BRIEF_TONE_MARKER", pointOfView: "first-person" as const };
    const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: briefContent }); workflow.approve(project.id, "brief", brief.id);
    const bibleContent = {
      ...defaultLongFormStoryBible({ title: "Authority chat" }),
      proseGuidance: { ...defaultLongFormStoryBible({ title: "Authority chat" }).proseGuidance, tone: ["LEGACY_BIBLE_PROSE_MARKER"] },
    };
    const bible = artifacts.saveArtifact({ projectId: project.id, artifactId: "bible", content: bibleContent }); workflow.approve(project.id, "bible", bible.id);
    const direction = artifacts.saveArtifact({
      projectId: project.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: defaultCreativeDirection("second-person"),
    }); workflow.approve(project.id, "creative-direction", direction.id); database.close();
    const requests: StructuredGenerationStreamRequest[] = [];
    const app = buildApp({ databasePath, openRouterClient: fakeChatClient((request) => requests.push(request)) });
    try {
      const briefConversation = (await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations`, payload: {},
      })).json();
      expect((await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations/${briefConversation.id}/messages`,
        payload: { content: "Discuss the whole brief.", intent: "discuss", model: "offline/chat" },
      })).statusCode).toBe(201);
      const briefPrompt = requests.at(-1)!.messages.at(-1)!.content;
      expect(briefPrompt).not.toContain("LEGACY_BRIEF_TONE_MARKER");
      expect(briefPrompt).not.toContain('"pointOfView":"first-person"');
      expect(briefPrompt).toContain(direction.id);
      expect(briefPrompt).toContain(direction.content.materialFingerprint);

      const bibleConversation = (await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations`, payload: {},
      })).json();
      expect((await app.inject({
        method: "PATCH", url: `/api/long-form/projects/${project.id}/conversations/${bibleConversation.id}/scope`,
        payload: { scope: { kind: "artifact", projectId: project.id, stage: "bible", artifactId: "bible", versionId: bible.id } },
      })).statusCode).toBe(200);
      expect((await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations/${bibleConversation.id}/messages`,
        payload: { content: "Discuss the whole bible.", intent: "discuss", model: "offline/chat" },
      })).statusCode).toBe(201);
      const biblePrompt = requests.at(-1)!.messages.at(-1)!.content;
      expect(biblePrompt).not.toContain("LEGACY_BIBLE_PROSE_MARKER");
      expect(biblePrompt).toContain(direction.id);
      expect(biblePrompt).toContain(direction.content.materialFingerprint);
    } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("persists discussion and applies a version-bound brief proposal", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Chat Project" },
    });
    const project = created.json() as { project: { id: string }; brief: { id: string }; creativeDirection: { id: string } };
    await approveCreativeDirection(app, project);
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
    const proposal = proposed.json().proposal as { id: string; baseVersionId: string; proposal: { groups: unknown[] } };
    expect(proposal).toMatchObject({ baseVersionId: project.brief.id, proposal: { groups: [expect.any(Object)] } });

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
    })).json() as { project: { id: string }; creativeDirection: { id: string } };
    await approveCreativeDirection(app, created);
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
    expect(conflict.json().error).toContain("older content");
    await app.close();
  });

  it("scopes a proposal to the current story-bible version", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Bible Chat" },
    })).json() as { project: { id: string }; brief: { id: string }; creativeDirection: { id: string } };
    await approveCreativeDirection(app, created);
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
      id: string; artifactId: string; baseVersionId: string; proposal: { groups: unknown[] };
    };
    expect(proposal).toMatchObject({
      artifactId: "bible",
      baseVersionId: bible.bible.id,
      proposal: { groups: [expect.any(Object)] },
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

  it("scopes and applies a route-architecture proposal", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Route Chat" },
    })).json();
    const projectId = created.project.id as string;
    await approveCreativeDirection(app, created);
    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    })).json();
    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });
    const routes = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes`,
    })).json();
    const conversation = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/conversations`,
      payload: {},
    })).json();
    await app.inject({
      method: "PATCH",
      url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/scope`,
      payload: {
        scope: {
          kind: "artifact",
          projectId,
          stage: "routes",
          artifactId: "routes",
          versionId: routes.routes.id,
        },
      },
    });
    const response = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/messages`,
      payload: { content: "Make route one about forgiveness.", intent: "propose", model: "offline/chat" },
    })).json();
    expect(response.proposal).toMatchObject({
      artifactId: "routes",
      baseVersionId: routes.routes.id,
    });
    expect(response.proposal.proposal.groups[0].operations[0]).toMatchObject({ targetId: routes.routes.content.routes[0].id, changes: { name: "Forgiveness route" } });
    const applied = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/proposals/${response.proposal.id}/apply`,
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json().version).toMatchObject({ artifactId: "routes", version: 2 });
    expect(applied.json().version.content.routes[0]).toMatchObject({ name: "Forgiveness route" });
    await app.close();
  });

  it("scopes and applies an ending-architecture proposal", async () => {
    const app = buildApp({ openRouterClient: fakeChatClient() });
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Ending Chat" },
    })).json();
    const projectId = created.project.id as string;
    await approveCreativeDirection(app, created);
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`,
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });
    const routes = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes`,
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`,
      payload: { versionId: routes.routes.id },
    });
    const endings = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings`,
    })).json();
    const conversation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/conversations`, payload: {},
    })).json();
    await app.inject({
      method: "PATCH",
      url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/scope`,
      payload: { scope: {
        kind: "artifact", projectId, stage: "endings", artifactId: "endings", versionId: endings.endings.id,
      } },
    });
    const response = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/messages`,
      payload: { content: "Make the first ending about forgiveness.", intent: "propose", model: "offline/chat" },
    })).json();
    expect(response.proposal).toMatchObject({ artifactId: "endings", baseVersionId: endings.endings.id });
    expect(response.proposal.proposal.groups[0].operations[0]).toMatchObject({ targetId: endings.endings.content.endings[0].id, changes: { title: "Forgiveness" } });
    const applied = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/proposals/${response.proposal.id}/apply`,
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json().version).toMatchObject({ artifactId: "endings", version: 2 });
    await app.close();
  });

  it("rejects cross-artifact provider work before the call when Creative Direction is unapproved", async () => {
    let providerCalls = 0;
    const app = buildApp({ openRouterClient: fakeChatClient(() => { providerCalls += 1; }) });
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Unapproved Direction" },
    })).json();
    const conversation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${created.project.id}/conversations`, payload: {},
    })).json();
    const response = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${created.project.id}/conversations/${conversation.id}/messages`,
      payload: { content: "Discuss the brief.", intent: "discuss", model: "offline/chat" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("Approve Creative Direction");
    expect(providerCalls).toBe(0);
    await app.close();
  });

  it("preserves pre-A1 assistant compatibility when no Creative Direction artifact exists", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-legacy-chat-"));
    const databasePath = join(directory, "story.sqlite");
    const database = openDatabase(databasePath);
    const project = new ProjectRepository(database).create("Legacy chat", "legacy-chat", "long-form");
    new ArtifactRepository(database).saveArtifact({
      projectId: project.id, artifactId: "brief", artifactType: "brief", schemaVersion: 1,
      content: { ...defaultProjectBrief("Legacy chat"), tone: "PRE_A1_LEGACY_TONE_MARKER", pointOfView: "first-person" },
    });
    database.close();
    let providerCalls = 0; const requests: StructuredGenerationStreamRequest[] = [];
    const app = buildApp({ databasePath, openRouterClient: fakeChatClient((request) => { providerCalls += 1; requests.push(request); }) });
    try {
      const conversation = (await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations`, payload: {},
      })).json();
      const response = await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations/${conversation.id}/messages`,
        payload: { content: "Discuss this legacy brief.", intent: "discuss", model: "offline/chat" },
      });
      expect(response.statusCode).toBe(201);
      expect(providerCalls).toBe(1);
      expect(requests[0]!.messages.at(-1)!.content).toContain("PRE_A1_LEGACY_TONE_MARKER");
      expect(requests[0]!.messages.at(-1)!.content).toContain('"pointOfView":"first-person"');
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows discussion of the selected Creative Direction draft but never A1 proposals", async () => {
    const requests: StructuredGenerationStreamRequest[] = [];
    const app = buildApp({ openRouterClient: fakeChatClient((request) => requests.push(request)) });
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Direction Discussion" },
    })).json();
    const projectId = created.project.id as string;
    const draft = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: {
        ...created.creativeDirection.content,
        tone: { ...created.creativeDirection.content.tone, descriptors: ["SELECTED-DIRECTION-DRAFT"] },
      },
    })).json().creativeDirection;
    const conversation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/conversations`, payload: {},
    })).json();
    expect((await app.inject({
      method: "PATCH", url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/scope`,
      payload: { scope: {
        kind: "artifact", projectId, stage: "creative-direction",
        artifactId: "creative-direction", versionId: draft.id,
      } },
    })).statusCode).toBe(200);
    const discussed = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/messages`,
      payload: { content: "How does this direction feel?", intent: "discuss", model: "offline/chat" },
    });
    expect(discussed.statusCode).toBe(201);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages.at(-1)!.content).toContain("SELECTED-DIRECTION-DRAFT");
    const proposal = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/messages`,
      payload: { content: "Change it.", intent: "propose", model: "offline/chat" },
    });
    expect(proposal.statusCode).toBe(400);
    expect(proposal.json().error).toContain("begin in A2");
    expect(requests).toHaveLength(1);
    await app.close();
  });

  it("binds Bible discussion to the exact approved Creative Direction version", async () => {
    const requests: StructuredGenerationStreamRequest[] = [];
    const app = buildApp({ openRouterClient: fakeChatClient((request) => requests.push(request)) });
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Approved Direction Authority" },
    })).json();
    const projectId = created.project.id as string;
    await approveCreativeDirection(app, created);
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`, payload: {},
    })).json();
    const v2Response = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: {
        ...created.creativeDirection.content,
        tone: { ...created.creativeDirection.content.tone, descriptors: ["UNAPPROVED-V2-MARKER"] },
      },
    });
    expect(v2Response.statusCode).toBe(201);
    const v2 = v2Response.json().creativeDirection;
    const conversation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/conversations`, payload: {},
    })).json();
    await app.inject({
      method: "PATCH", url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/scope`,
      payload: { scope: {
        kind: "artifact", projectId, stage: "bible", artifactId: "bible", versionId: bible.bible.id,
      } },
    });

    const discuss = async (content: string) => app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/conversations/${conversation.id}/messages`,
      payload: { content, intent: "discuss", model: "offline/chat" },
    });
    expect((await discuss("Discuss the Bible using approved direction.")).statusCode).toBe(201);
    const v1Prompt = requests.at(-1)!.messages.at(-1)!.content;
    expect(v1Prompt).toContain(created.creativeDirection.id);
    expect(v1Prompt).toContain(created.creativeDirection.content.materialFingerprint);
    expect(v1Prompt).not.toContain(v2.id);
    expect(v1Prompt).not.toContain("UNAPPROVED-V2-MARKER");

    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`,
      payload: { versionId: v2.id },
    })).statusCode).toBe(200);
    expect((await discuss("Discuss it after approving V2.")).statusCode).toBe(201);
    const v2Prompt = requests.at(-1)!.messages.at(-1)!.content;
    expect(v2Prompt).toContain(v2.id);
    expect(v2Prompt).toContain(v2.content.materialFingerprint);
    expect(v2Prompt).toContain("UNAPPROVED-V2-MARKER");

    const v3Response = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: { ...v2.content, fieldProvenance: [{
        fieldPath: "/tone",
        reference: { kind: "manual-edit", versionId: v2.id, excerpt: "Provenance-only explanation" },
      }] },
    });
    expect(v3Response.statusCode).toBe(201);
    const v3 = v3Response.json().creativeDirection;
    expect(v3.content.materialFingerprint).toBe(v2.content.materialFingerprint);
    expect(v3.content.provenanceFingerprint).not.toBe(v2.content.provenanceFingerprint);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`,
      payload: { versionId: v3.id },
    })).statusCode).toBe(200);
    expect((await discuss("Discuss it after the provenance-only approval.")).statusCode).toBe(201);
    const v3Prompt = requests.at(-1)!.messages.at(-1)!.content;
    expect(v3Prompt).toContain(v3.id);
    expect(v3Prompt).toContain(v2.content.materialFingerprint);
    await app.close();
  });
});
