import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AUTHOR_MEMORY_BUDGETS,
  ArtifactRepository,
  AuthorMemoryRepository,
  ConversationRepository,
  openDatabase,
  ProjectRepository,
} from "../src/index.js";

const ArtifactSchema = z.object({ title: z.string() });

function setup() {
  const database = openDatabase();
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const conversations = new ConversationRepository(database);
  const memory = new AuthorMemoryRepository(database);
  const project = projects.create("Long session", undefined, "long-form");
  const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "First" }, schema: ArtifactSchema });
  const scope = { kind: "artifact" as const, projectId: project.id, stage: "brief" as const,
    artifactId: "brief" as const, versionId: brief.id, sectionId: "root" };
  const conversation = conversations.create(project.id, scope);
  return { database, artifacts, conversations, memory, project, brief, scope, conversation };
}

describe("Foundation 8C durable author memory", () => {
  it("creates bounded immutable summary versions with exact source lineage and deterministic staleness", () => {
    const state = setup();
    for (let index = 0; index < 14; index += 1) {
      state.conversations.addMessage({ conversationId: state.conversation.id,
        role: index % 2 ? "assistant" : "user", content: `Message ${index} about route intent`, intent: "discuss",
        scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {} });
    }
    const first = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(first).toMatchObject({ version: 1, method: "deterministic-extractive", methodVersion: 1,
      creationState: "created", status: "current", sourceRange: { messageCount: 6 } });
    expect(Buffer.byteLength(first.content, "utf8")).toBeLessThanOrEqual(AUTHOR_MEMORY_BUDGETS.summaryBytes);
    expect(state.memory.ensureSummary(state.project.id, state.conversation.id)?.id).toBe(first.id);

    for (let index = 14; index < 20; index += 1) {
      state.conversations.addMessage({ conversationId: state.conversation.id, role: "user", content: `Message ${index}`,
        intent: "discuss", scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {} });
    }
    const second = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(second).toMatchObject({ version: 2, supersedesVersionId: first.id, status: "current",
      sourceRange: { firstMessageId: first.sourceRange.firstMessageId, messageCount: 12 } });
    expect(state.memory.listSummaries(state.project.id, state.conversation.id).map((item) => item.status))
      .toEqual(["current", "superseded"]);
    expect(() => state.database.prepare("UPDATE conversation_summary_versions SET content = 'changed' WHERE id = ?").run(second.id))
      .toThrow("immutable");
    expect(() => state.database.prepare("UPDATE messages SET content = 'changed' WHERE id = ?").run(second.sourceRange.lastMessageId))
      .toThrow("source messages are immutable");
    expect(() => state.database.prepare("DELETE FROM messages WHERE id = ?").run(second.sourceRange.lastMessageId))
      .toThrow("append-only");

    state.conversations.updateScope(state.conversation.id, { ...state.scope, sectionId: "changed-section" });
    expect(state.memory.currentSummary(state.project.id, state.conversation.id)).toMatchObject({
      status: "stale", staleReasons: ["conversation-scope-changed"],
    });
    state.conversations.updateScope(state.conversation.id, state.scope);

    const artifactBefore = state.artifacts.getCurrent(state.project.id, "brief")!.id;
    state.artifacts.saveArtifact({ projectId: state.project.id, artifactId: "brief", content: { title: "Changed" }, schema: ArtifactSchema });
    const context = state.memory.buildContext(state.project.id, state.conversation.id, state.scope);
    expect(context.summary).toBeNull();
    expect(context.diagnostics).toMatchObject({ summaryStatus: "stale",
      staleSummaryReasons: ["canonical-dependency-changed:brief"] });
    expect(state.artifacts.getVersion(artifactBefore)?.content).toEqual({ title: "First" });
    state.database.close();
  });

  it("does not churn stale summaries and regenerates once from a current dependency-consistent range", () => {
    const state = setup();
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "user", content: `V1 discussion ${index}`, intent: "discuss",
      scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {},
    });
    const v1Summary = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    const briefV2 = state.artifacts.saveArtifact({ projectId: state.project.id, artifactId: "brief",
      content: { title: "Second" }, schema: ArtifactSchema });
    expect(state.memory.currentSummary(state.project.id, state.conversation.id)?.status).toBe("stale");
    for (let index = 0; index < 20; index += 1) {
      expect(state.memory.ensureSummary(state.project.id, state.conversation.id)?.id).toBe(v1Summary.id);
    }
    expect(state.memory.listSummaries(state.project.id, state.conversation.id)).toHaveLength(1);
    expect(state.memory.buildContext(state.project.id, state.conversation.id, state.scope).summary).toBeNull();

    const v2Scope = { ...state.scope, versionId: briefV2.id };
    state.conversations.updateScope(state.conversation.id, v2Scope);
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "assistant", content: `V2 discussion ${index}`, intent: "discuss",
      scope: v2Scope, context: { briefVersionId: briefV2.id }, metadata: {},
    });
    const v2Summary = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(v2Summary).toMatchObject({ version: 2, status: "current", supersedesVersionId: v1Summary.id,
      canonicalDependencies: { briefVersionId: briefV2.id }, sourceRange: { messageCount: 6 } });
    expect(v2Summary.content).toContain("V2 discussion 0");
    expect(v2Summary.content).not.toContain("V1 discussion");
    expect(state.memory.ensureSummary(state.project.id, state.conversation.id)?.id).toBe(v2Summary.id);
    expect(state.memory.listSummaries(state.project.id, state.conversation.id)).toHaveLength(2);
    expect(state.memory.listSummaries(state.project.id, state.conversation.id)[1]?.content).toBe(v1Summary.content);
    state.database.close();
  });

  it("regenerates idempotently after scope and multiple canonical dependency changes", () => {
    const state = setup();
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "user", content: `Original ${index}`, intent: "discuss",
      scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {},
    });
    const original = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    const briefV2 = state.artifacts.saveArtifact({ projectId: state.project.id, artifactId: "brief",
      content: { title: "Second" }, schema: ArtifactSchema });
    const bible = state.artifacts.saveArtifact({ projectId: state.project.id, artifactId: "bible",
      content: { title: "Bible" }, schema: ArtifactSchema });
    const nextScope = { ...state.scope, versionId: briefV2.id, sectionId: "changed" };
    state.conversations.updateScope(state.conversation.id, nextScope);
    for (let index = 0; index < 20; index += 1) expect(
      state.memory.ensureSummary(state.project.id, state.conversation.id)?.id,
    ).toBe(original.id);
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "user", content: `Current ${index}`, intent: "discuss",
      scope: nextScope, context: { briefVersionId: briefV2.id, bibleVersionId: bible.id }, metadata: {},
    });
    const regenerated = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(regenerated).toMatchObject({ version: 2, status: "current", scope: nextScope,
      canonicalDependencies: { bibleVersionId: bible.id, briefVersionId: briefV2.id } });
    expect(state.memory.ensureSummary(state.project.id, state.conversation.id)?.id).toBe(regenerated.id);
    state.database.close();
  });

  it("selects relevant decisions before applying strict context count and byte bounds", () => {
    const state = setup();
    const olderRelevant = state.memory.createDecision({ projectId: state.project.id, scope: { kind: "project" },
      content: "The older project-wide decision remains relevant." });
    for (let index = 0; index < 205; index += 1) state.memory.createDecision({
      projectId: state.project.id, scope: { kind: "artifact", artifactId: "routes" }, content: `Route-only ${index}`,
    });
    expect(state.memory.buildContext(state.project.id, state.conversation.id, state.scope).decisions)
      .toMatchObject([{ stableId: olderRelevant.stableId }]);
    for (let index = 0; index < AUTHOR_MEMORY_BUDGETS.contextDecisionCount + 4; index += 1) state.memory.createDecision({
      projectId: state.project.id, scope: { kind: "artifact", artifactId: "brief" }, content: `Brief decision ${index}`,
    });
    const context = state.memory.buildContext(state.project.id, state.conversation.id, state.scope);
    expect(context.decisions.length).toBeLessThanOrEqual(AUTHOR_MEMORY_BUDGETS.contextDecisionCount);
    expect(context.decisions.reduce((total, item) => total + Buffer.byteLength(item.content, "utf8")
      + Buffer.byteLength(JSON.stringify(item.relatedIds), "utf8"), 0)).toBeLessThanOrEqual(AUTHOR_MEMORY_BUDGETS.contextDecisionBytes);
    expect(context.diagnostics.omittedDecisionCount).toBe(5);
    expect(context.diagnostics.omittedDecisionBytes).toBeGreaterThan(0);
    state.database.close();
  });

  it("versions scoped pinned decisions and includes only bounded relevant active heads", () => {
    const state = setup();
    const projectDecision = state.memory.createDecision({ projectId: state.project.id, scope: { kind: "project" },
      content: "Forgiveness must remain possible.", relatedIds: ["ending-mercy"] });
    const artifactDecision = state.memory.createDecision({ projectId: state.project.id,
      scope: { kind: "artifact", artifactId: "brief" }, content: "Keep the opening quiet." });
    state.memory.createDecision({ projectId: state.project.id,
      scope: { kind: "artifact", artifactId: "routes" }, content: "This belongs elsewhere." });
    const revised = state.memory.reviseDecision(state.project.id, projectDecision.stableId,
      { content: "Forgiveness must remain possible but costly." });
    expect(revised).toMatchObject({ stableId: projectDecision.stableId, version: 2, status: "active",
      supersedesVersionId: projectDecision.id });
    expect(state.memory.listDecisions(state.project.id, true).filter((item) => item.stableId === projectDecision.stableId))
      .toHaveLength(2);
    expect(state.memory.listDecisions(state.project.id, true).find((item) => item.id === projectDecision.id)?.status)
      .toBe("superseded");
    state.memory.reviseDecision(state.project.id, artifactDecision.stableId, { status: "withdrawn" });
    const context = state.memory.buildContext(state.project.id, state.conversation.id, state.scope);
    expect(context.decisions.map((item) => item.content)).toEqual(["Forgiveness must remain possible but costly."]);
    expect(context.authority).toBe("non-canonical-author-memory");
    expect(() => state.memory.createDecision({ projectId: state.project.id, scope: { kind: "project" },
      content: "x".repeat(AUTHOR_MEMORY_BUDGETS.decisionContentBytes + 1) })).toThrow("byte limit");
    expect(() => state.database.prepare("UPDATE pinned_decision_versions SET content = 'changed' WHERE id = ?").run(revised.id))
      .toThrow("immutable");
    state.database.close();
  });

  it("regenerates a stale scope without carrying old-scope text and keeps recent messages scope-exact", () => {
    const state = setup();
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({ conversationId: state.conversation.id,
      role: "user", content: `Old scope ${index}`, intent: "discuss", scope: state.scope,
      context: { briefVersionId: state.brief.id }, metadata: {} });
    const first = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    const nextScope = { ...state.scope, sectionId: "new-section" };
    state.conversations.updateScope(state.conversation.id, nextScope);
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({ conversationId: state.conversation.id,
      role: "assistant", content: `New scope ${index}`, intent: "discuss", scope: nextScope,
      context: { briefVersionId: state.brief.id }, metadata: {} });
    const second = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(second).toMatchObject({ version: first.version + 1, supersedesVersionId: first.id,
      scope: nextScope, sourceRange: { messageCount: 6 } });
    expect(second.content).toContain("New scope 0");
    expect(second.content).not.toContain("Old scope");
    const context = state.memory.buildContext(state.project.id, state.conversation.id, nextScope);
    expect(context.recentMessages.map((item) => item.content)).toEqual(
      Array.from({ length: 8 }, (_, index) => `New scope ${index + 6}`),
    );
    expect(state.memory.buildContext(state.project.id, state.conversation.id, state.scope)).toMatchObject({
      summary: null, diagnostics: { summaryStatus: "stale", staleSummaryReasons: ["requested-scope-mismatch"] },
    });
    state.database.close();
  });

  it("catches up a long legacy transcript in bounded increments while retaining only recent context", () => {
    const state = setup();
    const messageCount = 260;
    for (let index = 0; index < messageCount; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: index % 2 ? "assistant" : "user", content: `Long message ${index}`,
      intent: "discuss", scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {},
    });
    const first = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(first.sourceRange.messageCount).toBe(AUTHOR_MEMORY_BUDGETS.summaryIncrementMessages);
    let current = first;
    for (let index = 0; index < 10 && current.sourceRange.messageCount < messageCount - AUTHOR_MEMORY_BUDGETS.recentMessageCount; index += 1) {
      current = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    }
    expect(current.sourceRange.messageCount).toBe(messageCount - AUTHOR_MEMORY_BUDGETS.recentMessageCount);
    expect(current.sourceRange.messageCount).toBeGreaterThan(200);
    expect(state.memory.ensureSummary(state.project.id, state.conversation.id)?.id).toBe(current.id);
    const context = state.memory.buildContext(state.project.id, state.conversation.id, state.scope);
    expect(context.recentMessages).toHaveLength(AUTHOR_MEMORY_BUDGETS.recentMessageCount);
    expect(context.recentMessages.map((item) => item.content)).toEqual(
      Array.from({ length: AUTHOR_MEMORY_BUDGETS.recentMessageCount }, (_, index) => `Long message ${index + messageCount - AUTHOR_MEMORY_BUDGETS.recentMessageCount}`),
    );
    const changed = state.artifacts.saveArtifact({ projectId: state.project.id, artifactId: "brief",
      content: { title: "Changed after legacy history" }, schema: ArtifactSchema });
    const historyCount = state.memory.listSummaries(state.project.id, state.conversation.id).length;
    for (let index = 0; index < 20; index += 1) state.memory.ensureSummary(state.project.id, state.conversation.id);
    expect(state.memory.listSummaries(state.project.id, state.conversation.id)).toHaveLength(historyCount);
    const changedScope = { ...state.scope, versionId: changed.id };
    state.conversations.updateScope(state.conversation.id, changedScope);
    for (let index = 0; index < 14; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "user", content: `Current legacy continuation ${index}`,
      intent: "discuss", scope: changedScope, context: { briefVersionId: changed.id }, metadata: {},
    });
    const regenerated = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    expect(regenerated.canonicalDependencies).toEqual({ briefVersionId: changed.id });
    expect(state.memory.ensureSummary(state.project.id, state.conversation.id)?.id).toBe(regenerated.id);
    state.database.close();
  });

  it("bounds recent message bytes newest-first without changing exact stored Unicode messages", () => {
    const state = setup();
    const contents = Array.from({ length: 8 }, (_, index) => `${index}:${"😀".repeat(1_700)}`);
    for (const content of contents) state.conversations.addMessage({ conversationId: state.conversation.id,
      role: "user", content, intent: "discuss", scope: state.scope,
      context: { briefVersionId: state.brief.id }, metadata: {} });
    const context = state.memory.buildContext(state.project.id, state.conversation.id, state.scope);
    expect(context.recentMessages.map((item) => item.content)).toEqual(contents.slice(-3));
    expect(context.diagnostics).toMatchObject({ omittedRecentMessageCount: 5,
      recentMessageBytes: contents.slice(-3).reduce((total, content) => total + Buffer.byteLength(content, "utf8"), 0) });
    expect(context.diagnostics.omittedRecentMessageBytes).toBe(
      contents.slice(0, 5).reduce((total, content) => total + Buffer.byteLength(content, "utf8"), 0),
    );
    expect(context.diagnostics.totalAuthorMemoryBytes).toBeLessThanOrEqual(AUTHOR_MEMORY_BUDGETS.totalAuthorMemoryBytes);
    expect(state.conversations.listMessages(state.conversation.id).map((item) => item.content)).toEqual(contents);
    state.database.close();
  });

  it("keeps eight tiny recent messages within both count and byte budgets", () => {
    const state = setup();
    for (let index = 0; index < 8; index += 1) state.conversations.addMessage({ conversationId: state.conversation.id,
      role: "user", content: `Tiny ${index}`, intent: "discuss", scope: state.scope,
      context: { briefVersionId: state.brief.id }, metadata: {} });
    expect(state.memory.buildContext(state.project.id, state.conversation.id, state.scope)).toMatchObject({
      recentMessages: Array.from({ length: 8 }, (_, index) => ({ content: `Tiny ${index}` })),
      diagnostics: { omittedRecentMessageCount: 0, omittedRecentMessageBytes: 0 },
    });
    state.database.close();
  });

  it("rejects direct-SQL head lineage mismatches atomically", () => {
    const state = setup();
    const first = state.memory.createDecision({ projectId: state.project.id, scope: { kind: "project" }, content: "One" });
    expect(() => state.database.prepare(`INSERT INTO pinned_decision_versions
      (id, decision_id, project_id, version, scope_kind, artifact_id, entity_kind, entity_id,
        related_ids_json, content, status, provenance_json, supersedes_version_id, created_at)
      SELECT 'gap-decision-version', decision_id, project_id, version + 2, scope_kind, artifact_id, entity_kind,
        entity_id, related_ids_json, content, status, provenance_json, id, created_at
      FROM pinned_decision_versions WHERE id = ?`).run(first.id)).toThrow(/progression|lineage/);
    expect(state.memory.listDecisions(state.project.id, true)).toHaveLength(1);
    const second = state.memory.createDecision({ projectId: state.project.id, scope: { kind: "project" }, content: "Two" });
    expect(() => state.database.prepare(`UPDATE pinned_decision_heads SET current_version_id = ? WHERE decision_id = ?`)
      .run(second.id, first.stableId)).toThrow(/progression|lineage/);
    expect(state.memory.getDecision(state.project.id, first.stableId)?.id).toBe(first.id);

    for (let index = 0; index < 12; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "user", content: `Source ${index}`, intent: "discuss",
      scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {},
    });
    const summary = state.memory.ensureSummary(state.project.id, state.conversation.id)!;
    const otherConversation = state.conversations.create(state.project.id, state.scope);
    const foreignMessage = state.conversations.addMessage({ conversationId: otherConversation.id, role: "user",
      content: "Wrong conversation", intent: "discuss", scope: state.scope, context: {}, metadata: {} });
    expect(() => state.database.prepare(`INSERT INTO conversation_summary_versions
      (id, series_id, project_id, conversation_id, version, scope_json, first_message_id, last_message_id,
        covered_message_count, source_fingerprint, dependencies_json, content, creation_state, supersedes_version_id, created_at)
      SELECT 'bad-summary-version', series_id, project_id, conversation_id, version + 1, scope_json, first_message_id, ?,
        covered_message_count + 1, source_fingerprint, dependencies_json, content, creation_state, id, created_at
      FROM conversation_summary_versions WHERE id = ?`).run(foreignMessage.id, summary.id)).toThrow("exact lineage mismatch");
    expect(state.memory.currentSummary(state.project.id, state.conversation.id)?.id).toBe(summary.id);
    expect(state.database.prepare("SELECT id FROM conversation_summary_versions WHERE id = 'bad-summary-version'").get())
      .toBeUndefined();

    const secondDecisionVersion = state.memory.reviseDecision(state.project.id, first.stableId, { content: "One v2" });
    const thirdDecisionVersion = state.memory.reviseDecision(state.project.id, first.stableId, { content: "One v3" });
    expect(thirdDecisionVersion.version).toBe(3);
    expect(() => state.database.prepare(`UPDATE pinned_decision_heads SET current_version_id = ? WHERE decision_id = ?`)
      .run(first.id, first.stableId)).toThrow("progression mismatch");
    expect(state.memory.getDecision(state.project.id, first.stableId)?.id).toBe(thirdDecisionVersion.id);
    expect(() => state.database.prepare("DELETE FROM pinned_decision_versions WHERE id = ?").run(secondDecisionVersion.id))
      .toThrow("immutable");
    expect(() => state.database.prepare("DELETE FROM pinned_decisions WHERE id = ?").run(first.stableId))
      .toThrow("immutable");

    for (let version = 0; version < 3; version += 1) {
      for (let index = 0; index < 6; index += 1) state.conversations.addMessage({
        conversationId: state.conversation.id, role: "user", content: `Summary next ${version}-${index}`,
        intent: "discuss", scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {},
      });
      state.memory.ensureSummary(state.project.id, state.conversation.id);
    }
    const summaryHead = state.memory.currentSummary(state.project.id, state.conversation.id)!;
    expect(summaryHead.version).toBeGreaterThanOrEqual(3);
    expect(() => state.database.prepare(`UPDATE conversation_summary_heads SET current_version_id = ? WHERE series_id = ?`)
      .run(summary.id, summary.stableId)).toThrow("progression mismatch");
    expect(() => state.database.prepare("DELETE FROM conversation_summary_series WHERE id = ?").run(summary.stableId))
      .toThrow("immutable");
    expect(state.memory.currentSummary(state.project.id, state.conversation.id)?.id).toBe(summaryHead.id);
    state.database.close();
  });

  it("preserves explicit project-deletion cascades without orphaned author memory", () => {
    const state = setup();
    for (let index = 0; index < 12; index += 1) state.conversations.addMessage({
      conversationId: state.conversation.id, role: "user", content: `Message ${index}`, intent: "discuss",
      scope: state.scope, context: { briefVersionId: state.brief.id }, metadata: {},
    });
    state.memory.ensureSummary(state.project.id, state.conversation.id);
    state.memory.createDecision({ projectId: state.project.id, scope: { kind: "project" }, content: "Keep this." });
    expect(() => new ProjectRepository(state.database).remove(state.project.id)).not.toThrow();
    expect(state.database.prepare("SELECT COUNT(*) count FROM conversation_summary_versions").get()).toEqual({ count: 0 });
    expect(state.database.prepare("SELECT COUNT(*) count FROM pinned_decision_versions").get()).toEqual({ count: 0 });
    state.database.close();
  });
});
