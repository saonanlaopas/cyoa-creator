import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  ArtifactRepository,
  ChangeSetRepository,
  CONVERSATION_MESSAGE_BUDGETS,
  ConversationRepository,
  migrate,
  openDatabase,
  ProjectRepository,
} from "../src/index.js";

const BriefSchema = z.object({ title: z.string(), routes: z.number().int() });

describe("persistent scoped conversations and change sets", () => {
  it("upgrades legacy conversation tables without losing their rows", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'Legacy', 't', 't');
      INSERT INTO conversations (id, project_id, created_at) VALUES ('c1', 'p1', 't');
      INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES ('m1', 'c1', 'user', 'Keep this message', 't');
    `);
    migrate(database);
    expect(database.prepare("SELECT mode FROM projects WHERE id = 'p1'").get()).toEqual({ mode: "quick" });
    expect(database.prepare("SELECT title, scope_json FROM conversations WHERE id = 'c1'").get()).toEqual({
      title: "Project discussion",
      scope_json: "{}",
    });
    expect(database.prepare("SELECT content, intent FROM messages WHERE id = 'm1'").get()).toEqual({
      content: "Keep this message",
      intent: "discuss",
    });
    database.close();
  });

  it("persists message scope and atomically applies only a current-base proposal", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const conversations = new ConversationRepository(database);
    const changeSets = new ChangeSetRepository(database);
    const project = projects.create("Long story", undefined, "long-form");
    const first = artifacts.saveArtifact({
      projectId: project.id,
      artifactId: "brief",
      content: { title: "First", routes: 5 },
      schema: BriefSchema,
    });
    const scope = {
      kind: "artifact" as const,
      projectId: project.id,
      stage: "brief" as const,
      artifactId: "brief" as const,
      versionId: first.id,
    };
    const conversation = conversations.create(project.id, scope);
    conversations.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Make it broader.",
      intent: "propose",
      scope,
      context: { briefVersionId: first.id },
      metadata: {},
    });
    expect(conversations.listMessages(conversation.id)[0]).toMatchObject({
      content: "Make it broader.",
      scope,
      context: { briefVersionId: first.id },
    });

    const proposal = changeSets.create({
      projectId: project.id,
      conversationId: conversation.id,
      artifactId: "brief",
      baseVersionId: first.id,
      summary: "Add a route",
      rationale: "Broader structure",
      candidate: { title: "First", routes: 6 },
    });
    const applied = changeSets.apply(proposal.id, BriefSchema);
    expect(applied.version).toMatchObject({ version: 2, content: { title: "First", routes: 6 } });
    expect(applied.changeSet).toMatchObject({ status: "applied", appliedVersionId: applied.version.id });

    const stale = changeSets.create({
      projectId: project.id,
      conversationId: conversation.id,
      artifactId: "brief",
      baseVersionId: applied.version.id,
      summary: "Add another route",
      rationale: "More breadth",
      candidate: { title: "First", routes: 7 },
    });
    artifacts.saveArtifact({
      projectId: project.id,
      artifactId: "brief",
      content: { title: "Manual edit", routes: 6 },
      schema: BriefSchema,
    });
    expect(() => changeSets.apply(stale.id, BriefSchema)).toThrow("PROPOSAL_BASE_STALE");
    expect(changeSets.get(stale.id)?.status).toBe("superseded");
    expect(artifacts.getCurrent(project.id, "brief")?.content).toEqual({ title: "Manual edit", routes: 6 });
    database.close();
  });

  it("returns a bounded recent-message window with exact chronology and count", () => {
    const database = openDatabase();
    const project = new ProjectRepository(database).create("Long discussion", undefined, "long-form");
    const brief = new ArtifactRepository(database).saveArtifact({ projectId: project.id, artifactId: "brief",
      content: { title: "Long", routes: 5 }, schema: BriefSchema });
    const conversations = new ConversationRepository(database);
    const changes = new ChangeSetRepository(database);
    const scope = { kind: "project" as const, projectId: project.id };
    const conversation = conversations.create(project.id, scope);
    for (let index = 0; index < 230; index += 1) conversations.addMessage({
      conversationId: conversation.id, role: index % 2 ? "assistant" : "user", content: `Message ${index}`,
      intent: "discuss", scope, context: {}, metadata: {},
    });
    expect(conversations.countMessages(conversation.id)).toBe(230);
    expect(conversations.listRecentMessages(conversation.id)).toHaveLength(200);
    expect(conversations.listRecentMessages(conversation.id).map((item) => item.content).slice(0, 2))
      .toEqual(["Message 30", "Message 31"]);
    expect(conversations.listRecentMessages(conversation.id, 3).map((item) => item.content))
      .toEqual(["Message 227", "Message 228", "Message 229"]);
    for (let index = 0; index < 120; index += 1) changes.create({ projectId: project.id,
      conversationId: conversation.id, artifactId: "brief", baseVersionId: brief.id,
      summary: `Proposal ${index}`, rationale: "Bounded history", candidate: { title: "Long", routes: index + 5 } });
    expect(changes.count(conversation.id)).toBe(120);
    expect(changes.listRecent(conversation.id)).toHaveLength(100);
    expect(changes.listRecent(conversation.id)[0]?.summary).toBe("Proposal 20");
    database.close();
  });

  it("enforces role-specific UTF-8 message limits at repository and SQLite boundaries", () => {
    const database = openDatabase();
    const project = new ProjectRepository(database).create("Message bounds", undefined, "long-form");
    const conversations = new ConversationRepository(database);
    const scope = { kind: "project" as const, projectId: project.id };
    const conversation = conversations.create(project.id, scope);
    const oversized = "😀".repeat(Math.floor(CONVERSATION_MESSAGE_BUDGETS.maximumUserMessageBytes / 4) + 1);
    expect(() => conversations.addMessage({ conversationId: conversation.id, role: "user", content: oversized,
      intent: "discuss", scope, context: {}, metadata: {} })).toThrow("byte limit");
    const oversizedAssistant = "界".repeat(Math.floor(CONVERSATION_MESSAGE_BUDGETS.maximumAssistantMessageBytes / 3) + 1);
    expect(() => conversations.addMessage({ conversationId: conversation.id, role: "assistant", content: oversizedAssistant,
      intent: "discuss", scope, context: {}, metadata: {} })).toThrow("byte limit");
    expect(() => database.prepare(`INSERT INTO messages
      (id, conversation_id, role, content, intent, scope_json, context_json, metadata_json, created_at)
      VALUES ('oversized-direct', ?, 'user', ?, 'discuss', ?, '{}', '{}', 'now')`)
      .run(conversation.id, oversized, JSON.stringify(scope))).toThrow("durable byte limit");
    expect(() => database.prepare(`INSERT INTO messages
      (id, conversation_id, role, content, intent, scope_json, context_json, metadata_json, created_at)
      VALUES ('oversized-assistant-direct', ?, 'assistant', ?, 'discuss', ?, '{}', '{}', 'now')`)
      .run(conversation.id, oversizedAssistant, JSON.stringify(scope))).toThrow("durable byte limit");
    expect(conversations.countMessages(conversation.id)).toBe(0);
    database.close();
  });

  it("stales downstream artifacts when a proposal changes their base artifact", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const conversations = new ConversationRepository(database);
    const changeSets = new ChangeSetRepository(database);
    const project = projects.create("Dependency story", undefined, "long-form");
    const brief = artifacts.saveArtifact({
      projectId: project.id,
      artifactId: "brief",
      artifactType: "brief",
      content: { title: "Brief", routes: 5 },
      schema: BriefSchema,
    });
    artifacts.saveArtifact({
      projectId: project.id,
      artifactId: "bible",
      artifactType: "bible",
      content: { title: "Bible" },
      dependencies: ["brief"],
    });
    database.prepare(`
      INSERT INTO artifact_workflow_state
        (project_id, artifact_id, status, approved_version_id, updated_at)
      VALUES (?, 'bible', 'approved', NULL, 't')
    `).run(project.id);
    const conversation = conversations.create(project.id, {
      kind: "artifact",
      projectId: project.id,
      stage: "brief",
      artifactId: "brief",
      versionId: brief.id,
    });
    const proposal = changeSets.create({
      projectId: project.id,
      conversationId: conversation.id,
      artifactId: "brief",
      baseVersionId: brief.id,
      summary: "Change routes",
      rationale: "Test downstream invalidation",
      candidate: { title: "Brief", routes: 6 },
    });
    changeSets.apply(proposal.id, BriefSchema);
    expect(artifacts.getCurrent(project.id, "bible")?.stale).toBe(true);
    expect(database.prepare(`
      SELECT status FROM artifact_workflow_state WHERE project_id = ? AND artifact_id = 'bible'
    `).get(project.id)).toEqual({ status: "stale" });
    database.close();
  });
});
