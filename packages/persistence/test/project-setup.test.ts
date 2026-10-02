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
  AuthorMemoryRepository,
  ConversationRepository,
  CURRENT_SCHEMA_VERSION,
  migrate,
  openDatabase,
  PortableProjectRepository,
  ProjectRepository,
  SetupProposalRepository,
  transaction,
  type SetupProposalSource,
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
  const author = conversations.addMessage({ conversationId: setup.id, role: "user", content: "A warm detective story in a flooded city.",
    intent: "discuss", scope: { kind: "project", projectId: project.id }, context: { briefVersionId: brief.id }, metadata: {} });
  const source: SetupProposalSource = {
    authority: "non-canonical-setup-proposal", schemaVersion: 1,
    messageRange: { firstMessageId: author.id, lastMessageId: author.id, messageCount: 1, authorMessageIds: [author.id], messageIds: [author.id] },
    summaryVersionId: null, decisionVersionIds: [], promptVersion: "a2-setup-v1",
    provider: { model: "offline", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: null, repaired: false, attemptCount: 1, attempts: [] },
    omissions: [], generatesProse: false,
  };
  const create = () => proposals.create({
    projectId: project.id, conversationId: setup.id, summary: "Draft foundation",
    source, contextFingerprint: fingerprint,
    bases: [{ artifactId: "brief", precondition: "exact-base", versionId: brief.id }],
    groups: [{ id: "brief", artifactId: "brief", label: "Brief", summary: "Shape", dependsOnGroupIds: [], candidate: {}, changes: [] }],
  });
  return { database, project, artifacts, brief, conversations, setup, proposals, create, source, author };
}

