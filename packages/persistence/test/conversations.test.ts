import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  ArtifactRepository,
  ChangeSetRepository,
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
});
