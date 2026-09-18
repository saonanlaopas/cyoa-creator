import { createHash, randomUUID } from "node:crypto";
import {
  CONVERSATION_MESSAGE_BUDGETS,
  conversationMessageBytes,
  type AssistantScope,
  type MessageRecord,
} from "./conversation-repository.js";
import type { StoryDatabase } from "./database.js";
import { transaction } from "./database.js";

export const AUTHOR_MEMORY_BUDGETS = Object.freeze({
  recentMessageCount: 8,
  recentMessageBytes: 24_000,
  recentMessageIndividualBytes: 8_000,
  summaryIncrementMessages: 48,
  summaryBytes: 12_000,
  decisionContentBytes: 2_000,
  relatedIdCount: 40,
  contextDecisionCount: 24,
  contextDecisionBytes: 12_000,
  totalAuthorMemoryBytes: 48_000,
  providerConversationBytes: 64_000,
});

export type SummaryStatus = "current" | "superseded" | "stale";
export interface ConversationSummaryVersion {
  id: string;
  stableId: string;
  projectId: string;
  conversationId: string;
  version: number;
  scope: AssistantScope;
  sourceRange: { firstMessageId: string; lastMessageId: string; messageCount: number; fingerprint: string };
  method: "deterministic-extractive";
  methodVersion: 1;
  creationState: "created";
  status: SummaryStatus;
  staleReasons: string[];
  supersedesVersionId: string | null;
  canonicalDependencies: Record<string, string>;
  content: string;
  createdAt: string;
}