describe("A2 project-setup persistence", () => {
  it("keeps proposals append-only in every review state while allowing project cascade deletion", () => {
    const { database, project, artifacts, create, proposals } = setupProject();
    const superseded = create();
    const rejected = create(); proposals.reject(rejected.id);
    const applied = create();
    const version = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { workingTitle: "Reviewed" } });
    proposals.markAppliedInTransaction(applied.id, { appliedGroupIds: ["brief"], createdVersions: [{ groupId: "brief", artifactId: "brief", versionId: version.id }], appliedAt: new Date().toISOString() });
    const pending = create();
    for (const proposal of [superseded, rejected, applied, pending]) {
      expect(() => database.prepare("DELETE FROM setup_proposals WHERE id = ?").run(proposal.id)).toThrow("append-only");
      expect(proposals.get(proposal.id)).toBeDefined();
    }
    new ProjectRepository(database).remove(project.id);
    expect(database.prepare("SELECT COUNT(*) count FROM setup_proposals").get()).toEqual({ count: 0 });
    database.close();
  });

  it("retains foreign-key enforcement and rolls back an incomplete project cascade", () => {
    const { database, project, create, proposals } = setupProject(); const proposal = create();
    database.exec("CREATE TABLE external_reference (project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT)");
    database.prepare("INSERT INTO external_reference (project_id) VALUES (?)").run(project.id);
    expect(() => new ProjectRepository(database).remove(project.id)).toThrow("FOREIGN KEY");
    expect(new ProjectRepository(database).get(project.id)).toBeDefined(); expect(proposals.get(proposal.id)).toBeDefined();
    expect(database.prepare("PRAGMA defer_foreign_keys").get()).toEqual({ defer_foreign_keys: 0 });
    database.exec("DELETE FROM external_reference");
    expect(() => transaction(database, () => new ProjectRepository(database).remove(project.id))).not.toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  });

  it("repairs the shipped v19 missing delete trigger on reopen without changing proposal history", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v19-repair-")); directories.push(directory);
    const path = join(directory, "studio.sqlite");
    const { database: sourceDatabase, project, create } = setupProject(); create();
    sourceDatabase.prepare("VACUUM INTO ?").run(path); sourceDatabase.close();
    const shipped = new DatabaseSync(path); shipped.exec("DROP TRIGGER setup_proposals_immutable_delete");
    const before = shipped.prepare("SELECT * FROM setup_proposals").all(); shipped.close();
    const repaired = openDatabase(path);
    expect(repaired.prepare("SELECT * FROM setup_proposals").all()).toEqual(before);
    expect(() => repaired.prepare("DELETE FROM setup_proposals").run()).toThrow("append-only");
    expect(CURRENT_SCHEMA_VERSION).toBe(20);
    new ProjectRepository(repaired).remove(project.id); repaired.close();
  });

  it("rolls back v19 integrity repair on corrupt source lineage and rejects corruption on later reopen", () => {
    const { database, create } = setupProject(); const proposal = create();
    database.exec("DROP TRIGGER setup_proposals_immutable_delete; DROP TRIGGER setup_proposals_immutable_update");
    database.prepare("UPDATE setup_proposals SET source_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...proposal.source, summaryVersionId: "missing-summary" }), proposal.id);
    expect(() => migrate(database)).toThrow("summary lineage");
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'setup_proposals_immutable_delete'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'setup_proposals_immutable_update'").get()).toBeUndefined();
    expect(database.prepare("SELECT MAX(version) version FROM schema_migrations").get()).toEqual({ version: CURRENT_SCHEMA_VERSION });
    database.prepare("UPDATE setup_proposals SET source_json = ? WHERE id = ?").run(JSON.stringify(proposal.source), proposal.id);
    migrate(database);
    database.exec("DROP TRIGGER setup_proposals_immutable_update");
    database.prepare("UPDATE setup_proposals SET source_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...proposal.source, decisionVersionIds: ["missing-decision"] }), proposal.id);
    expect(() => migrate(database)).toThrow("decision lineage");
    database.close();
  });

  it("validates exact range/count, summary, decision and revision lineage before superseding pending work", () => {
    const { database, project, conversations, setup, proposals, create } = setupProject();
    const proposal = create();
    const other = new ProjectRepository(database).create("Other", undefined, "long-form");
    const otherChat = conversations.create(other.id, { kind: "project", projectId: other.id }, "Other", "setup");
    const foreignMessage = conversations.addMessage({ conversationId: otherChat.id, role: "user", content: "Foreign author", intent: "discuss", scope: { kind: "project", projectId: other.id }, context: {}, metadata: {} });
    const memory = new AuthorMemoryRepository(database);
    for (let index = 0; index < 10; index++) conversations.addMessage({ conversationId: otherChat.id, role: "user", content: `Detail ${index}`, intent: "discuss", scope: { kind: "project", projectId: other.id }, context: {}, metadata: {} });
    const foreignSummary = memory.ensureSummary(other.id, otherChat.id)!;
    const foreignDecision = memory.createDecision({ projectId: other.id, scope: { kind: "project" }, content: "Foreign decision" });
    const siblingChat = conversations.create(project.id, { kind: "project", projectId: project.id }, "Sibling", "setup");
    for (let index = 0; index < 10; index++) conversations.addMessage({ conversationId: siblingChat.id, role: "user", content: `Detail ${index}`, intent: "discuss", scope: { kind: "project", projectId: project.id }, context: { briefVersionId: proposal.bases[0]!.versionId! }, metadata: {} });
    const siblingSummary = memory.ensureSummary(project.id, siblingChat.id)!;
    const invalidSources = [
      { ...proposal.source, messageRange: { ...proposal.source.messageRange, firstMessageId: foreignMessage.id } },
      { ...proposal.source, messageRange: { ...proposal.source.messageRange, lastMessageId: "missing-message" } },
      { ...proposal.source, messageRange: { ...proposal.source.messageRange, messageCount: 2 } },
      { ...proposal.source, messageRange: { ...proposal.source.messageRange, messageIds: [foreignMessage.id] } },
      { ...proposal.source, summaryVersionId: foreignSummary.id },
      { ...proposal.source, summaryVersionId: siblingSummary.id },
      { ...proposal.source, decisionVersionIds: [foreignDecision.id] },
      { ...proposal.source, decisionVersionIds: ["missing-decision"] },
      { ...proposal.source, revisedFromProposalId: "missing-proposal", reviewedEditMessageId: foreignMessage.id },
    ];
    for (const source of invalidSources) {
      expect(() => proposals.create({ ...proposal, id: undefined, source })).toThrow();
      expect(proposals.get(proposal.id)?.status).toBe("proposed");
      expect(proposals.count(setup.id)).toBe(1);
    }
    const second = conversations.addMessage({ conversationId: setup.id, role: "assistant", content: "Understanding", intent: "discuss", scope: { kind: "project", projectId: project.id }, context: {}, metadata: {} });
    expect(() => proposals.create({ ...proposal, id: undefined, source: { ...proposal.source, messageRange: { ...proposal.source.messageRange, firstMessageId: second.id } } })).toThrow("range");
    expect(() => proposals.create({ ...proposal, id: undefined, source: { ...proposal.source, messageRange: { ...proposal.source.messageRange, messageIds: undefined, lastMessageId: second.id } } })).toThrow("range");
    database.close();
  });

  it("preserves exact source IDs for a bounded non-contiguous context and supports earlier contiguous v19 ranges", () => {
    const { database, project, conversations, setup, create, proposals } = setupProject(); const proposal = create();
    conversations.addMessage({ conversationId: setup.id, role: "assistant", content: "x".repeat(9000), intent: "discuss", scope: { kind: "project", projectId: project.id }, context: {}, metadata: {} });
    const last = conversations.addMessage({ conversationId: setup.id, role: "user", content: "Clarification", intent: "discuss", scope: { kind: "project", projectId: project.id }, context: {}, metadata: {} });
    const original = proposal.source.messageRange;
    const source = { ...proposal.source, messageRange: { ...original, lastMessageId: last.id, messageCount: 2, authorMessageIds: [...original.authorMessageIds, last.id], messageIds: [original.firstMessageId, last.id] } };
    expect(proposals.create({ ...proposal, id: undefined, source }).source).toEqual(source);
    expect(proposals.create({ ...proposal, id: undefined, source: { ...source, messageRange: { ...source.messageRange, messageIds: undefined } } }).source.messageRange.messageCount).toBe(2);
    expect(proposals.create({ ...proposal, id: undefined, source: { ...proposal.source, messageRange: { ...original, messageIds: undefined } } }).source.messageRange.messageCount).toBe(1);
    database.close();
  });

  it("duplicates exact 8C summary and pinned-decision histories without relying on the source project", () => {
    const { database, project, brief, conversations, setup, proposals, create } = setupProject();
    const memory = new AuthorMemoryRepository(database);
    for (let index = 0; index < 12; index++) conversations.addMessage({ conversationId: setup.id, role: "user", content: `Detail ${index}`, intent: "discuss", scope: { kind: "project", projectId: project.id }, context: { briefVersionId: brief.id }, metadata: {} });
    const firstSummary = memory.ensureSummary(project.id, setup.id)!;
    conversations.addMessage({ conversationId: setup.id, role: "user", content: "One more detail", intent: "discuss", scope: { kind: "project", projectId: project.id }, context: { briefVersionId: brief.id }, metadata: {} });
    const latestSummary = memory.ensureSummary(project.id, setup.id)!;
    expect(latestSummary.version).toBe(2);
    const firstDecision = memory.createDecision({ projectId: project.id, scope: { kind: "project" }, content: "Past tense", provenance: { messageId: firstSummary.sourceRange.firstMessageId } });
    memory.reviseDecision(project.id, firstDecision.stableId, { content: "Present tense" });
    const currentDecision = memory.reviseDecision(project.id, firstDecision.stableId, { status: "withdrawn" });
    const initial = create();
    const proposal = proposals.create({ ...initial, id: undefined, source: { ...initial.source, summaryVersionId: firstSummary.id, decisionVersionIds: [firstDecision.id] } });
    const copy = new ProjectRepository(database).duplicate(project.id);
    const copiedChat = conversations.list(copy.id, "setup")[0]!;
    const copiedProposal = proposals.listRecent(copiedChat.id).find((item) => item.status === "proposed")!;
    const copiedSummaries = memory.listSummaries(copy.id, copiedChat.id);
    const copiedDecisions = memory.listDecisions(copy.id, true);
    expect(copiedSummaries).toHaveLength(2); expect(copiedDecisions).toHaveLength(3);
    expect(copiedProposal.source.summaryVersionId).not.toBe(firstSummary.id);
    expect(copiedProposal.source.decisionVersionIds).not.toContain(firstDecision.id);
    expect(copiedSummaries.find((item) => item.id === copiedProposal.source.summaryVersionId)).toMatchObject({ projectId: copy.id, conversationId: copiedChat.id, version: 1, status: "superseded" });
    expect(copiedDecisions.find((item) => item.id === copiedProposal.source.decisionVersionIds[0])).toMatchObject({ projectId: copy.id, version: 1, content: "Past tense" });
    expect(copiedDecisions.find((item) => item.version === 3)).toMatchObject({ status: "withdrawn", content: currentDecision.content });
    expect(copiedSummaries[0]!.canonicalDependencies.briefVersionId).toBe(copiedProposal.bases[0]!.versionId);
    const referencedMessage = copiedDecisions.find((item) => item.version === 1)!.provenance.messageId!;
    expect(conversations.getMessage(referencedMessage)?.conversationId).toBe(copiedChat.id);
    const beforeDelete = proposals.get(copiedProposal.id);
    new ProjectRepository(database).remove(project.id);
    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(database.prepare("PRAGMA defer_foreign_keys").get()).toEqual({ defer_foreign_keys: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    migrate(database);
    expect(proposals.get(copiedProposal.id)).toEqual(beforeDelete);
    expect(memory.currentSummary(copy.id, copiedChat.id)?.id).toBe(copiedSummaries[0]!.id);
    expect(memory.listDecisions(copy.id, true)).toEqual(copiedDecisions);
    new ProjectRepository(database).remove(copy.id); database.close();
  });

  it("rejects cross-project bases, author evidence, malformed dependency graphs and audit versions", () => {
    const { database, project, artifacts, conversations, setup, create, proposals } = setupProject();
    const proposal = create();
    const other = new ProjectRepository(database).create("Other", undefined, "long-form");
    const foreign = artifacts.saveArtifact({ projectId: other.id, artifactId: "brief", content: {} });
    expect(() => proposals.create({ ...proposal, id: undefined, bases: [{ artifactId: "brief", precondition: "exact-base", versionId: foreign.id }] })).toThrow("ownership");
    const otherChat = conversations.create(other.id, { kind: "project", projectId: other.id }, "Setup", "setup");
    const foreignMessage = conversations.addMessage({ conversationId: otherChat.id, role: "user", content: "Other author", intent: "discuss", scope: { kind: "project", projectId: other.id }, context: {}, metadata: {} });
    expect(() => proposals.create({ ...proposal, id: undefined, source: { ...proposal.source, messageRange: { ...proposal.source.messageRange, authorMessageIds: [foreignMessage.id] } } })).toThrow("evidence ownership");
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
    expect(CURRENT_SCHEMA_VERSION).toBe(20);
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
      projectId: project.id, conversationId: planning.id, summary: "Wrong", source: second.source, contextFingerprint: fingerprint,
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
