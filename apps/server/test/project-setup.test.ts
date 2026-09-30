import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenRouterClient, StructuredGenerationStreamRequest } from "@story-to-cyoa/openrouter";
import {
  ArtifactRepository,
  AuthorMemoryRepository,
  ConversationRepository,
  openDatabase,
  PassagePlanRepository,
  PortableProjectRepository,
  ProjectRepository,
  SetupProposalRepository,
  WorkflowRepository,
} from "@story-to-cyoa/persistence";
import type { CreativeDirection, LongFormStoryBible, ProjectBrief } from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";
import { createOfflineSetupClient } from "../src/services/offline-setup-provider.js";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ProjectSetupError, ProjectSetupService } from "../src/services/project-setup-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";

const BL_PROMPT = "I want a 20k slow-burn BL about two guys who already like each other. Warm, descriptive, lots of interiority, some angst but low melodrama.";
const MYSTERY_PROMPT = "A cozy mystery set in a seaside village where a retired librarian investigates a stolen painting. Third-person past tense, tense but gentle.";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

type Group = { id: string; artifactId: string; candidate: unknown; dependsOnGroupIds: string[]; changes: Array<{ path: string; basis: string; messageIds: string[] }> };

function harness(options: Parameters<typeof createOfflineSetupClient>[0] & { databasePath?: string } = {}) {
  const requests: StructuredGenerationStreamRequest[] = [];
  const client = createOfflineSetupClient({ ...options, onRequest: (request) => { requests.push(request); options.onRequest?.(request); } });
  const app = buildApp({ openRouterClient: client, databasePath: options.databasePath });
  const base = (projectId: string, conversationId: string) => `/api/long-form/projects/${projectId}/setup/sessions/${conversationId}`;
  const create = async (name = "Setup Project") => {
    const response = await app.inject({ method: "POST", url: "/api/long-form/setup-projects", payload: { name } });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { project: { id: string }; conversation: { id: string; purpose: string } };
    return { projectId: body.project.id, conversationId: body.conversation.id, body };
  };
  const ask = async (projectId: string, conversationId: string, content: string) =>
    app.inject({ method: "POST", url: `${base(projectId, conversationId)}/ask`, payload: { content } });
  const draft = async (projectId: string, conversationId: string) => {
    const preview = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposal-preview`, payload: {} });
    expect(preview.statusCode).toBe(200);
    return app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals`,
      payload: { expectedContextFingerprint: preview.json().contextFingerprint } });
  };
  const state = async (projectId: string) => (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json() as {
    brief: { id: string; content: ProjectBrief }; creativeDirection: { id: string; content: CreativeDirection };
    bible: { id: string; content: LongFormStoryBible } | null;
    workflow: Record<string, { status: string; approvedVersionId: string | null }>;
  };
  return { app, requests, base, create, ask, draft, state };
}