export interface DecisionScope {
  kind: "project" | "artifact" | "entity";
  artifactId?: string;
  entityKind?: string;
  entityId?: string;
}
export interface PinnedDecisionVersion {
  id: string;
  stableId: string;
  projectId: string;
  version: number;
  scope: DecisionScope;
  relatedIds: string[];
  content: string;
  status: "active" | "superseded" | "withdrawn";
  provenance: { messageId?: string; changeSetId?: string; note?: string };
  supersedesVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorMemoryContext {
  authority: "non-canonical-author-memory";
  summary: ConversationSummaryVersion | null;
  decisions: PinnedDecisionVersion[];
  recentMessages: MessageRecord[];
  diagnostics: {
    summaryStatus: "none" | SummaryStatus;
    staleSummaryReasons: string[];
    omittedDecisionCount: number;
    omittedDecisionBytes: number;
    omittedRecentMessageCount: number;
    omittedRecentMessageBytes: number;
    recentMessageBytes: number;
    totalAuthorMemoryBytes: number;
    limits: typeof AUTHOR_MEMORY_BUDGETS;
  };
}

export interface AuthorMemoryContextOptions {
  excludeMessageIds?: string[];
}

type SummaryRow = {
  id: string; series_id: string; project_id: string; conversation_id: string; version: number;
  scope_json: string; first_message_id: string; last_message_id: string; covered_message_count: number;
  source_fingerprint: string; dependencies_json: string; content: string; creation_state: "created";
  supersedes_version_id: string | null; created_at: string; method: "deterministic-extractive"; method_version: 1;
  current_version_id: string | null;
};
type DecisionRow = {
  id: string; decision_id: string; project_id: string; version: number; scope_kind: DecisionScope["kind"];
  artifact_id: string | null; entity_kind: string | null; entity_id: string | null;
  related_ids_json: string; content: string; status: PinnedDecisionVersion["status"];
  provenance_json: string; supersedes_version_id: string | null; created_at: string; updated_at: string;
  current_version_id: string;
};

const json = <T>(value: string): T => JSON.parse(value) as T;
const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");
const boundedText = (value: string, maximumBytes: number, label: string): string => {
  const content = value.trim();
  if (!content) throw new Error(`${label} is required`);
  if (byteLength(content) > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes.toLocaleString()}-byte limit`);
  return content;
};

export class AuthorMemoryRepository {
  public constructor(private readonly database: StoryDatabase) {}

  ensureSummary(projectId: string, conversationId: string): ConversationSummaryVersion | null {
    const conversation = this.database.prepare("SELECT project_id, scope_json FROM conversations WHERE id = ?")
      .get(conversationId) as { project_id: string; scope_json: string } | undefined;
    if (!conversation || conversation.project_id !== projectId) throw new Error("Conversation not found");
    const conversationScope = json<AssistantScope>(conversation.scope_json);
    const current = this.currentSummary(projectId, conversationId);
    const dependencies = this.currentCanonicalDependencies(projectId);
    const base = current?.status === "current" ? current : null;
    const additions = current && !base
      ? this.regenerationAdditions(conversationId, conversationScope, dependencies)
      : this.summaryAdditions(conversationId, base?.sourceRange.lastMessageId ?? null, conversationScope, dependencies);
    if (additions.length === 0) return current;
    const firstMessageId = base?.sourceRange.firstMessageId ?? additions[0]!.id;
    const lastMessage = additions.at(-1)!;
    const content = this.summarize(base?.content ?? "", additions);
    const sourceFingerprint = fingerprint({
      previous: base?.sourceRange.fingerprint ?? null,
      additions: additions.map(({ id, role, content: messageContent, intent }) => ({ id, role, content: messageContent, intent })),
    });
    const scope = conversationScope;
    return transaction(this.database, () => {
      let series = this.database.prepare(`SELECT id FROM conversation_summary_series
        WHERE project_id = ? AND conversation_id = ?`).get(projectId, conversationId) as { id: string } | undefined;
      const now = new Date().toISOString();
      if (!series) {
        series = { id: randomUUID() };
        this.database.prepare(`INSERT INTO conversation_summary_series
          (id, project_id, conversation_id, method, method_version, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
          .run(series.id, projectId, conversationId, "deterministic-extractive", now);
      }
      const version = (current?.version ?? 0) + 1;
      const id = randomUUID();
      const coveredCount = (base?.sourceRange.messageCount ?? 0) + additions.length;
      this.database.prepare(`INSERT INTO conversation_summary_versions
        (id, series_id, project_id, conversation_id, version, scope_json, first_message_id, last_message_id,
          covered_message_count, source_fingerprint, dependencies_json, content, creation_state,
          supersedes_version_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`)
        .run(id, series.id, projectId, conversationId, version, JSON.stringify(scope), firstMessageId, lastMessage.id,
          coveredCount, sourceFingerprint, JSON.stringify(dependencies), content, current?.id ?? null, now);
      this.database.prepare(`INSERT INTO conversation_summary_heads (series_id, project_id, current_version_id, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(series_id) DO UPDATE SET current_version_id = excluded.current_version_id,
          updated_at = excluded.updated_at`)
        .run(series.id, projectId, id, now);
      return this.getSummary(id)!;
    });
  }

  currentSummary(projectId: string, conversationId: string): ConversationSummaryVersion | null {
    const row = this.database.prepare(`${this.summarySelect()}
      WHERE versions.project_id = ? AND versions.conversation_id = ? AND heads.current_version_id = versions.id`)
      .get(projectId, conversationId) as SummaryRow | undefined;
    return row ? this.mapSummary(row) : null;
  }

  listSummaries(projectId: string, conversationId: string): ConversationSummaryVersion[] {
    return (this.database.prepare(`${this.summarySelect()}
      WHERE versions.project_id = ? AND versions.conversation_id = ? ORDER BY versions.version DESC LIMIT 100`)
      .all(projectId, conversationId) as SummaryRow[]).map((row) => this.mapSummary(row));
  }

  createDecision(input: {
    projectId: string; scope: DecisionScope; relatedIds?: string[]; content: string;
    provenance?: PinnedDecisionVersion["provenance"];
  }): PinnedDecisionVersion {
    this.assertProject(input.projectId);
    const scope = normalizeDecisionScope(input.scope);
    const relatedIds = normalizeRelatedIds(input.relatedIds ?? []);
    const content = boundedText(input.content, AUTHOR_MEMORY_BUDGETS.decisionContentBytes, "Decision content");
    const provenance = normalizeProvenance(input.provenance);
    this.assertProvenance(input.projectId, provenance);
    return transaction(this.database, () => {
      const stableId = randomUUID(); const versionId = randomUUID(); const now = new Date().toISOString();
      this.database.prepare("INSERT INTO pinned_decisions (id, project_id, created_at) VALUES (?, ?, ?)")
        .run(stableId, input.projectId, now);
      this.insertDecisionVersion({ versionId, stableId, projectId: input.projectId, version: 1, scope, relatedIds,
        content, status: "active", provenance, previousId: null, now });
      this.database.prepare(`INSERT INTO pinned_decision_heads
        (decision_id, project_id, current_version_id, updated_at) VALUES (?, ?, ?, ?)`)
        .run(stableId, input.projectId, versionId, now);
      return this.getDecision(input.projectId, stableId)!;
    });
  }

  reviseDecision(projectId: string, stableId: string, input: {
    scope?: DecisionScope; relatedIds?: string[]; content?: string;
    status?: PinnedDecisionVersion["status"]; provenance?: PinnedDecisionVersion["provenance"];
  }): PinnedDecisionVersion {
    const current = this.getDecision(projectId, stableId);
    if (!current) throw new Error("Pinned decision not found");
    const scope = normalizeDecisionScope(input.scope ?? current.scope);
    const relatedIds = normalizeRelatedIds(input.relatedIds ?? current.relatedIds);
    const content = boundedText(input.content ?? current.content, AUTHOR_MEMORY_BUDGETS.decisionContentBytes, "Decision content");
    const status = input.status ?? current.status;
    const provenance = normalizeProvenance(input.provenance ?? current.provenance);
    this.assertProvenance(projectId, provenance);
    return transaction(this.database, () => {
      const versionId = randomUUID(); const now = new Date().toISOString();
      this.insertDecisionVersion({ versionId, stableId, projectId, version: current.version + 1, scope, relatedIds,
        content, status, provenance, previousId: current.id, now });
      this.database.prepare(`UPDATE pinned_decision_heads SET current_version_id = ?, updated_at = ?
        WHERE decision_id = ? AND project_id = ?`).run(versionId, now, stableId, projectId);
      return this.getDecision(projectId, stableId)!;
    });
  }

  getDecision(projectId: string, stableId: string): PinnedDecisionVersion | null {
    const row = this.database.prepare(`${this.decisionSelect()}
      WHERE versions.project_id = ? AND versions.decision_id = ? AND heads.current_version_id = versions.id`)
      .get(projectId, stableId) as DecisionRow | undefined;
    return row ? mapDecision(row) : null;
  }

  listDecisions(projectId: string, includeHistory = false): PinnedDecisionVersion[] {
    const condition = includeHistory ? "" : "AND heads.current_version_id = versions.id";
    return (this.database.prepare(`${this.decisionSelect()} WHERE versions.project_id = ? ${condition}
      ORDER BY versions.created_at DESC, versions.decision_id, versions.version DESC LIMIT ?`)
      .all(projectId, includeHistory ? 500 : 200) as DecisionRow[])
      .map(mapDecision);
  }

  buildContext(
    projectId: string,
    conversationId: string,
    scope: AssistantScope,
    options: AuthorMemoryContextOptions = {},
  ): AuthorMemoryContext {
    const conversation = this.database.prepare("SELECT project_id FROM conversations WHERE id = ?")
      .get(conversationId) as { project_id: string } | undefined;
    if (!conversation || conversation.project_id !== projectId || scope.projectId !== projectId) {
      throw new Error("Conversation not found");
    }
    const excluded = new Set((options.excludeMessageIds ?? []).slice(0, AUTHOR_MEMORY_BUDGETS.recentMessageCount));
    const candidates = this.messageRows(
      conversationId,
      AUTHOR_MEMORY_BUDGETS.recentMessageCount + excluded.size,
      scope,
    ).filter((message) => !excluded.has(message.id)).slice(-AUTHOR_MEMORY_BUDGETS.recentMessageCount);
    const messages: MessageRecord[] = [];
    let recentBytes = 0;
    let omittedRecentMessageCount = 0;
    let omittedRecentMessageBytes = 0;
    for (const message of [...candidates].reverse()) {
      const size = conversationMessageBytes(message.content);
      if (size > AUTHOR_MEMORY_BUDGETS.recentMessageIndividualBytes
        || recentBytes + size > AUTHOR_MEMORY_BUDGETS.recentMessageBytes) {
        omittedRecentMessageCount += 1;
        omittedRecentMessageBytes += size;
        continue;
      }
      messages.unshift(message);
      recentBytes += size;
    }
    const summary = this.currentSummary(projectId, conversationId);
    const relevant = this.relevantDecisions(projectId, scope);
    const decisions: PinnedDecisionVersion[] = [];
    let usedBytes = 0;
    for (const decision of relevant.candidates) {
      const size = byteLength(decision.content) + byteLength(JSON.stringify(decision.relatedIds));
      if (decisions.length >= AUTHOR_MEMORY_BUDGETS.contextDecisionCount
        || usedBytes + size > AUTHOR_MEMORY_BUDGETS.contextDecisionBytes) break;
      decisions.push(decision); usedBytes += size;
    }
    const requestedScopeMatches = summary ? assistantScopesEqual(summary.scope, scope) : true;
    const usableSummary = summary?.status === "current" && requestedScopeMatches ? summary : null;
    const summaryBytes = usableSummary ? byteLength(usableSummary.content) : 0;
    const totalAuthorMemoryBytes = summaryBytes + usedBytes + recentBytes;
    if (totalAuthorMemoryBytes > AUTHOR_MEMORY_BUDGETS.totalAuthorMemoryBytes) {
      throw new Error("Author-memory context exceeds its deterministic byte limit");
    }
    return {
      authority: "non-canonical-author-memory",
      summary: usableSummary,
      decisions,
      recentMessages: messages,
      diagnostics: {
        summaryStatus: summary ? requestedScopeMatches ? summary.status : "stale" : "none",
        staleSummaryReasons: [...(summary?.staleReasons ?? []), ...(summary && !requestedScopeMatches ? ["requested-scope-mismatch"] : [])],
        omittedDecisionCount: relevant.totalCount - decisions.length,
        omittedDecisionBytes: relevant.totalBytes - usedBytes,
        omittedRecentMessageCount,
        omittedRecentMessageBytes,
        recentMessageBytes: recentBytes,
        totalAuthorMemoryBytes,
        limits: AUTHOR_MEMORY_BUDGETS,
      },
    };
  }

  private summarize(previous: string, messages: MessageRecord[]): string {
    const additions = messages.map((message) =>
      `${message.role === "user" ? "Author" : "Assistant"}: ${message.content.replace(/\s+/g, " ").slice(0, 700)}`);
    const combined = [previous ? `Earlier summary:\n${previous}` : "", ...additions].filter(Boolean).join("\n");
    if (byteLength(combined) <= AUTHOR_MEMORY_BUDGETS.summaryBytes) return combined;
    return Buffer.from(combined, "utf8").subarray(-AUTHOR_MEMORY_BUDGETS.summaryBytes).toString("utf8").replace(/^\uFFFD+/, "");
  }

  private messageRows(conversationId: string, limit?: number, scope?: AssistantScope): MessageRecord[] {
    const suffix = limit ? "ORDER BY created_at DESC, rowid DESC LIMIT ?" : "ORDER BY created_at, rowid";
    const scopeCondition = scope ? `AND json_extract(scope_json, '$.kind') = ? AND json_extract(scope_json, '$.projectId') = ?
      AND json_extract(scope_json, '$.stage') IS ? AND json_extract(scope_json, '$.artifactId') IS ?
      AND json_extract(scope_json, '$.versionId') IS ? AND json_extract(scope_json, '$.sectionId') IS ?` : "";
    const scopeValues = scope ? assistantScopeValues(scope) : [];
    const rows = this.database.prepare(`SELECT id, conversation_id, role, content, intent, scope_json, context_json,
      metadata_json, created_at FROM messages WHERE conversation_id = ? ${scopeCondition} ${suffix}`)
      .all(...(limit ? [conversationId, ...scopeValues, limit] : [conversationId, ...scopeValues])) as Array<{
        id: string; conversation_id: string; role: MessageRecord["role"]; content: string; intent: MessageRecord["intent"];
        scope_json: string; context_json: string; metadata_json: string; created_at: string;
      }>;
    if (limit) rows.reverse();
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content,
        intent: row.intent, scope: json(row.scope_json), context: json(row.context_json), metadata: json(row.metadata_json),
        createdAt: row.created_at }));
  }

  private summaryAdditions(
    conversationId: string,
    afterMessageId: string | null,
    scope: AssistantScope,
    dependencies: Record<string, string>,
  ): MessageRecord[] {
    const values = assistantScopeValues(scope);
    const rows = this.database.prepare(`SELECT id, conversation_id, role, content, intent, scope_json, context_json,
        metadata_json, created_at FROM messages
      WHERE conversation_id = ?
        AND json_extract(scope_json, '$.kind') = ? AND json_extract(scope_json, '$.projectId') = ?
        AND json_extract(scope_json, '$.stage') IS ? AND json_extract(scope_json, '$.artifactId') IS ?
        AND json_extract(scope_json, '$.versionId') IS ? AND json_extract(scope_json, '$.sectionId') IS ?
        AND rowid > COALESCE((SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?), 0)
        AND rowid <= COALESCE((SELECT rowid FROM messages WHERE conversation_id = ?
          AND json_extract(scope_json, '$.kind') = ? AND json_extract(scope_json, '$.projectId') = ?
          AND json_extract(scope_json, '$.stage') IS ? AND json_extract(scope_json, '$.artifactId') IS ?
          AND json_extract(scope_json, '$.versionId') IS ? AND json_extract(scope_json, '$.sectionId') IS ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET ?), -1)
      ORDER BY created_at, rowid LIMIT ?`).all(conversationId, ...values, afterMessageId, conversationId,
        conversationId, ...values, AUTHOR_MEMORY_BUDGETS.recentMessageCount, AUTHOR_MEMORY_BUDGETS.summaryIncrementMessages) as Array<{
          id: string; conversation_id: string; role: MessageRecord["role"]; content: string; intent: MessageRecord["intent"];
          scope_json: string; context_json: string; metadata_json: string; created_at: string;
        }>;
    const messages: MessageRecord[] = rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content,
      intent: row.intent, scope: json<AssistantScope>(row.scope_json), context: json<MessageRecord["context"]>(row.context_json),
      metadata: json<MessageRecord["metadata"]>(row.metadata_json),
      createdAt: row.created_at }));
    const firstMismatch = messages.findIndex((message) => !dependenciesEqual(message.context, dependencies));
    return firstMismatch < 0 ? messages : messages.slice(0, firstMismatch);
  }

  private regenerationAdditions(
    conversationId: string,
    scope: AssistantScope,
    dependencies: Record<string, string>,
  ): MessageRecord[] {
    const window = this.messageRows(
      conversationId,
      AUTHOR_MEMORY_BUDGETS.summaryIncrementMessages + AUTHOR_MEMORY_BUDGETS.recentMessageCount,
      scope,
    );
    let start = window.length;
    while (start > 0 && dependenciesEqual(window[start - 1]!.context, dependencies)) start -= 1;
    const consistentSuffix = window.slice(start);
    const summarizableCount = Math.min(
      AUTHOR_MEMORY_BUDGETS.summaryIncrementMessages,
      Math.max(0, consistentSuffix.length - AUTHOR_MEMORY_BUDGETS.recentMessageCount),
    );
    return consistentSuffix.slice(0, summarizableCount);
  }

  private relevantDecisions(projectId: string, scope: AssistantScope): {
    candidates: PinnedDecisionVersion[]; totalCount: number; totalBytes: number;
  } {
    const scoped = scope.kind === "project"
      ? { sql: "versions.scope_kind = 'project'", values: [] as Array<string | null> }
      : { sql: `(versions.scope_kind = 'project' OR (versions.artifact_id = ? AND
          (versions.scope_kind = 'artifact' OR (versions.scope_kind = 'entity' AND versions.entity_id = ?))))`,
        values: [scope.artifactId ?? null, scope.sectionId ?? null] as Array<string | null> };
    const from = `FROM pinned_decision_versions versions
      JOIN pinned_decision_heads heads ON heads.decision_id = versions.decision_id
      WHERE versions.project_id = ? AND heads.current_version_id = versions.id
        AND versions.status = 'active' AND ${scoped.sql}`;
    const totals = this.database.prepare(`SELECT COUNT(*) AS count,
        COALESCE(SUM(length(CAST(versions.content AS BLOB)) + length(CAST(versions.related_ids_json AS BLOB))), 0) AS bytes
        ${from}`).get(projectId, ...scoped.values) as { count: number; bytes: number };
    const rows = this.database.prepare(`SELECT versions.*, heads.updated_at, heads.current_version_id ${from}
      ORDER BY versions.created_at DESC, versions.decision_id LIMIT ?`)
      .all(projectId, ...scoped.values, AUTHOR_MEMORY_BUDGETS.contextDecisionCount + 1) as DecisionRow[];
    return { candidates: rows.map(mapDecision), totalCount: totals.count, totalBytes: totals.bytes };
  }

  private mapSummary(row: SummaryRow): ConversationSummaryVersion {
    const dependencies = json<Record<string, string>>(row.dependencies_json);
    const currentDependencies = this.currentCanonicalDependencies(row.project_id);
    const staleReasons = [...new Set([...Object.keys(dependencies), ...Object.keys(currentDependencies)])]
      .sort()
      .flatMap((key) => dependencies[key] === currentDependencies[key]
        ? []
        : [`canonical-dependency-changed:${key.slice(0, -"VersionId".length)}`]);
    const conversation = this.database.prepare("SELECT scope_json FROM conversations WHERE id = ? AND project_id = ?")
      .get(row.conversation_id, row.project_id) as { scope_json: string } | undefined;
    if (!conversation || conversation.scope_json !== row.scope_json) staleReasons.push("conversation-scope-changed");
    const status: SummaryStatus = row.current_version_id !== row.id ? "superseded" : staleReasons.length ? "stale" : "current";
    return { id: row.id, stableId: row.series_id, projectId: row.project_id, conversationId: row.conversation_id,
      version: row.version, scope: json(row.scope_json), sourceRange: { firstMessageId: row.first_message_id,
        lastMessageId: row.last_message_id, messageCount: row.covered_message_count, fingerprint: row.source_fingerprint },
      method: row.method, methodVersion: row.method_version, creationState: row.creation_state, status, staleReasons,
      supersedesVersionId: row.supersedes_version_id, canonicalDependencies: dependencies, content: row.content,
      createdAt: row.created_at };
  }

  private getSummary(id: string): ConversationSummaryVersion | null {
    const row = this.database.prepare(`${this.summarySelect()} WHERE versions.id = ?`).get(id) as SummaryRow | undefined;
    return row ? this.mapSummary(row) : null;
  }

  private summarySelect(): string { return `SELECT versions.*, series.method, series.method_version,
    heads.current_version_id FROM conversation_summary_versions versions
    JOIN conversation_summary_series series ON series.id = versions.series_id
    LEFT JOIN conversation_summary_heads heads ON heads.series_id = versions.series_id`; }

  private decisionSelect(): string { return `SELECT versions.*, heads.updated_at, heads.current_version_id FROM pinned_decision_versions versions
    JOIN pinned_decision_heads heads ON heads.decision_id = versions.decision_id`; }

  private insertDecisionVersion(input: { versionId: string; stableId: string; projectId: string; version: number;
    scope: DecisionScope; relatedIds: string[]; content: string; status: PinnedDecisionVersion["status"];
    provenance: PinnedDecisionVersion["provenance"]; previousId: string | null; now: string }): void {
    this.database.prepare(`INSERT INTO pinned_decision_versions
      (id, decision_id, project_id, version, scope_kind, artifact_id, entity_kind, entity_id, related_ids_json,
        content, status, provenance_json, supersedes_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.versionId, input.stableId, input.projectId, input.version, input.scope.kind,
        input.scope.artifactId ?? null, input.scope.entityKind ?? null, input.scope.entityId ?? null,
        JSON.stringify(input.relatedIds), input.content, input.status, JSON.stringify(input.provenance), input.previousId, input.now);
  }

  private assertProject(projectId: string): void {
    if (!this.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new Error("Project not found");
  }

  private currentCanonicalDependencies(projectId: string): Record<string, string> {
    const rows = this.database.prepare(`SELECT versions.artifact_id, versions.id
      FROM artifact_versions versions
      JOIN (SELECT artifact_id, MAX(version) AS version FROM artifact_versions
        WHERE project_id = ? AND artifact_id IN ('brief', 'creative-direction', 'bible', 'routes', 'endings', 'mechanics')
        GROUP BY artifact_id) current
        ON current.artifact_id = versions.artifact_id AND current.version = versions.version
      WHERE versions.project_id = ? ORDER BY versions.artifact_id`).all(projectId, projectId) as Array<{
        artifact_id: string; id: string;
      }>;
    return Object.fromEntries(rows.map((row) => [`${row.artifact_id}VersionId`, row.id]));
  }

  private assertProvenance(projectId: string, provenance: PinnedDecisionVersion["provenance"]): void {
    if (provenance.messageId && !this.database.prepare(`SELECT 1 FROM messages messages JOIN conversations conversations
      ON conversations.id = messages.conversation_id WHERE messages.id = ? AND conversations.project_id = ?`)
      .get(provenance.messageId, projectId)) throw new Error("Decision message provenance does not belong to this project");
    if (provenance.changeSetId && !this.database.prepare(`SELECT 1 FROM change_sets
      WHERE id = ? AND project_id = ? AND status = 'applied'`).get(provenance.changeSetId, projectId)) {
      throw new Error("Decision change-set provenance must reference an applied change in this project");
    }
  }
}

function assistantScopeValues(scope: AssistantScope): Array<string | null> {
  return [scope.kind, scope.projectId, scope.stage ?? null, scope.artifactId ?? null,
    scope.versionId ?? null, scope.sectionId ?? null];
}
function assistantScopesEqual(left: AssistantScope, right: AssistantScope): boolean {
  return assistantScopeValues(left).every((value, index) => value === assistantScopeValues(right)[index]);
}
function dependenciesEqual(left: MessageRecord["context"], right: Record<string, string>): boolean {
  const normalized = Object.fromEntries(Object.entries(left)
    .filter((entry): entry is [string, string] => entry[0].endsWith("VersionId") && typeof entry[1] === "string")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
  return JSON.stringify(normalized) === JSON.stringify(right);
}
function normalizeDecisionScope(scope: DecisionScope): DecisionScope {
  if (scope.kind === "project") return { kind: "project" };
  const artifactId = scope.artifactId?.trim();
  if (!artifactId) throw new Error("Artifact-scoped decisions require an artifact ID");
  if (scope.kind === "artifact") return { kind: "artifact", artifactId };
  const entityKind = scope.entityKind?.trim(); const entityId = scope.entityId?.trim();
  if (!entityKind || !entityId) throw new Error("Entity-scoped decisions require entity kind and stable ID");
  return { kind: "entity", artifactId, entityKind, entityId };
}
function normalizeRelatedIds(values: string[]): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (normalized.length > AUTHOR_MEMORY_BUDGETS.relatedIdCount) {
    throw new Error(`A decision may reference at most ${AUTHOR_MEMORY_BUDGETS.relatedIdCount} stable IDs`);
  }
  if (normalized.some((value) => byteLength(value) > 240)) throw new Error("Related stable IDs must be at most 240 bytes");
  return normalized;
}
function normalizeProvenance(value: PinnedDecisionVersion["provenance"] | undefined): PinnedDecisionVersion["provenance"] {
  const result = Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => typeof item === "string" && item.trim())
    .map(([key, item]) => [key, String(item).trim().slice(0, 500)]));
  return Object.keys(result).length ? result : { note: "Pinned directly by author" };
}
function mapDecision(row: DecisionRow): PinnedDecisionVersion {
  return { id: row.id, stableId: row.decision_id, projectId: row.project_id, version: row.version,
    scope: row.scope_kind === "project" ? { kind: "project" } : row.scope_kind === "artifact"
      ? { kind: "artifact", artifactId: row.artifact_id! }
      : { kind: "entity", artifactId: row.artifact_id!, entityKind: row.entity_kind!, entityId: row.entity_id! },
    relatedIds: json(row.related_ids_json), content: row.content,
    status: row.current_version_id !== row.id && row.status === "active" ? "superseded" : row.status,
    provenance: json(row.provenance_json), supersedesVersionId: row.supersedes_version_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
