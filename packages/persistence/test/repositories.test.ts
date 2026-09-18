import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, JobRepository, openDatabase, ProjectRepository, WorkflowRepository } from "../src/index.js";

describe("SQLite repositories", () => {
  it("supports projects, immutable versions, rollback, restore, checkpoints and usage", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const jobs = new JobRepository(database);
    const project = projects.create("Demo");
    expect(projects.rename(project.id, "Renamed").name).toBe("Renamed");

    const first = artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { text: "one" }, schema: z.object({ text: z.string() }) });
    const second = artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { text: "two" } });
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(() => artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { bad: true }, schema: z.object({ text: z.string() }) })).toThrow();
    expect(() => artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { text: "three" }, simulateFailure: true })).toThrow();
    expect(artifacts.listVersions(project.id, "source")).toHaveLength(2);
    expect(artifacts.restore(project.id, "source", first.id)).toMatchObject({ version: 3, content: { text: "one" } });

    const job = jobs.create(project.id, "analysis");
    expect(jobs.checkpoint(job.id, { chapter: 2 })).toMatchObject({ checkpoint: { chapter: 2 } });
    jobs.recordUsage(job.id, { promptTokens: 10, completionTokens: 5, cost: 0.01 });
    expect(jobs.usageTotals(job.id)).toEqual({ promptTokens: 10, completionTokens: 5, cost: 0.01 });
    expect(projects.duplicate(project.id).id).not.toBe(project.id);
    database.close();
  });

  it("invalidates the canonical dependency chain", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Chain");
    for (const type of ["source", "bible", "adaptation", "routes", "drafts", "review", "export"]) {
      artifacts.saveArtifact({ projectId: project.id, artifactId: type, artifactType: type, content: { type } });
    }
    expect(artifacts.markDependentsStale(project.id, "source")).toEqual([
      "adaptation", "bible", "drafts", "export", "review", "routes",
    ]);
    database.close();
  });

  it("persists project mode and an immutable approved artifact version", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const workflow = new WorkflowRepository(database);
    const project = projects.create("Long story", undefined, "long-form");
    const first = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "First" } });

    expect(project.mode).toBe("long-form");
    expect(workflow.markDraft(project.id, "brief")).toMatchObject({ status: "draft", approvedVersionId: null });
    expect(workflow.approve(project.id, "brief", first.id)).toMatchObject({
      status: "approved",
      approvedVersionId: first.id,
    });

    artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "Second" } });
    expect(workflow.markDraft(project.id, "brief")).toMatchObject({
      status: "draft",
      approvedVersionId: first.id,
    });
    database.close();
  });

  it("enforces Creative Direction evidence ownership at the persistence boundary", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const first = projects.create("First", undefined, "long-form");
    const second = projects.create("Second", undefined, "long-form");
    const foreignBrief = artifacts.saveArtifact({ projectId: second.id, artifactId: "brief", content: { title: "Foreign" } });
    const conversations = new ConversationRepository(database);
    const foreignConversation = conversations.create(second.id, { kind: "project", projectId: second.id, stage: "brief" });
    const foreignMessage = conversations.addMessage({
      conversationId: foreignConversation.id, role: "user", content: "Foreign intent", intent: "propose",
      scope: foreignConversation.scope, context: {}, metadata: {},
    });
    const foreignProposal = new ChangeSetRepository(database).create({
      projectId: second.id, conversationId: foreignConversation.id, artifactId: "brief", baseVersionId: foreignBrief.id,
      summary: "Foreign proposal", rationale: "Must remain foreign", candidate: { title: "Changed" },
    });
    for (const reference of [
      { kind: "approved-artifact", targetId: "brief", versionId: foreignBrief.id },
      { kind: "user-message", targetId: foreignMessage.id },
      { kind: "proposal", targetId: foreignProposal.id },
    ]) {
      expect(() => artifacts.saveArtifact({
        projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
        content: { fieldProvenance: [{ fieldPath: "/tone", reference }] },
      })).toThrow(/another project|missing/);
    }
    expect(artifacts.listVersions(first.id, "creative-direction")).toHaveLength(0);
    database.close();
  });
});