describe("A2 conversational project setup", () => {
  it("creates an ordinary long-form project with a separate, non-canonical setup conversation", async () => {
    const { app, create, requests } = harness();
    const { projectId, conversationId, body } = await create("Tidewater");
    expect(body.conversation.purpose).toBe("setup");
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}` })).json()).toMatchObject({ mode: "long-form" });
    const planning = await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/conversations` });
    expect(planning.json()).toEqual([]);
    const misuse = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/conversations/${conversationId}/messages`,
      payload: { content: "hello" } });
    expect(misuse.statusCode).toBe(404);
    const again = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/setup/sessions` });
    expect(again.json().id).toBe(conversationId);
    expect(requests).toHaveLength(0);
    await app.close();
  });

  it("stores typed notes locally without any provider call or canonical change", async () => {
    const { app, create, base, state, requests } = harness();
    const { projectId, conversationId } = await create();
    const before = await state(projectId);
    const saved = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/messages`, payload: { content: BL_PROMPT } });
    expect(saved.statusCode).toBe(201);
    const preview = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposal-preview`, payload: {} });
    expect(preview.json()).toMatchObject({ generatesProse: false, provider: { explicitStartRequired: true }, diagnostics: { cost: "unknown", userMessageCount: 1 } });
    expect(requests).toHaveLength(0);
    const after = await state(projectId);
    expect(after.brief.id).toBe(before.brief.id);
    expect(after.creativeDirection.id).toBe(before.creativeDirection.id);
    await app.close();
  });

  it("answers a messy one-message prompt with understanding, few questions, and readiness while changing nothing", async () => {
    const { app, create, ask, state, base } = harness();
    const { projectId, conversationId } = await create();
    const before = await state(projectId);
    const response = await ask(projectId, conversationId, BL_PROMPT);
    expect(response.statusCode).toBe(201);
    const body = response.json();
    const messageId = body.userMessage.id as string;
    expect(body.reply.readiness).toBe("ready-to-propose");
    expect(body.reply.questions.length).toBeGreaterThan(0);
    expect(body.reply.questions.length).toBeLessThanOrEqual(3);
    expect(body.reply.questions[0].question).toContain("20,000");
    const slowBurn = body.reply.understanding.items.find((item: { id: string }) => item.id === "slow-burn");
    expect(slowBurn).toMatchObject({ basis: "stated", messageIds: [messageId] });
    expect(body.reply.understanding.items.find((item: { id: string }) => item.id === "length").statement).toContain("until you confirm");
    expect(body.reply.understanding.unresolved.map((item: { id: string }) => item.id)).toContain("length-scope");
    const after = await state(projectId);
    expect(after.brief.id).toBe(before.brief.id);
    expect(after.creativeDirection.id).toBe(before.creativeDirection.id);
    expect(after.bible).toBeNull();
    const session = (await app.inject({ method: "GET", url: base(projectId, conversationId) })).json();
    expect(session.notice).toContain("non-canonical");
    expect(session.understanding).toMatchObject({ readiness: "ready-to-propose" });
    expect(session.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);
    await app.close();
  });

  it("drafts reviewable Brief, Creative Direction, and Bible seed proposals without applying or generating prose", async () => {
    const { app, create, ask, draft, state, requests } = harness();
    const { projectId, conversationId } = await create();
    const first = (await ask(projectId, conversationId, BL_PROMPT)).json().userMessage.id as string;
    const before = await state(projectId);
    const response = await draft(projectId, conversationId);
    expect(response.statusCode).toBe(201);
    const proposal = response.json().proposal;
    expect(proposal.status).toBe("proposed");
    expect(proposal.groups.map((group: Group) => group.id)).toEqual(["brief", "creative-direction", "bible-seeds"]);
    const groups = new Map<string, Group>(proposal.groups.map((group: Group) => [group.id, group]));
    const brief = groups.get("brief")!.candidate as ProjectBrief;
    expect(brief.typicalPlaythroughWordTarget).toBe(20_000);
    expect(brief.totalWordTarget).toBe(60_000);
    expect(brief.tone).toBe(before.brief.content.tone);
    expect(brief.pointOfView).toBe(before.brief.content.pointOfView);
    expect(brief.sourceMode).toBe("original-premise");
    expect(brief.unresolvedQuestions.join(" ")).toContain("one read-through or the whole project");
    const lengthChange = groups.get("brief")!.changes.find((change) => change.path === "/typicalPlaythroughWordTarget")!;
    expect(lengthChange.basis).toBe("inferred");
    const direction = groups.get("creative-direction")!.candidate as CreativeDirection;
    expect(direction.pacing.developmentPace).toBe("slow-burn");
    expect(direction.prose).toMatchObject({ interiority: "high", descriptiveness: "descriptive", treatment: "long-form" });
    expect(direction.tone.descriptors).toContain("warm");
    expect(direction.tone.exclusions).toContain("melodramatic");
    expect(direction.relationshipPresentation?.projectDefault?.customGuidance).toContain("already have feelings");
    expect(direction.relationshipPresentation?.profiles).toEqual([]);
    expect(direction.fieldProvenance, JSON.stringify(direction.fieldProvenance)).toContainEqual(expect.objectContaining({
      fieldPath: "/pacing/developmentPace", reference: expect.objectContaining({ kind: "user-message", targetId: first }),
    }));
    expect(direction.fieldProvenance).toContainEqual(expect.objectContaining({
      fieldPath: "/pacing/quietScenesAllowed", reference: expect.objectContaining({ kind: "proposal", targetId: proposal.id }),
    }));
    const bible = groups.get("bible-seeds")!;
    expect(bible.dependsOnGroupIds).toEqual(["brief", "creative-direction"]);
    const seeds = bible.candidate as LongFormStoryBible;
    expect(seeds.characters.map((character) => character.name)).toEqual(["First lead (unnamed)", "Second lead (unnamed)"]);
    expect(seeds.relationships[0]).toMatchObject({ label: "Slow-burn romance", currentState: expect.stringContaining("already like each other") });
    expect(seeds.proseGuidance).toEqual({ tone: [], pointOfView: "", style: [], avoid: [] });
    expect(requests.at(-1)!.maxTokens).toBeLessThanOrEqual(6_000);
    const after = await state(projectId);
    expect(after.brief.id).toBe(before.brief.id);
    expect(after.creativeDirection.id).toBe(before.creativeDirection.id);
    expect(after.bible).toBeNull();
    const passages = await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` });
    expect(passages.statusCode === 404 || passages.json().structure == null).toBe(true);
    await app.close();
  });

  it("requires the exact previewed context before drafting", async () => {
    const { app, create, ask, base, requests } = harness();
    const { projectId, conversationId } = await create();
    await ask(projectId, conversationId, BL_PROMPT);
    const preview = (await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposal-preview`, payload: {} })).json();
    await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/messages`, payload: { content: "Also: set in a quiet coastal town." } });
    const callsBefore = requests.length;
    const stale = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals`,
      payload: { expectedContextFingerprint: preview.contextFingerprint } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("setup_context_stale");
    const missing = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals`, payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(requests.length).toBe(callsBefore);
    const session = (await app.inject({ method: "GET", url: base(projectId, conversationId) })).json();
    expect(session.proposals).toEqual([]);
    await app.close();
  });

  it("refines understanding and proposals across turns and supersedes the earlier draft", async () => {
    const { app, create, ask, draft, base } = harness();
    const { projectId, conversationId } = await create();
    await ask(projectId, conversationId, BL_PROMPT);
    const firstProposal = (await draft(projectId, conversationId)).json().proposal;
    const second = (await ask(projectId, conversationId,
      "The 20k is the whole thing, every branch included. Their names are... actually, they're named Haru and Ren. First-person present tense, set in a small mountain town.")).json();
    expect(second.reply.understanding.items.find((item: { id: string }) => item.id === "length").statement).toContain("whole project");
    expect(second.reply.questions.map((question: { id: string }) => question.id)).not.toContain("length-scope");
    const refined = (await draft(projectId, conversationId)).json().proposal;
    const session = (await app.inject({ method: "GET", url: base(projectId, conversationId) })).json();
    expect(session.proposals.find((item: { id: string }) => item.id === firstProposal.id).status).toBe("superseded");
    const groups = new Map<string, Group>(refined.groups.map((group: Group) => [group.id, group]));
    const brief = groups.get("brief")!.candidate as ProjectBrief;
    expect(brief.totalWordTarget).toBe(175_000);
    expect(brief.projectConstraints.join(" ")).toContain("about 20,000 words");
    expect(brief.protagonist).toBe("Haru");
    const direction = groups.get("creative-direction")!.candidate as CreativeDirection;
    expect(direction.prose).toMatchObject({ pointOfView: "first-person", tense: "present" });
    const seeds = groups.get("bible-seeds")!.candidate as LongFormStoryBible;
    expect(seeds.characters.map((character) => character.name)).toEqual(["Haru", "Ren"]);
    expect(seeds.settings.map((setting) => setting.label)).toEqual(["Small mountain town"]);
    const stale = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals/${firstProposal.id}/apply`, payload: {} });
    expect(stale.statusCode).toBe(409);
    await app.close();
  });

  it("applies selected dependency-safe groups atomically as drafts, never approvals", async () => {
    const { app, create, ask, draft, base, state } = harness();
    const { projectId, conversationId } = await create();
    const messageId = (await ask(projectId, conversationId, BL_PROMPT)).json().userMessage.id as string;
    const proposal = (await draft(projectId, conversationId)).json().proposal;
    const url = `${base(projectId, conversationId)}/proposals/${proposal.id}/apply`;
    const unsafe = await app.inject({ method: "POST", url, payload: { groupIds: ["bible-seeds"] } });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json().error).toContain("also needs brief, creative-direction");
    expect((await state(projectId)).bible).toBeNull();

    const applied = await app.inject({ method: "POST", url, payload: {} });
    expect(applied.statusCode).toBe(201);
    const result = applied.json();
    expect(result.proposal.status).toBe("applied");
    expect(result.createdVersions.map((item: { artifactId: string }) => item.artifactId)).toEqual(["brief", "creative-direction", "bible"]);
    const current = await state(projectId);
    expect(current.workflow.brief).toMatchObject({ status: "draft", approvedVersionId: null });
    expect(current.workflow["creative-direction"]).toMatchObject({ status: "draft", approvedVersionId: null });
    expect(current.workflow.bible).toMatchObject({ status: "draft", approvedVersionId: null });
    expect(current.brief.content.typicalPlaythroughWordTarget).toBe(20_000);
    expect(current.creativeDirection.content.pacing.developmentPace).toBe("slow-burn");
    expect(current.creativeDirection.content.fieldProvenance).toContainEqual(expect.objectContaining({
      reference: expect.objectContaining({ kind: "user-message", targetId: messageId }),
    }));
    expect(current.bible!.content.characters).toHaveLength(2);
    const approveBible = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: current.bible!.id } });
    expect(approveBible.statusCode).toBeGreaterThanOrEqual(400);
    expect(approveBible.json().error).toContain("Approve brief");
    const again = await app.inject({ method: "POST", url, payload: {} });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("applies one independent group and refuses to overwrite newer canonical work", async () => {
    const { app, create, ask, draft, base, state } = harness();
    const { projectId, conversationId } = await create();
    await ask(projectId, conversationId, BL_PROMPT);
    const proposal = (await draft(projectId, conversationId)).json().proposal;
    const directionOnly = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals/${proposal.id}/apply`,
      payload: { groupIds: ["creative-direction"] } });
    expect(directionOnly.statusCode).toBe(201);
    const afterDirection = await state(projectId);
    expect(afterDirection.brief.content.typicalPlaythroughWordTarget).toBe(50_000);
    expect(afterDirection.bible).toBeNull();

    await ask(projectId, conversationId, "Please keep it cozy too.");
    const next = (await draft(projectId, conversationId)).json().proposal;
    const briefNow = (await state(projectId)).brief.content;
    const manual = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/brief`, payload: { ...briefNow, premise: "Manual edit wins." } });
    expect(manual.statusCode).toBeLessThan(300);
    const before = await state(projectId);
    const stale = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals/${next.id}/apply`, payload: {} });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("setup_proposal_stale");
    const after = await state(projectId);
    expect(after.brief.id).toBe(before.brief.id);
    expect(after.creativeDirection.id).toBe(before.creativeDirection.id);
    expect(after.bible).toBeNull();
    const session = (await app.inject({ method: "GET", url: base(projectId, conversationId) })).json();
    expect(session.proposals.find((item: { id: string }) => item.id === next.id).status).toBe("superseded");
    await app.close();
  });

  it("keeps non-romance projects free of romance and relationship assumptions", async () => {
    const { app, create, ask, draft } = harness();
    const { projectId, conversationId } = await create("Salt and Ink");
    const reply = (await ask(projectId, conversationId, MYSTERY_PROMPT)).json().reply;
    expect(reply.understanding.items.map((item: { id: string }) => item.id)).not.toContain("no-romance");
    expect(JSON.stringify(reply)).not.toMatch(/romance|romantic|intimacy|sensual/i);
    expect(JSON.stringify(reply.questions)).not.toMatch(/romance|love/i);
    const proposal = (await draft(projectId, conversationId)).json().proposal;
    const text = JSON.stringify(proposal.groups).toLowerCase();
    const direction = proposal.groups.find((group: Group) => group.id === "creative-direction").candidate as CreativeDirection;
    expect(direction.relationshipPresentation).toBeUndefined();
    expect(direction.prose).toMatchObject({ pointOfView: "third-person-close", tense: "past" });
    expect(direction.tone.descriptors).toEqual(expect.arrayContaining(["cozy", "tense", "tender"]));
    const bible = proposal.groups.find((group: Group) => group.id === "bible-seeds").candidate as LongFormStoryBible;
    expect(bible.relationships).toEqual([]);
    expect(bible.settings.map((setting) => setting.label)).toEqual(["Seaside village"]);
    expect(bible.unresolvedQuestions.map((question) => question.id)).toContain("question-mystery-core");
    expect(text).not.toMatch(/romance|romantic|intimacy|sensual/);
    await app.close();
  });

  it("asks for a premise instead of inventing one when the author is vague", async () => {
    const { app, create, ask } = harness();
    const { projectId, conversationId } = await create();
    const reply = (await ask(projectId, conversationId, "Something with a nice vibe.")).json().reply;
    expect(reply.readiness).toBe("needs-input");
    expect(reply.questions.map((question: { id: string }) => question.id)).toEqual(["premise", "feel"]);
    await app.close();
  });

  it("downgrades uncited 'stated' claims and discards malformed provider output", async () => {
    const liar = harness({ transform: (value, prompt) => prompt.startsWith("You are Studio, helping")
      ? { ...(value as object), understanding: { summary: "x", items: [{ id: "fake", topic: "genre", statement: "Author said horror.",
          basis: "stated", messageIds: ["not-a-message"], excerpt: "" }], unresolved: [] } }
      : value });
    const created = await liar.create();
    const reply = (await liar.ask(created.projectId, created.conversationId, BL_PROMPT)).json().reply;
    expect(reply.understanding.items[0]).toMatchObject({ basis: "inferred", messageIds: [] });
    await liar.app.close();

    const broken = harness({ transform: (value, prompt) => prompt.startsWith("You are Studio, drafting") ? { message: "oops" } : value });
    const project = await broken.create();
    await broken.ask(project.projectId, project.conversationId, BL_PROMPT);
    const response = await broken.draft(project.projectId, project.conversationId);
    expect(response.statusCode).toBe(502);
    const session = (await broken.app.inject({ method: "GET", url: broken.base(project.projectId, project.conversationId) })).json();
    expect(session.proposals).toEqual([]);
    expect(session.messages.filter((message: { metadata: { kind?: string } }) => message.metadata.kind === "setup-proposal")).toEqual([]);
    await broken.app.close();
  });

  it("discards a late provider result when the conversation changed in flight", async () => {
    let release!: () => void; let started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    let delayNext = false;
    const { app, create, base } = harness({ delay: async () => {
      if (!delayNext) return;
      delayNext = false; started(); await new Promise<void>((resolve) => { release = resolve; });
    } });
    const { projectId, conversationId } = await create();
    await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/messages`, payload: { content: BL_PROMPT } });
    delayNext = true;
    const pending = app.inject({ method: "POST", url: `${base(projectId, conversationId)}/ask`, payload: {} });
    await begun;
    await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/messages`, payload: { content: "Actually, make it a horror story." } });
    release();
    const response = await pending;
    expect(response.statusCode).toBe(409);
    const session = (await app.inject({ method: "GET", url: base(projectId, conversationId) })).json();
    expect(session.messages.every((message: { role: string }) => message.role === "user")).toBe(true);
    await app.close();
  });

  it("rejects a proposal without touching canonical state", async () => {
    const { app, create, ask, draft, base, state } = harness();
    const { projectId, conversationId } = await create();
    await ask(projectId, conversationId, BL_PROMPT);
    const before = await state(projectId);
    const proposal = (await draft(projectId, conversationId)).json().proposal;
    const rejected = await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals/${proposal.id}/reject` });
    expect(rejected.json().status).toBe("rejected");
    expect((await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals/${proposal.id}/apply`, payload: {} })).statusCode).toBe(409);
    expect((await state(projectId)).brief.id).toBe(before.brief.id);
    await app.close();
  });

  it("keeps applied setup projects backup-, portable-, and duplication-safe", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-setup-portable-")); directories.push(directory);
    const databasePath = join(directory, "studio.sqlite");
    const { app, create, ask, draft, base } = harness({ databasePath });
    const { projectId, conversationId } = await create();
    await ask(projectId, conversationId, BL_PROMPT);
    const proposal = (await draft(projectId, conversationId)).json().proposal;
    expect((await app.inject({ method: "POST", url: `${base(projectId, conversationId)}/proposals/${proposal.id}/apply`, payload: {} })).statusCode).toBe(201);
    const backup = await app.inject({ method: "POST", url: `/api/projects/${projectId}/recovery/backups` });
    expect(backup.statusCode).toBe(200);
    const duplicate = await app.inject({ method: "POST", url: `/api/projects/${projectId}/duplicate`, payload: { name: "Copy" } });
    expect(duplicate.statusCode).toBe(201);
    const copyId = duplicate.json().id as string;
    const copied = (await app.inject({ method: "GET", url: `/api/long-form/projects/${copyId}` })).json();
    expect(copied.creativeDirection.content.materialFingerprint).toBeDefined();
    const copiedSession = (await app.inject({ method: "POST", url: `/api/long-form/projects/${copyId}/setup/sessions` })).json();
    expect(copiedSession.id).not.toBe(conversationId);
    const exported = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/publication/exports/portable` })).rawPayload;
    await app.close();

    const target = openDatabase(":memory:");
    const service = new PublicationExportService(new PortableProjectRepository(target), undefined);
    const imported = service.importPortable(new Uint8Array(exported));
    const direction = new ArtifactRepository(target).getCurrent<CreativeDirection>(imported.projectId, "creative-direction")!.content;
    const conversational = direction.fieldProvenance.filter((record) => ["user-message", "proposal"].includes(record.reference.kind));
    expect(conversational.length).toBeGreaterThan(0);
    expect(conversational.every((record) => record.reference.unavailable === true)).toBe(true);
    expect(direction.pacing.developmentPace).toBe("slow-burn");
    target.close();
  });

  it("cancels an in-flight Ask Studio request without saving a reply", async () => {
    const database = openDatabase(":memory:");
    const projects = new ProjectRepository(database); const artifacts = new ArtifactRepository(database);
    const workflow = new WorkflowRepository(database); const conversations = new ConversationRepository(database);
    const passagePlans = new PassagePlanRepository(database);
    const longForm = new LongFormProjectService(projects, artifacts, workflow, undefined, passagePlans);
    const controller = new AbortController();
    const client = createOfflineSetupClient({ delay: async () => { controller.abort(); } });
    const service = new ProjectSetupService(database, artifacts, workflow, conversations, new AuthorMemoryRepository(database),
      new SetupProposalRepository(database), longForm, passagePlans, client as OpenRouterClient);
    const { project, conversation } = service.createProject("Cancel me");
    await expect(service.ask(project.id, conversation.id, { content: BL_PROMPT, signal: controller.signal }))
      .rejects.toMatchObject({ status: 499 } satisfies Partial<ProjectSetupError>);
    expect(conversations.listMessages(conversation.id).map((message) => message.role)).toEqual(["user"]);
    database.close();
  });
});
