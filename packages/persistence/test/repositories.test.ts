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
});
