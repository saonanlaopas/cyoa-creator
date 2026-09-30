import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCreativeDirection, normalizeCreativeDirection } from "@story-to-cyoa/domain";
import {
  ArtifactRepository,
  ConversationRepository,
  CURRENT_SCHEMA_VERSION,
  migrate,
  openDatabase,
  PortableProjectRepository,
  ProjectRepository,
  SetupProposalRepository,
} from "../src/index.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "schema-v18.sqlite");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fingerprint = "a".repeat(64);

function setupProject() {
  const database = openDatabase(":memory:");
  const project = new ProjectRepository(database).create("Setup", undefined, "long-form");
  const artifacts = new ArtifactRepository(database);
  const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { workingTitle: "Setup" } });
  const conversations = new ConversationRepository(database);
  const setup = conversations.create(project.id, { kind: "project", projectId: project.id }, "Project setup", "setup");
  const proposals = new SetupProposalRepository(database);
  const create = () => proposals.create({
    projectId: project.id, conversationId: setup.id, summary: "Draft foundation",
    source: { messageRange: [] }, contextFingerprint: fingerprint,
    bases: [{ artifactId: "brief", precondition: "exact-base", versionId: brief.id }],
    groups: [{ id: "brief", artifactId: "brief", label: "Brief", summary: "Shape", dependsOnGroupIds: [], candidate: {}, changes: [] }],
  });
  return { database, project, artifacts, brief, conversations, setup, proposals, create };
}

