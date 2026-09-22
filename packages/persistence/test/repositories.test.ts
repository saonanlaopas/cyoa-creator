import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  creativeDirectionFingerprints,
  defaultCreativeDirection,
  normalizeCreativeDirection,
} from "@story-to-cyoa/domain";
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

  it("enforces the complete Creative Direction contract without a caller-supplied schema", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const workflow = new WorkflowRepository(database);
    const first = projects.create("First", undefined, "long-form");
    const second = projects.create("Second", undefined, "long-form");
    const valid = defaultCreativeDirection();
    expect(artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction", content: valid,
    }).content).toEqual(valid);

    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: { ...valid, materialFingerprint: "0".repeat(64) },
    })).toThrow(/Material fingerprint/);
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: { ...valid, provenanceFingerprint: "0".repeat(64) },
    })).toThrow(/Provenance fingerprint/);
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: { schemaId: "cyoa.creative-direction", schemaVersion: 1 },
    })).toThrow();
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "brief", content: valid,
    })).toThrow(/identity/);
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "brief", artifactType: "creative-direction", content: valid,
    })).toThrow(/identity/);

    const withProfile = normalizeCreativeDirection({
      ...valid,
      relationshipPresentation: { profiles: [{
        id: "profile-friends", relationshipKind: "friendship", relationshipId: "relationship-friends",
        participantIds: [], developmentStyle: "steady", emotionalTension: "moderate", melodrama: "low",
        mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [],
      }] },
    });
    const invalidPath = {
      ...withProfile,
      fieldProvenance: [{ fieldPath: "/banana", reference: { kind: "manual-edit" as const } }],
    };
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: { ...invalidPath, ...creativeDirectionFingerprints(invalidPath) },
    })).toThrow(/material field/);
    const invalidScopedPath = {
      ...withProfile,
      fieldProvenance: [{
        fieldPath: "/relationshipPresentation/profiles/not-a-real-profile/foo",
        stableEntityId: "not-a-real-profile",
        reference: { kind: "manual-edit" as const },
      }],
    };
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: { ...invalidScopedPath, ...creativeDirectionFingerprints(invalidScopedPath) },
    })).toThrow(/does not resolve/);
    const mismatchedEntity = {
      ...withProfile,
      fieldProvenance: [{
        fieldPath: "/relationshipPresentation/profiles/profile-friends/customGuidance",
        stableEntityId: "profile-other",
        reference: { kind: "manual-edit" as const },
      }],
    };
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: { ...mismatchedEntity, ...creativeDirectionFingerprints(mismatchedEntity) },
    })).toThrow(/stableEntityId must match/);

    const foreignBrief = artifacts.saveArtifact({ projectId: second.id, artifactId: "brief", content: { title: "Foreign" } });
    workflow.approve(second.id, "brief", foreignBrief.id);
    const localUnapprovedBrief = artifacts.saveArtifact({ projectId: first.id, artifactId: "brief", content: { title: "Local draft" } });
    const localApprovedBrief = artifacts.saveArtifact({ projectId: first.id, artifactId: "approved-brief", content: { title: "Local approved" } });
    workflow.approve(first.id, "approved-brief", localApprovedBrief.id);
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
      const direction = normalizeCreativeDirection({
        ...valid, fieldProvenance: [{ fieldPath: "/tone", reference: reference as never }],
      });
      expect(() => artifacts.saveArtifact({
        projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction",
        content: direction,
      })).toThrow(/another project|missing|exact approved version/);
    }
    const unapproved = normalizeCreativeDirection({
      ...valid,
      fieldProvenance: [{
        fieldPath: "/tone", reference: { kind: "approved-artifact", targetId: "brief", versionId: localUnapprovedBrief.id },
      }],
    });
    expect(() => artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction", content: unapproved,
    })).toThrow(/exact approved version/);
    const approved = normalizeCreativeDirection({
      ...valid,
      fieldProvenance: [{
        fieldPath: "/tone", reference: {
          kind: "approved-artifact", targetId: "approved-brief", versionId: localApprovedBrief.id,
        },
      }],
    });
    expect(artifacts.saveArtifact({
      projectId: first.id, artifactId: "creative-direction", artifactType: "creative-direction", content: approved,
    }).content).toEqual(approved);
    expect(artifacts.listVersions(first.id, "creative-direction")).toHaveLength(2);
    database.close();
  });

  it("fails safely when corrupted Creative Direction is reopened", () => {
    const database = openDatabase();
    const project = new ProjectRepository(database).create("Corrupt direction", undefined, "long-form");
    const artifacts = new ArtifactRepository(database);
    const saved = artifacts.saveArtifact({
      projectId: project.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: defaultCreativeDirection(),
    });
    const corrupted = { ...saved.content as ReturnType<typeof defaultCreativeDirection>, materialFingerprint: "0".repeat(64) };
    database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(corrupted), saved.id);
    expect(() => artifacts.getVersion(saved.id)).toThrow(/Material fingerprint/);
    expect(() => artifacts.getCurrent(project.id, "creative-direction")).toThrow(/Material fingerprint/);
    const stored = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?").get(saved.id) as { content_json: string };
    expect(JSON.parse(stored.content_json).materialFingerprint).toBe("0".repeat(64));
    database.close();
  });

  it("keeps exact approved-artifact provenance valid after approval advances", () => {
    const database = openDatabase();
    const project = new ProjectRepository(database).create("Durable approvals", undefined, "long-form");
    const artifacts = new ArtifactRepository(database); const workflow = new WorkflowRepository(database);
    const first = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "First" } });
    workflow.approve(project.id, "brief", first.id);
    const direction = normalizeCreativeDirection({
      ...defaultCreativeDirection(),
      fieldProvenance: [{ fieldPath: "/tone", reference: {
        kind: "approved-artifact", targetId: "brief", versionId: first.id,
      } }],
    });
    const saved = artifacts.saveArtifact({
      projectId: project.id, artifactId: "creative-direction", artifactType: "creative-direction", content: direction,
    });
    const second = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "Second" } });
    workflow.approve(project.id, "brief", second.id);

    expect(artifacts.getVersion(saved.id)?.content).toEqual(direction);
    expect(database.prepare(`SELECT version_id FROM artifact_version_approvals
      WHERE project_id = ? AND artifact_id = 'brief' ORDER BY approved_at, version_id`).all(project.id))
      .toEqual(expect.arrayContaining([{ version_id: first.id }, { version_id: second.id }]));
    expect(() => database.prepare(`UPDATE artifact_version_approvals SET approved_at = 'tampered'
      WHERE project_id = ? AND artifact_id = 'brief' AND version_id = ?`).run(project.id, first.id))
      .toThrow(/immutable/i);
    expect(() => database.prepare(`DELETE FROM artifact_version_approvals
      WHERE project_id = ? AND artifact_id = 'brief' AND version_id = ?`).run(project.id, first.id))
      .toThrow(/immutable/i);
    expect(database.prepare(`SELECT approved_at FROM artifact_version_approvals
      WHERE project_id = ? AND artifact_id = 'brief' AND version_id = ?`).get(project.id, first.id)).toBeTruthy();
    new ProjectRepository(database).remove(project.id);
    expect(database.prepare("SELECT 1 FROM artifact_version_approvals WHERE project_id = ?").get(project.id)).toBeUndefined();
    database.close();
  });

  it("duplicates historical artifact, message, proposal, and manual-edit provenance without unavailable shortcuts", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database); const artifacts = new ArtifactRepository(database);
    const workflow = new WorkflowRepository(database); const conversations = new ConversationRepository(database);
    const changes = new ChangeSetRepository(database);
    const project = projects.create("Full fidelity", undefined, "long-form");
    const briefV1 = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "First" } });
    workflow.approve(project.id, "brief", briefV1.id);
    const briefV2 = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "Second" } });
    workflow.approve(project.id, "brief", briefV2.id);
    const conversation = conversations.create(project.id, { kind: "project", projectId: project.id, stage: "brief" });
    const message = conversations.addMessage({
      conversationId: conversation.id, role: "user", content: "Keep the quiet tone", intent: "propose",
      scope: conversation.scope, context: { briefVersionId: briefV2.id }, metadata: {},
    });
    const proposal = changes.create({
      projectId: project.id, conversationId: conversation.id, artifactId: "brief", baseVersionId: briefV2.id,
      summary: "Keep tone", rationale: "Author requested it", candidate: { title: "Third" },
    });
    const firstDirection = artifacts.saveArtifact({
      projectId: project.id, artifactId: "creative-direction", artifactType: "creative-direction",
      content: defaultCreativeDirection(),
    });
    const direction = normalizeCreativeDirection({
      ...defaultCreativeDirection(),
      fieldProvenance: [
        { fieldPath: "/tone", reference: { kind: "approved-artifact", targetId: "brief", versionId: briefV1.id } },
        { fieldPath: "/pacing", reference: { kind: "user-message", targetId: message.id } },
        { fieldPath: "/prose", reference: { kind: "proposal", targetId: proposal.id } },
        { fieldPath: "/prose/customGuidance", reference: { kind: "manual-edit", versionId: firstDirection.id } },
      ],
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "creative-direction", artifactType: "creative-direction", content: direction,
    });

    const copy = projects.duplicate(project.id);
    const copiedBriefs = artifacts.listVersions(copy.id, "brief");
    expect(copiedBriefs).toHaveLength(2);
    const copiedDirection = artifacts.getCurrent<ReturnType<typeof defaultCreativeDirection>>(copy.id, "creative-direction")!;
    const references = copiedDirection.content.fieldProvenance.map((item) => item.reference);
    expect(references.every((reference) => reference.unavailable !== true)).toBe(true);
    expect(JSON.stringify(references)).not.toContain(project.id);
    expect(JSON.stringify(references)).not.toContain(briefV1.id);
    expect(JSON.stringify(references)).not.toContain(message.id);
    expect(JSON.stringify(references)).not.toContain(proposal.id);
    const copiedApproved = references.find((reference) => reference.kind === "approved-artifact")!;
    expect(copiedBriefs.some((version) => version.id === copiedApproved.versionId && version.version === 1)).toBe(true);
    const copiedMessage = references.find((reference) => reference.kind === "user-message")!;
    expect(database.prepare(`SELECT 1 FROM messages message JOIN conversations conversation
      ON conversation.id = message.conversation_id WHERE message.id = ? AND conversation.project_id = ?`)
      .get(copiedMessage.targetId, copy.id)).toBeTruthy();
    const copiedProposal = references.find((reference) => reference.kind === "proposal")!;
    expect(database.prepare("SELECT 1 FROM change_sets WHERE id = ? AND project_id = ?")
      .get(copiedProposal.targetId, copy.id)).toBeTruthy();
    database.close();
  });

  it("rejects unavailable provenance trust bypasses and rolls a failed duplicate back", () => {
    const database = openDatabase(); const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database); const workflow = new WorkflowRepository(database);
    const local = projects.create("Local", undefined, "long-form"); const foreign = projects.create("Foreign", undefined, "long-form");
    const foreignBrief = artifacts.saveArtifact({ projectId: foreign.id, artifactId: "brief", content: { title: "Foreign" } });
    workflow.approve(foreign.id, "brief", foreignBrief.id);
    const foreignUnavailable = normalizeCreativeDirection({
      ...defaultCreativeDirection(), fieldProvenance: [{ fieldPath: "/tone", reference: {
        kind: "approved-artifact", targetId: "brief", versionId: foreignBrief.id, unavailable: true,
      } }],
    });
    expect(() => artifacts.saveArtifact({
      projectId: local.id, artifactId: "creative-direction", artifactType: "creative-direction", content: foreignUnavailable,
    })).toThrow(/durable history/);
    const malformedUnavailable = normalizeCreativeDirection({
      ...defaultCreativeDirection(), fieldProvenance: [{ fieldPath: "/tone", reference: {
        kind: "manual-edit", unavailable: true,
      } }],
    });
    expect(() => artifacts.saveArtifact({
      projectId: local.id, artifactId: "creative-direction", artifactType: "creative-direction", content: malformedUnavailable,
    })).toThrow(/missing version/);

    database.prepare(`INSERT INTO artifact_versions
      (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
      VALUES ('corrupt-direction', ?, 'creative-direction', 'creative-direction', 1, 1, ?, 0, ?)`)
      .run(local.id, JSON.stringify(foreignUnavailable), "2026-09-19T00:00:00.000Z");
    const before = (database.prepare("SELECT COUNT(*) count FROM projects").get() as { count: number }).count;
    expect(() => projects.duplicate(local.id)).toThrow(/durable history/);
    expect((database.prepare("SELECT COUNT(*) count FROM projects").get() as { count: number }).count).toBe(before);
    database.close();
  });
});