describe("A2 project-setup persistence", () => {
  it("rejects cross-project bases, author evidence, malformed dependency graphs and audit versions", () => {
    const { database, project, artifacts, conversations, setup, create, proposals } = setupProject();
    const proposal = create();
    const other = new ProjectRepository(database).create("Other", undefined, "long-form");
    const foreign = artifacts.saveArtifact({ projectId: other.id, artifactId: "brief", content: {} });
    expect(() => proposals.create({ ...proposal, id: undefined, bases: [{ artifactId: "brief", precondition: "exact-base", versionId: foreign.id }] })).toThrow("ownership");
    const otherChat = conversations.create(other.id, { kind: "project", projectId: other.id }, "Setup", "setup");
    const foreignMessage = conversations.addMessage({ conversationId: otherChat.id, role: "user", content: "Other author", intent: "discuss", scope: { kind: "project", projectId: other.id }, context: {}, metadata: {} });
    expect(() => proposals.create({ ...proposal, id: undefined, source: { messageRange: { authorMessageIds: [foreignMessage.id] } } })).toThrow("evidence ownership");
    expect(() => proposals.create({ ...proposal, id: undefined, groups: [{ ...proposal.groups[0]!, dependsOnGroupIds: ["missing"] }] })).toThrow("dependency");
    expect(() => proposals.markAppliedInTransaction(proposal.id, { appliedGroupIds: ["brief"], createdVersions: [{ groupId: "brief", artifactId: "brief", versionId: foreign.id }], appliedAt: new Date().toISOString() })).toThrow("ownership");
    expect(proposals.get(proposal.id)?.status).toBe("proposed"); database.close();
  });

  it("cascades setup conversations, messages and proposals when their project is deleted", () => {
    const { database, project, create } = setupProject(); create();
    database.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
    expect(database.prepare("SELECT COUNT(*) AS count FROM setup_proposals").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM conversations").get()).toEqual({ count: 0 }); database.close();
  });

  it("migrates the frozen schema-v18 fixture additively without changing accepted bytes", () => {
    const originalHash = digest(fixture);
    expect(originalHash).toBe("0185eee05e45eabe6a1c20a1111adffac20c688e15cfbb9609c7b026e167e9d0");
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v19-migration-")); directories.push(directory);
    const copy = join(directory, "schema-v18.sqlite"); copyFileSync(fixture, copy);
    const legacy = new DatabaseSync(copy);
    const now = "2026-09-28T00:00:00.000Z";
    legacy.prepare("INSERT INTO projects (id, name, mode, created_at, updated_at) VALUES ('legacy-p', 'Legacy', 'long-form', ?, ?)").run(now, now);
    legacy.prepare(`INSERT INTO conversations (id, project_id, title, scope_json, summary, created_at, updated_at)
      VALUES ('legacy-c', 'legacy-p', 'Brief chat', '{}', '', ?, ?)`).run(now, now);
    legacy.close();

    const database = openDatabase(copy);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(19);
    expect(new ConversationRepository(database).get("legacy-c")).toMatchObject({ purpose: "planning", title: "Brief chat" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'setup_proposals'").get()).toEqual({ name: "setup_proposals" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'setup_proposals_immutable_update'").get())
      .toEqual({ name: "setup_proposals_immutable_update" });
    database.close();
    expect(digest(fixture)).toBe(originalHash);
  });

  it("rolls a conflicting v19 migration back without a partial purpose column or proposal table", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v19-rollback-")); directories.push(directory);
    const copy = join(directory, "conflict.sqlite"); copyFileSync(fixture, copy);
    const database = new DatabaseSync(copy);
    database.exec("CREATE TABLE setup_proposals (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(18);
    expect((database.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>).map((column) => column.name))
      .not.toContain("purpose");
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'setup_proposals_immutable_update'").get()).toBeUndefined();
    database.close();
  });

  it("keeps planning and setup conversations separate", () => {
    const { conversations, project, setup } = setupProject();
    const planning = conversations.create(project.id, { kind: "project", projectId: project.id });
    expect(conversations.list(project.id).map((item) => item.id)).toEqual([planning.id]);
    expect(conversations.list(project.id, "setup").map((item) => item.id)).toEqual([setup.id]);
    expect(() => conversations.create(project.id, { kind: "artifact", projectId: project.id, artifactId: "brief" }, "x", "setup"))
      .toThrow("project scope");
    expect(() => conversations.updateScope(setup.id, { kind: "artifact", projectId: project.id, artifactId: "brief" }))
      .toThrow("project scope");
  });

  it("supersedes earlier pending proposals and freezes reviewed proposals", () => {
    const { database, create, proposals, project, conversations } = setupProject();
    const first = create();
    const second = create();
    expect(proposals.get(first.id)?.status).toBe("superseded");
    expect(proposals.get(second.id)?.status).toBe("proposed");
    expect(() => database.prepare("UPDATE setup_proposals SET groups_json = '[]' WHERE id = ?").run(second.id))
      .toThrow("immutable");
    proposals.reject(second.id);
    expect(() => proposals.reject(second.id)).toThrow("Only pending");
    expect(() => database.prepare("UPDATE setup_proposals SET status = 'proposed' WHERE id = ?").run(second.id))
      .toThrow("immutable");
    const planning = conversations.create(project.id, { kind: "project", projectId: project.id });
    expect(() => proposals.create({
      projectId: project.id, conversationId: planning.id, summary: "Wrong", source: {}, contextFingerprint: fingerprint,
      bases: [], groups: [{ id: "g", artifactId: "brief", label: "g", summary: "g", dependsOnGroupIds: [], candidate: {}, changes: [] }],
    })).toThrow("lineage");
    expect(() => database.prepare(`UPDATE setup_proposals SET status = 'applied' WHERE id = ?`).run(first.id)).toThrow();
  });

  it("duplicates setup conversations, proposals, and remapped CD evidence", () => {
    const { database, project, artifacts, conversations, setup, create, proposals, brief } = setupProject();
    const message = conversations.addMessage({ conversationId: setup.id, role: "user", content: "Warm slow-burn", intent: "discuss",
      scope: { kind: "project", projectId: project.id }, context: {}, metadata: {} });
    const proposal = create();
    const direction = normalizeCreativeDirection({ ...defaultCreativeDirection(), fieldProvenance: [
      { fieldPath: "/tone", reference: { kind: "user-message", targetId: message.id, excerpt: "Warm slow-burn" } },
      { fieldPath: "/pacing", reference: { kind: "proposal", targetId: proposal.id, excerpt: "Inferred" } },
    ] });
    artifacts.saveArtifact({ projectId: project.id, artifactId: "creative-direction", content: direction });
    const copy = new ProjectRepository(database).duplicate(project.id);
    const copiedSetup = conversations.list(copy.id, "setup")[0]!;
    expect(copiedSetup.purpose).toBe("setup");
    const copiedProposal = proposals.listRecent(copiedSetup.id)[0]!;
    expect(copiedProposal.id).not.toBe(proposal.id);
    expect(copiedProposal.bases[0]!.versionId).not.toBe(brief.id);
    const copiedDirection = artifacts.getCurrent<typeof direction>(copy.id, "creative-direction")!.content;
    const targets = copiedDirection.fieldProvenance.map((record) => record.reference.targetId);
    expect(targets).toContain(copiedProposal.id);
    expect(targets).not.toContain(message.id);
  });

  it("marks conversation evidence unavailable in portable rows without changing material meaning", () => {
    const { database, project, artifacts, conversations, setup } = setupProject();
    const message = conversations.addMessage({ conversationId: setup.id, role: "user", content: "Mystery, no romance", intent: "discuss",
      scope: { kind: "project", projectId: project.id }, context: {}, metadata: {} });
    const direction = normalizeCreativeDirection({ ...defaultCreativeDirection(), tone: { descriptors: ["tense"] }, fieldProvenance: [
      { fieldPath: "/tone/descriptors", reference: { kind: "user-message", targetId: message.id, excerpt: "Mystery, no romance" } },
    ] });
    artifacts.saveArtifact({ projectId: project.id, artifactId: "creative-direction", content: direction });
    const rows = new PortableProjectRepository(database).exportRows(project.id);
    const exported = JSON.parse(String(rows.tables.artifact_versions.find((row) => row.artifact_id === "creative-direction")!.content_json));
    expect(exported.materialFingerprint).toBe(direction.materialFingerprint);
    expect(exported.provenanceFingerprint).not.toBe(direction.provenanceFingerprint);
    expect(exported.fieldProvenance[0].reference).toMatchObject({ kind: "user-message", unavailable: true, excerpt: "Mystery, no romance" });

    const target = openDatabase(":memory:");
    new PortableProjectRepository(target).importRows(rows, () => undefined);
    expect(new ArtifactRepository(target).getCurrent(project.id, "creative-direction")).toBeDefined();
    expect(new PortableProjectRepository(target).exportRows(project.id).tables.artifact_versions)
      .toEqual(rows.tables.artifact_versions);
  });
});
